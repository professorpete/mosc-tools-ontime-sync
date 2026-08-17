import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { storage } from './storage';
import {
  getRundowns,
  getCurrentRundown,
  getRundownById,
  getCustomFields,
  importRundown,
  syncAuxAutomations,
  normaliseBaseUrl,
  isPrivateHost,
  OntimeError,
  type ImportMode,
} from './ontime';
import {
  parseShowFlowCsv,
  convertToOntime,
  validateRundown,
  diffRundowns,
  sheetCsvUrl,
  sheetExportCsvUrl,
  sheetEditUrl,
  extractSheetTabNames,
  extractSheetTabs,
  findSheetTab,
  type SheetTab,
  rundownBaseTitle,
  versionedRundownTitle,
  type ParsedShowFlow,
  type ConversionResult,
} from '@shared/showflow';
import { insertTargetSchema, updateTargetSchema, updateSettingsSchema } from '@shared/schema';

/** Event fields this app writes on every entry (sent as providedFields.event). */
const PROVIDED_EVENT_FIELDS = [
  'title',
  'cue',
  'note',
  'colour',
  'timerType',
  'duration',
  'timeStart',
  'timeEnd',
  'linkStart',
  'timeStrategy',
  'endAction',
  'timeWarning',
  'timeDanger',
  'skip',
  'dayOffset',
];

interface SheetSnapshot {
  fetchedAt: string;
  sheetId: string;
  tabName: string;
  showName: string;
  sheetUrl: string;
  csvUrl: string;
  parsed: ParsedShowFlow;
  conversion: ConversionResult;
  validationProblems: string[];
}

/** Last successful fetch per session, kept in memory — the sheet is always re-fetched on demand. */
const snapshots = new Map<string, SheetSnapshot>();
const MAX_SNAPSHOTS = 200;

function setSnapshot(sessionId: string, snap: SheetSnapshot) {
  snapshots.delete(sessionId);
  snapshots.set(sessionId, snap);
  if (snapshots.size > MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value;
    if (oldest !== undefined) snapshots.delete(oldest);
  }
}

/** The session id attached by the middleware in registerRoutes. */
function sid(req: Request): string {
  return (req as Request & { sessionId?: string }).sessionId ?? 'legacy';
}

function snapshotPayload(s: SheetSnapshot) {
  return {
    fetchedAt: s.fetchedAt,
    sheetId: s.sheetId,
    tabName: s.tabName,
    showName: s.showName,
    sheetUrl: s.sheetUrl,
    csvUrl: s.csvUrl,
    headerRow: s.parsed.headerRow,
    columnsFound: s.parsed.columnsFound,
    warnings: s.parsed.warnings,
    validationProblems: s.validationProblems,
    rows: s.parsed.rows,
    customFields: s.conversion.customFields,
    customFieldOrder: s.conversion.customFieldOrder,
    entryCount: s.conversion.rundown.order.length,
    auxAutomations: s.conversion.auxAutomations.cues,
  };
}

/** Tab name→gid map per sheet, cached briefly so one sync doesn't refetch the edit page. */
const tabMapCache = new Map<string, { tabs: SheetTab[]; at: number }>();
const TAB_MAP_TTL_MS = 60_000;

async function resolveTabGid(sheetId: string, tabName: string): Promise<string | null> {
  try {
    const cached = tabMapCache.get(sheetId);
    let tabs = cached && Date.now() - cached.at < TAB_MAP_TTL_MS ? cached.tabs : null;
    if (!tabs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(sheetEditUrl(sheetId), {
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!res.ok) return null;
        tabs = extractSheetTabs(await res.text());
      } finally {
        clearTimeout(timer);
      }
      if (tabs.length > 0) tabMapCache.set(sheetId, { tabs, at: Date.now() });
    }
    return findSheetTab(tabs, tabName)?.gid ?? null;
  } catch {
    return null; // caller falls back to the gviz-by-name URL
  }
}

async function fetchSheet(sessionId: string): Promise<SheetSnapshot> {
  const settings = storage.getSettings(sessionId);
  if (!settings.sheetId.trim()) {
    const err = new Error(
      'No Google Sheet configured yet. Click the gear icon (Settings) and paste your sheet ID and tab name.',
    ) as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  // Prefer the raw export-by-gid URL: unlike gviz it does no header inference, so
  // banner rows and multiple frozen rows come back as plain rows the parser can skip.
  const gid = await resolveTabGid(settings.sheetId, settings.tabName);
  const csvUrl = gid !== null
    ? sheetExportCsvUrl(settings.sheetId, gid)
    : sheetCsvUrl(settings.sheetId, settings.tabName);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let res: globalThis.Response;
  try {
    res = await fetch(csvUrl, { signal: controller.signal, redirect: 'follow' });
  } catch (err) {
    const e = err as Error;
    throw new Error(
      e.name === 'AbortError'
        ? 'Timed out fetching the Google Sheet. Check this machine has internet access.'
        : `Could not reach Google Sheets: ${e.message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const body = await res.text();
  const looksHtml = /^\s*</.test(body) || /<html/i.test(body.slice(0, 400));

  if (res.status === 404) {
    throw new Error(
      `Google returned 404 — no sheet with ID "${settings.sheetId}", or the tab "${settings.tabName}" does not exist.`,
    );
  }
  if (!res.ok || looksHtml) {
    throw new Error(
      `Sheet must be shared as "Anyone with the link can view" (Google returned a sign-in page for sheet ${settings.sheetId}, tab "${settings.tabName}").`,
    );
  }

  const parsed = parseShowFlowCsv(body);
  const conversion = convertToOntime(parsed, {
    showName: settings.showName,
    sheetUrl: sheetEditUrl(settings.sheetId),
  });
  const validationProblems = validateRundown(conversion.rundown);

  const snap: SheetSnapshot = {
    fetchedAt: new Date().toISOString(),
    sheetId: settings.sheetId,
    tabName: settings.tabName,
    showName: settings.showName,
    sheetUrl: sheetEditUrl(settings.sheetId),
    csvUrl,
    parsed,
    conversion,
    validationProblems,
  };
  setSnapshot(sessionId, snap);
  return snap;
}

function requireSnapshot(sessionId: string): SheetSnapshot {
  const snap = snapshots.get(sessionId);
  if (!snap) {
    throw Object.assign(new Error('Fetch the show flow sheet first.'), { status: 409 });
  }
  return snap;
}

function fail(res: Response, err: unknown, fallbackStatus = 400) {
  const e = err as Error & { status?: number };
  const status = e instanceof OntimeError ? (e.status ?? 502) : (e.status ?? fallbackStatus);
  res.status(status).json({ message: e.message ?? 'Unexpected error' });
}

/**
 * A cloud-hosted copy of this tool can never reach a LAN address — fail fast
 * with a clear explanation instead of hanging into a gateway 502.
 * When the tool itself is served from localhost / a LAN IP, local targets are fine.
 */
function guardLocalTarget(req: { headers: Record<string, unknown> }, target: { name: string; baseUrl: string }) {
  const reqHost = String(req.headers.host ?? '').split(':')[0].toLowerCase();
  const servedLocally = !reqHost || reqHost === 'localhost' || isPrivateHost(`http://${reqHost}`);
  if (!servedLocally && isPrivateHost(target.baseUrl)) {
    throw new OntimeError(
      `“${target.name}” points at ${normaliseBaseUrl(target.baseUrl)}, which is a local-network address. ` +
        `This hosted copy of the tool runs in a data centre, so it cannot reach devices on your LAN. ` +
        `To sync a local Ontime instance, run this tool on a computer on the same network — ` +
        `or use an Ontime Cloud URL here instead. Need help? mosc-tools@moscone.ca`,
      400,
    );
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  /* ------------------------------------------------------ session scoping */
  // Hosted mode: every browser gets its own isolated instance (settings,
  // targets, history). The id lives in a cookie (30 days, sliding) with an
  // x-session-id header fallback for embedded contexts that block cookies.
  // Idle sessions are wiped by cleanupSessions() after SESSION_TTL_DAYS.
  //
  // Packaged Windows .exe: it's one person on one machine, so we skip the
  // cookie dance entirely and pin every request to a fixed session id. That
  // way the last-saved sheet source and targets always reload on the next
  // launch, even if the exe opens a different default browser or a browser
  // that blocks/clears cookies — there's no "other user" to isolate from.
  const SID_RE = /^[A-Za-z0-9-]{8,64}$/;
  const isPackaged = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
  const LOCAL_DESKTOP_SESSION_ID = 'local-desktop';
  let lastCleanup = 0;
  app.use('/api', (req, res, next) => {
    let sessionId: string;
    if (isPackaged) {
      sessionId = LOCAL_DESKTOP_SESSION_ID;
    } else {
      const cookieSid = /(?:^|;\s*)mosctools_sid=([^;\s]+)/.exec(String(req.headers.cookie ?? ''))?.[1];
      const headerSid = String(req.headers['x-session-id'] ?? '');
      const querySid = typeof req.query.sid === 'string' ? req.query.sid : '';
      // The client-supplied header wins: the frontend owns the id so that all
      // parallel first requests land in the same session even without cookies.
      sessionId = [headerSid, querySid, cookieSid].find((v) => v && SID_RE.test(v)) ?? '';
      if (!sessionId) sessionId = randomUUID();
      const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http');
      res.setHeader(
        'Set-Cookie',
        `mosctools_sid=${sessionId}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax${proto === 'https' ? '; Secure' : ''}`,
      );
    }
    res.setHeader('x-session-id', sessionId);
    (req as Request & { sessionId?: string }).sessionId = sessionId;
    storage.touchSession(sessionId);
    if (Date.now() - lastCleanup > 3_600_000) {
      lastCleanup = Date.now();
      try {
        storage.cleanupSessions();
      } catch {
        /* cleanup must never break a request */
      }
    }
    next();
  });

  /* ------------------------------------------------------------- settings */
  app.get('/api/settings', (req, res) => {
    res.json(storage.getSettings(sid(req)));
  });

  app.patch('/api/settings', (req, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    snapshots.delete(sid(req));
    res.json(storage.updateSettings(sid(req), parsed.data));
  });

  // Lists the tab names of a Google Sheet so the Settings dialog can offer a
  // dropdown instead of free-typing the tab name. Reads the sheet's public
  // /edit page HTML and pulls out each tab's caption — no API key needed,
  // but it depends on Google's editor markup rather than a documented API.
  app.get('/api/sheet-tabs', async (req, res) => {
    const sheetId = String(req.query.sheetId ?? '').trim();
    if (!sheetId) return res.status(400).json({ message: 'Missing sheetId.' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(sheetEditUrl(sheetId), {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const html = await response.text();

      if (response.status === 404) {
        return res.status(404).json({ message: `No sheet found with ID "${sheetId}".` });
      }
      // Bootstrap-data extraction first (also yields gids); tab-caption markup as backup.
      const tabPairs = extractSheetTabs(html);
      const tabs = tabPairs.length > 0 ? tabPairs.map((t) => t.name) : extractSheetTabNames(html);
      if (!response.ok || tabs.length === 0) {
        return res.status(422).json({
          message: `Could not read tabs for sheet "${sheetId}" — make sure it's shared as "Anyone with the link can view", then try again or type the tab name manually.`,
        });
      }
      if (tabPairs.length > 0) tabMapCache.set(sheetId, { tabs: tabPairs, at: Date.now() });
      res.json({ tabs });
    } catch (err) {
      const e = err as Error;
      res.status(502).json({
        message:
          e.name === 'AbortError'
            ? 'Timed out reaching Google Sheets. Check this machine has internet access, or type the tab name manually.'
            : `Could not reach Google Sheets: ${e.message}`,
      });
    } finally {
      clearTimeout(timer);
    }
  });

  // "Clear all settings" button: wipes this session's sheet source, targets,
  // and sync history, then reseeds the defaults so the app is immediately
  // usable again without a relaunch.
  app.post('/api/reset', (req, res) => {
    storage.resetSession(sid(req));
    snapshots.delete(sid(req));
    res.json({ ok: true });
  });

  /* ---------------------------------------------------------------- sheet */
  app.get('/api/showflow', (req, res) => {
    const snap = snapshots.get(sid(req));
    if (!snap) return res.json(null);
    res.json(snapshotPayload(snap));
  });

  app.post('/api/showflow/fetch', async (req, res) => {
    try {
      const s = await fetchSheet(sid(req));
      res.json(snapshotPayload(s));
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/showflow/export', (req, res) => {
    try {
      const s = requireSnapshot(sid(req));
      const filename = `mosctools_${s.showName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}_ontime_project.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(s.conversion.projectFile, null, 2));
    } catch (err) {
      fail(res, err, 409);
    }
  });

  /* -------------------------------------------------------------- targets */
  app.get('/api/targets', (req, res) => {
    const targets = storage.listTargets(sid(req)).map((t) => ({
      ...t,
      history: storage.listSyncLog(t.id, 5),
    }));
    res.json(targets);
  });

  app.post('/api/targets', (req, res) => {
    const parsed = insertTargetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    res.status(201).json(storage.createTarget(sid(req), parsed.data));
  });

  app.patch('/api/targets/:id', (req, res) => {
    const id = Number(req.params.id);
    const parsed = updateTargetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
    const updated = storage.updateTarget(sid(req), id, parsed.data);
    if (!updated) return res.status(404).json({ message: 'Target not found' });
    res.json(updated);
  });

  app.delete('/api/targets/:id', (req, res) => {
    const ok = storage.deleteTarget(sid(req), Number(req.params.id));
    if (!ok) return res.status(404).json({ message: 'Target not found' });
    res.json({ ok: true });
  });

  /* ------------------------------------------------------ target: connect */
  app.post('/api/targets/:id/test', async (req, res) => {
    const target = storage.getTarget(sid(req), Number(req.params.id));
    if (!target) return res.status(404).json({ message: 'Target not found' });
    try { guardLocalTarget(req, target); } catch (err) { return fail(res, err); }
    try {
      const base = normaliseBaseUrl(target.baseUrl);
      const list = await getRundowns(target.baseUrl, target.authToken);
      let customFieldCount: number | null = null;
      try {
        customFieldCount = Object.keys(await getCustomFields(target.baseUrl, target.authToken)).length;
      } catch {
        customFieldCount = null;
      }
      const loaded = list.rundowns?.find((r) => r.id === list.loaded);
      res.json({
        ok: true,
        baseUrl: base,
        loadedRundownId: list.loaded,
        loadedRundownTitle: loaded?.title ?? null,
        rundowns: list.rundowns ?? [],
        customFieldCount,
      });
    } catch (err) {
      fail(res, err, 502);
    }
  });

  /* --------------------------------------------------------- target: diff */
  app.post('/api/targets/:id/diff', async (req, res) => {
    const target = storage.getTarget(sid(req), Number(req.params.id));
    if (!target) return res.status(404).json({ message: 'Target not found' });
    try { guardLocalTarget(req, target); } catch (err) { return fail(res, err); }
    try {
      const s = requireSnapshot(sid(req));
      const list = await getRundowns(target.baseUrl, target.authToken);
      const current = await getCurrentRundown(target.baseUrl, target.authToken);
      let remoteCustomFields: Record<string, unknown> | null = null;
      try {
        remoteCustomFields = await getCustomFields(target.baseUrl, target.authToken);
      } catch {
        remoteCustomFields = null;
      }
      const diff = diffRundowns(
        s.conversion.rundown,
        s.conversion.customFields,
        current,
        remoteCustomFields,
      );
      res.json({
        targetId: target.id,
        checkedAt: new Date().toISOString(),
        targetRundownId: current.id ?? list.loaded,
        targetRundownTitle: current.title ?? null,
        targetEntryCount: (current.order ?? []).length,
        generatedEntryCount: s.conversion.rundown.order.length,
        diff,
      });
    } catch (err) {
      fail(res, err, 409);
    }
  });

  /* ------------------------------- target: proposed name for a new rundown */
  app.get('/api/targets/:id/new-rundown-name', async (req, res) => {
    const target = storage.getTarget(sid(req), Number(req.params.id));
    if (!target) return res.status(404).json({ message: 'Target not found' });
    try {
      const s = requireSnapshot(sid(req));
      const base = rundownBaseTitle(s.tabName);
      let existing: string[] = [];
      try {
        const list = await getRundowns(target.baseUrl, target.authToken);
        existing = (list.rundowns ?? []).map((r) => r.title ?? '');
      } catch {
        existing = []; // instance unreachable — show the un-versioned name
      }
      res.json({ base, title: versionedRundownTitle(base, existing), existingCount: existing.length });
    } catch (err) {
      fail(res, err, 409);
    }
  });

  /* --------------------------------------------------------- target: sync */
  app.post('/api/targets/:id/sync', async (req, res) => {
    const target = storage.getTarget(sid(req), Number(req.params.id));
    if (!target) return res.status(404).json({ message: 'Target not found' });
    try { guardLocalTarget(req, target); } catch (err) { return fail(res, err); }

    const mode: ImportMode = ['override', 'merge', 'new'].includes(req.body?.mode)
      ? req.body.mode
      : 'override';
    const timestamp = new Date().toISOString();

    try {
      const s = requireSnapshot(sid(req));
      const list = await getRundowns(target.baseUrl, target.authToken);

      let targetRundownId: string | undefined;
      let rundownTitle: string | null = null;

      if (mode === 'new') {
        // Name the new rundown after the Google Sheet tab, versioning up if that name is taken.
        rundownTitle = versionedRundownTitle(
          rundownBaseTitle(s.tabName),
          (list.rundowns ?? []).map((r) => r.title ?? ''),
        );
      } else {
        targetRundownId =
          typeof req.body?.targetRundownId === 'string' && req.body.targetRundownId.trim()
            ? req.body.targetRundownId.trim()
            : list.loaded;
        if (!targetRundownId) {
          throw new Error('Ontime did not report a loaded rundown, so there is nothing to override.');
        }
        rundownTitle =
          (list.rundowns ?? []).find((r) => r.id === targetRundownId)?.title ?? targetRundownId;
      }

      /* Diff against what is live on the target BEFORE pushing, so the result we report
         describes what this push actually changed. mode:'new' has nothing to compare to. */
      let counts: { added: number; changed: number; removed: number; unchanged: number };
      if (mode === 'new') {
        counts = {
          added: s.conversion.rundown.order.length,
          changed: 0,
          removed: 0,
          unchanged: 0,
        };
      } else {
        let before: Awaited<ReturnType<typeof getCurrentRundown>> | null = null;
        try {
          before =
            targetRundownId && targetRundownId !== list.loaded
              ? await getRundownById(target.baseUrl, target.authToken, targetRundownId)
              : await getCurrentRundown(target.baseUrl, target.authToken);
        } catch {
          before = null; // couldn't read the target rundown — fall back to counting everything as added
        }
        let remoteCustomFields: Record<string, unknown> | null = null;
        try {
          remoteCustomFields = await getCustomFields(target.baseUrl, target.authToken);
        } catch {
          remoteCustomFields = null;
        }
        const preDiff = diffRundowns(
          s.conversion.rundown,
          s.conversion.customFields,
          before,
          remoteCustomFields,
        );
        counts = {
          added: preDiff.added.length,
          changed: preDiff.changed.length,
          removed: preDiff.removed.length,
          unchanged: preDiff.unchanged,
        };
      }

      const result = await importRundown(target.baseUrl, target.authToken, {
        mode,
        ...(targetRundownId ? { targetRundownId } : {}),
        rundown: {
          entries: s.conversion.rundown.entries as unknown as Record<string, unknown>,
          order: s.conversion.rundown.order,
          flatOrder: s.conversion.rundown.flatOrder,
          ...(mode === 'new' && rundownTitle ? { title: rundownTitle } : {}),
        },
        customFields: s.conversion.customFields,
        providedFields: { event: PROVIDED_EVENT_FIELDS, custom: s.conversion.customFieldOrder },
      });

      const createdRundownId =
        mode === 'new' ? (result.loaded ?? null) : (targetRundownId ?? null);

      /* Push aux-timer automations generated from the Aux Timer column. A failure here
         must not undo a successful rundown push — report it as a warning instead. */
      let automations: { written: number; removedStale: number; enabled: boolean } | null = null;
      let automationsWarning: string | null = null;
      try {
        automations = await syncAuxAutomations(
          target.baseUrl,
          target.authToken,
          s.conversion.auxAutomations,
        );
      } catch (err) {
        automationsWarning = `Rundown synced, but pushing aux-timer automations failed: ${(err as Error).message}`;
      }

      const logSummary = {
        mode,
        targetRundownId: createdRundownId,
        rundownTitle,
        total: s.conversion.rundown.order.length,
        added: counts.added,
        changed: counts.changed,
        removed: counts.removed,
        unchanged: counts.unchanged,
        automations: automations?.written ?? 0,
      };

      storage.addSyncLog({
        targetId: target.id,
        timestamp,
        status: 'success',
        summary: JSON.stringify(logSummary),
        errorMessage: null,
      });
      storage.markSync(target.id, timestamp, 'success');

      res.json({
        ok: true,
        mode,
        targetRundownId: createdRundownId,
        rundownTitle,
        result,
        summary: logSummary,
        automations,
        automationsWarning,
      });
    } catch (err) {
      const e = err as Error;
      storage.addSyncLog({
        targetId: target.id,
        timestamp,
        status: 'error',
        summary: JSON.stringify({ mode, rundownTitle: null }),
        errorMessage: e.message,
      });
      storage.markSync(target.id, timestamp, 'error');
      fail(res, err, 502);
    }
  });

  app.get('/api/targets/:id/log', (req, res) => {
    const target = storage.getTarget(sid(req), Number(req.params.id));
    if (!target) return res.status(404).json({ message: 'Target not found' });
    res.json(storage.listSyncLog(target.id, 20));
  });

  return httpServer;
}
