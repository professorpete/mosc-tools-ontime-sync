/**
 * Backend proxy for the Ontime v4 API. All calls to Ontime instances go through
 * here so the browser never hits CORS and tokens never leave the server.
 *
 * Routes verified against Ontime v4 source (rundown.router.ts / customFields.router.ts):
 *   GET  {base}/data/rundowns          -> { loaded, rundowns[] }
 *   GET  {base}/data/rundowns/current  -> normalised Rundown
 *   GET  {base}/data/custom-fields     -> CustomFields
 *   POST {base}/data/rundowns/import   -> { loaded, rundowns[] }
 *   GET  {base}/data/automations       -> AutomationSettings
 *   POST {base}/data/automations       -> AutomationSettings (replaces settings wholesale)
 */

import {
  AUX_AUTOMATION_PREFIX,
  type AuxAutomationBundle,
  type OntimeAutomation,
  type OntimeTrigger,
} from '@shared/showflow';

const TIMEOUT_MS = 8000;

export function normaliseBaseUrl(raw: string): string {
  let url = (raw ?? '').trim();
  if (!url) throw new OntimeError('No base URL set for this target. Add the Ontime address first.');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/(data|api)$/i, '');
  return url;
}

/** True when the URL points at a LAN / loopback address a cloud host can never reach. */
export function isPrivateHost(rawBaseUrl: string): boolean {
  try {
    const host = new URL(normaliseBaseUrl(rawBaseUrl)).hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local')) return true;
    return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  } catch {
    return false;
  }
}

export class OntimeError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OntimeError';
    this.status = status;
  }
}

interface RequestOptions {
  baseUrl: string;
  token?: string | null;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

export async function ontimeRequest<T>({
  baseUrl,
  token,
  path,
  method = 'GET',
  body,
}: RequestOptions): Promise<T> {
  const base = normaliseBaseUrl(baseUrl);
  const url = new URL(`${base}${path}`);
  const cleanToken = (token ?? '').trim();
  if (cleanToken) url.searchParams.set('token', cleanToken);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cleanToken) headers.Authorization = `Bearer ${cleanToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const cause = err as Error & { cause?: { code?: string } };
    if (cause.name === 'AbortError') {
      throw new OntimeError(
        `Timed out after ${TIMEOUT_MS / 1000}s reaching ${base}. Is Ontime running and reachable from this machine?`,
      );
    }
    const code = cause.cause?.code ?? '';
    if (code === 'ECONNREFUSED') {
      throw new OntimeError(
        `Connection refused at ${base}. Start Ontime on that machine (or check the port — Ontime's default API port is 4001).`,
      );
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      throw new OntimeError(`Host not found for ${base}. Check the address for typos.`);
    }
    throw new OntimeError(`Could not reach ${base}: ${cause.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new OntimeError(
        `Ontime rejected the credentials (HTTP ${res.status}). Check the API token for this target.`,
        res.status,
      );
    }
    if (res.status === 404) {
      if (path === '/data/rundowns/import') {
        throw new OntimeError(
          `This Ontime instance is reachable but has no rundown-import API — that endpoint was added in Ontime v4.11.0 (July 2026). ` +
            `Reading rundowns is an older API, which is why Test connection works. ` +
            `Update Ontime to v4.11 or newer (https://www.getontime.no/), then sync again.`,
          404,
        );
      }
      throw new OntimeError(
        `Ontime returned 404 for ${path}. This usually means the address points at something other than an Ontime v4 server, or an Ontime version older than v4.11.`,
        404,
      );
    }
    let message = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text);
      message = parsed.message ?? message;
    } catch {
      /* keep raw text */
    }
    throw new OntimeError(`Ontime error (HTTP ${res.status}): ${message}`, res.status);
  }

  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new OntimeError(
      `Ontime returned a non-JSON response from ${path}. The address may point at the Ontime web UI rather than its API port.`,
    );
  }
}

export interface RundownSummary {
  id: string;
  title: string;
  numEntries?: number;
  [key: string]: unknown;
}

export interface ProjectRundownsList {
  loaded: string;
  rundowns: RundownSummary[];
}

export const getRundowns = (baseUrl: string, token?: string | null) =>
  ontimeRequest<ProjectRundownsList>({ baseUrl, token, path: '/data/rundowns' });

export const getCurrentRundown = (baseUrl: string, token?: string | null) =>
  ontimeRequest<{
    id: string;
    title: string;
    order?: string[];
    flatOrder?: string[];
    entries?: Record<string, any>;
    revision?: number;
  }>({ baseUrl, token, path: '/data/rundowns/current' });

export const getRundownById = (baseUrl: string, token: string | null | undefined, id: string) =>
  ontimeRequest<{
    id: string;
    title: string;
    order?: string[];
    flatOrder?: string[];
    entries?: Record<string, any>;
    revision?: number;
  }>({ baseUrl, token, path: `/data/rundowns/${encodeURIComponent(id)}` });

export const getCustomFields = (baseUrl: string, token?: string | null) =>
  ontimeRequest<Record<string, unknown>>({ baseUrl, token, path: '/data/custom-fields' });

export type ImportMode = 'override' | 'merge' | 'new';

export function importRundown(
  baseUrl: string,
  token: string | null | undefined,
  payload: {
    mode: ImportMode;
    targetRundownId?: string;
    rundown: {
      entries: Record<string, unknown>;
      order: string[];
      flatOrder: string[];
      /** Only honoured for mode: 'new' — Ontime keeps the existing title on override/merge. */
      title?: string;
    };
    customFields: Record<string, unknown>;
    providedFields?: { event: string[]; custom: string[] };
  },
) {
  return ontimeRequest<ProjectRundownsList>({
    baseUrl,
    token,
    path: '/data/rundowns/import',
    method: 'POST',
    body: payload,
  });
}

/* --------------------------------------------------------- automations */

export interface AutomationSettings {
  enabledAutomations: boolean;
  enabledOscIn: boolean;
  oscPortIn: number;
  triggers: OntimeTrigger[];
  automations: Record<string, OntimeAutomation>;
}

export const getAutomationSettings = (baseUrl: string, token?: string | null) =>
  ontimeRequest<AutomationSettings>({ baseUrl, token, path: '/data/automations' });

export const postAutomationSettings = (
  baseUrl: string,
  token: string | null | undefined,
  body: AutomationSettings,
) =>
  ontimeRequest<AutomationSettings>({
    baseUrl,
    token,
    path: '/data/automations',
    method: 'POST',
    body,
  });

const isOurs = (title: unknown) =>
  typeof title === 'string' && title.startsWith(AUX_AUTOMATION_PREFIX);

/**
 * Pushes the aux-timer automations generated from the sheet to an Ontime instance.
 *
 * Uses the granular endpoints (create/delete one automation or trigger at a time),
 * exactly like Ontime's own settings UI. The wholesale settings POST cannot be used
 * for this: its validator runs the single-automation parser against the whole
 * automations record, so any bulk payload is rejected with HTTP 422 (verified in
 * automation.validation.ts, Ontime v4 master).
 *
 * Order matters: Ontime refuses to delete an automation that a trigger still
 * references, so stale triggers go first, then stale automations. Only entries a
 * previous sync created (title starts with the Mosc-sync prefix) are touched —
 * hand-made automations and the OSC-input configuration are preserved. Automations
 * only fire when enabledAutomations is true, so it is switched on when we push any.
 */
export async function syncAuxAutomations(
  baseUrl: string,
  token: string | null | undefined,
  bundle: AuxAutomationBundle,
): Promise<{ written: number; removedStale: number; enabled: boolean }> {
  const existing = await getAutomationSettings(baseUrl, token);
  const existingAutomations = existing.automations ?? {};

  // 1. delete stale triggers first (an automation in use by a trigger cannot be deleted)
  for (const trigger of existing.triggers ?? []) {
    const target = existingAutomations[trigger?.automationId ?? ''];
    if (isOurs(trigger?.title) || isOurs(target?.title)) {
      await ontimeRequest<void>({
        baseUrl,
        token,
        path: `/data/automations/trigger/${encodeURIComponent(trigger.id)}`,
        method: 'DELETE',
      });
    }
  }

  // 2. delete stale automations
  let removedStale = 0;
  for (const [id, automation] of Object.entries(existingAutomations)) {
    if (isOurs(automation?.title)) {
      await ontimeRequest<void>({
        baseUrl,
        token,
        path: `/data/automations/automation/${encodeURIComponent(id)}`,
        method: 'DELETE',
      });
      removedStale++;
    }
  }

  // 3. create each automation (Ontime assigns the id), then its trigger(s)
  let written = 0;
  for (const automation of Object.values(bundle.automations)) {
    const created = await ontimeRequest<OntimeAutomation>({
      baseUrl,
      token,
      path: '/data/automations/automation',
      method: 'POST',
      body: {
        title: automation.title,
        filterRule: automation.filterRule,
        filters: automation.filters,
        outputs: automation.outputs,
      },
    });
    for (const trigger of bundle.triggers.filter((t) => t.automationId === automation.id)) {
      await ontimeRequest<OntimeTrigger>({
        baseUrl,
        token,
        path: '/data/automations/trigger',
        method: 'POST',
        body: { title: trigger.title, trigger: trigger.trigger, automationId: created.id },
      });
    }
    written++;
  }

  // 4. make sure automations actually fire (root-properties-only settings patch)
  const enabled = written > 0 ? true : (existing.enabledAutomations ?? false);
  if (written > 0 || removedStale > 0) {
    await ontimeRequest<AutomationSettings>({
      baseUrl,
      token,
      path: '/data/automations',
      method: 'POST',
      body: {
        enabledAutomations: enabled,
        enabledOscIn: existing.enabledOscIn ?? false,
        oscPortIn: existing.oscPortIn ?? 8888,
      },
    });
  }

  return { written, removedStale, enabled };
}
