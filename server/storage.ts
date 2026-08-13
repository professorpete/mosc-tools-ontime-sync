import type {
  Settings,
  UpdateSettings,
  Session,
  Target,
  InsertTarget,
  UpdateTarget,
  SyncLogEntry,
  InsertSyncLog,
} from '@shared/schema';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* ---------------------------------------------------------------- data dir
 * Local Windows app: %APPDATA%\MoscTools\OntimeSync\data.json
 * Hosted / dev:      ./data.json (or SHOWFLOW_DATA=<dir> override)
 */
function dataDir(): string {
  if (process.env.SHOWFLOW_DATA) return process.env.SHOWFLOW_DATA;
  // Only use AppData when running as a packaged executable — hosted installs
  // keep the file next to the app so redeploys behave as before.
  const isPackaged = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
  if (isPackaged) {
    const base =
      process.platform === 'win32'
        ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
        : path.join(os.homedir(), '.config');
    return path.join(base, 'MoscTools', 'OntimeSync');
  }
  return process.cwd();
}

interface DataFile {
  seq: number;
  sessions: Session[];
  settings: Settings[];
  targets: Target[];
  syncLog: SyncLogEntry[];
}

const EMPTY: DataFile = { seq: 0, sessions: [], settings: [], targets: [], syncLog: [] };

const dir = dataDir();
const FILE = path.join(dir, 'data.json');

function load(): DataFile {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as Partial<DataFile>;
    return {
      seq: typeof raw.seq === 'number' ? raw.seq : 0,
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
      settings: Array.isArray(raw.settings) ? raw.settings : [],
      targets: Array.isArray(raw.targets) ? raw.targets : [],
      syncLog: Array.isArray(raw.syncLog) ? raw.syncLog : [],
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

const db: DataFile = load();

/** Atomic-ish save: write a temp file, then rename over the real one. */
function save() {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('Could not save data file:', err);
  }
}

function nextId(): number {
  db.seq += 1;
  return db.seq;
}

export const DEFAULT_SETTINGS: UpdateSettings = {
  sheetId: '',
  tabName: '',
  showName: '',
};

const DEFAULT_TARGETS: InsertTarget[] = [
  { name: 'Ontime Cloud', baseUrl: '', authToken: null },
  { name: 'Ontime (local)', baseUrl: 'http://localhost:4001', authToken: null },
];

/** Sessions idle longer than this are wiped (settings, targets, history). */
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);

export interface IStorage {
  touchSession(sessionId: string): void;
  cleanupSessions(): number;
  getSettings(sessionId: string): Settings;
  updateSettings(sessionId: string, patch: UpdateSettings): Settings;
  listTargets(sessionId: string): Target[];
  getTarget(sessionId: string, id: number): Target | undefined;
  createTarget(sessionId: string, target: InsertTarget): Target;
  updateTarget(sessionId: string, id: number, patch: UpdateTarget): Target | undefined;
  deleteTarget(sessionId: string, id: number): boolean;
  markSync(id: number, timestamp: string, status: 'success' | 'error'): void;
  addSyncLog(entry: InsertSyncLog): SyncLogEntry;
  listSyncLog(targetId: number, limit?: number): SyncLogEntry[];
}

export class JsonStorage implements IStorage {
  /** Register/refresh the session and lazily seed its defaults. */
  touchSession(sessionId: string): void {
    const now = new Date().toISOString();
    const existing = db.sessions.find((s) => s.id === sessionId);
    if (existing) {
      existing.lastSeenAt = now;
    } else {
      db.sessions.push({ id: sessionId, createdAt: now, lastSeenAt: now });
    }
    if (!db.settings.some((s) => s.sessionId === sessionId)) {
      db.settings.push({ id: nextId(), sessionId, ...DEFAULT_SETTINGS });
    }
    if (!db.targets.some((t) => t.sessionId === sessionId)) {
      for (const t of DEFAULT_TARGETS) {
        db.targets.push({
          id: nextId(),
          sessionId,
          name: t.name,
          baseUrl: t.baseUrl ?? '',
          authToken: t.authToken ?? null,
          lastSyncAt: null,
          lastSyncStatus: null,
        });
      }
    }
    save();
  }

  /** Delete sessions idle beyond the TTL, along with everything they own. */
  cleanupSessions(): number {
    const cutoff = new Date(Date.now() - SESSION_TTL_DAYS * 86_400_000).toISOString();
    const staleIds = new Set(db.sessions.filter((s) => s.lastSeenAt < cutoff).map((s) => s.id));
    if (staleIds.size === 0) return 0;
    const staleTargetIds = new Set(
      db.targets.filter((t) => staleIds.has(t.sessionId)).map((t) => t.id),
    );
    db.syncLog = db.syncLog.filter((l) => !staleTargetIds.has(l.targetId));
    db.targets = db.targets.filter((t) => !staleIds.has(t.sessionId));
    db.settings = db.settings.filter((s) => !staleIds.has(s.sessionId));
    db.sessions = db.sessions.filter((s) => !staleIds.has(s.id));
    save();
    return staleIds.size;
  }

  getSettings(sessionId: string): Settings {
    let row = db.settings.find((s) => s.sessionId === sessionId);
    if (!row) {
      row = { id: nextId(), sessionId, ...DEFAULT_SETTINGS };
      db.settings.push(row);
      save();
    }
    return row;
  }

  updateSettings(sessionId: string, patch: UpdateSettings): Settings {
    const row = this.getSettings(sessionId);
    Object.assign(row, patch);
    save();
    return row;
  }

  listTargets(sessionId: string): Target[] {
    return db.targets.filter((t) => t.sessionId === sessionId).sort((a, b) => a.id - b.id);
  }

  getTarget(sessionId: string, id: number): Target | undefined {
    return db.targets.find((t) => t.id === id && t.sessionId === sessionId);
  }

  createTarget(sessionId: string, target: InsertTarget): Target {
    const row: Target = {
      id: nextId(),
      sessionId,
      name: target.name,
      baseUrl: target.baseUrl ?? '',
      authToken: target.authToken ?? null,
      lastSyncAt: null,
      lastSyncStatus: null,
    };
    db.targets.push(row);
    save();
    return row;
  }

  updateTarget(sessionId: string, id: number, patch: UpdateTarget): Target | undefined {
    const row = this.getTarget(sessionId, id);
    if (!row) return undefined;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.baseUrl !== undefined) row.baseUrl = patch.baseUrl;
    if (patch.authToken !== undefined) row.authToken = patch.authToken ?? null;
    save();
    return row;
  }

  deleteTarget(sessionId: string, id: number): boolean {
    const before = db.targets.length;
    db.targets = db.targets.filter((t) => !(t.id === id && t.sessionId === sessionId));
    const removed = db.targets.length < before;
    if (removed) {
      db.syncLog = db.syncLog.filter((l) => l.targetId !== id);
      save();
    }
    return removed;
  }

  markSync(id: number, timestamp: string, status: 'success' | 'error'): void {
    const row = db.targets.find((t) => t.id === id);
    if (!row) return;
    row.lastSyncAt = timestamp;
    row.lastSyncStatus = status;
    save();
  }

  addSyncLog(entry: InsertSyncLog): SyncLogEntry {
    const row: SyncLogEntry = { id: nextId(), ...entry };
    db.syncLog.push(row);
    // keep the log bounded — this is a utility, not an audit system
    if (db.syncLog.length > 2000) db.syncLog = db.syncLog.slice(-1000);
    save();
    return row;
  }

  listSyncLog(targetId: number, limit = 5): SyncLogEntry[] {
    return db.syncLog
      .filter((l) => l.targetId === targetId)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }
}

export const storage = new JsonStorage();
