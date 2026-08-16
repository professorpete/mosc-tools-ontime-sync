import { apiRequest } from '@/lib/queryClient';
import type {
  ParseWarning,
  ShowFlowRow,
  OntimeCustomField,
  RundownDiff,
} from '@shared/showflow';
import type { Target, SyncLogEntry, Settings } from '@shared/schema';

export interface ShowFlowSnapshot {
  fetchedAt: string;
  sheetId: string;
  tabName: string;
  showName: string;
  sheetUrl: string;
  csvUrl: string;
  headerRow: number;
  columnsFound: string[];
  warnings: ParseWarning[];
  validationProblems: string[];
  rows: ShowFlowRow[];
  customFields: Record<string, OntimeCustomField>;
  customFieldOrder: string[];
  entryCount: number;
}

export interface TargetWithHistory extends Target {
  history: SyncLogEntry[];
}

export interface TestResult {
  ok: true;
  baseUrl: string;
  loadedRundownId: string;
  loadedRundownTitle: string | null;
  rundowns: Array<{ id: string; title: string; numEntries?: number }>;
  customFieldCount: number | null;
}

export interface DiffResult {
  targetId: number;
  checkedAt: string;
  targetRundownId: string;
  targetRundownTitle: string | null;
  targetEntryCount: number;
  generatedEntryCount: number;
  diff: RundownDiff;
}

export interface SyncSummary {
  mode: 'override' | 'merge' | 'new';
  targetRundownId: string | null;
  rundownTitle: string | null;
  total: number;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}

export interface SyncResult {
  ok: true;
  mode: 'override' | 'merge' | 'new';
  targetRundownId: string | null;
  rundownTitle: string | null;
  summary: SyncSummary;
}

export interface NewRundownName {
  base: string;
  title: string;
  existingCount: number;
}

/** Parse a sync_log row's summary JSON, tolerating older/error rows. */
export function parseSyncSummary(raw: string | null): Partial<SyncSummary> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<SyncSummary>;
  } catch {
    return null;
  }
}

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  return (await res.json()) as T;
}

export const api = {
  getSettings: () => json<Settings>('GET', '/api/settings'),
  saveSettings: (body: { sheetId: string; tabName: string; showName: string }) =>
    json<Settings>('PATCH', '/api/settings', body),
  resetAll: () => json<{ ok: true }>('POST', '/api/reset'),
  getSheetTabs: (sheetId: string) =>
    json<{ tabs: string[] }>('GET', `/api/sheet-tabs?sheetId=${encodeURIComponent(sheetId)}`),
  getSnapshot: () => json<ShowFlowSnapshot | null>('GET', '/api/showflow'),
  fetchSheet: () => json<ShowFlowSnapshot>('POST', '/api/showflow/fetch'),
  getTargets: () => json<TargetWithHistory[]>('GET', '/api/targets'),
  createTarget: (body: { name: string; baseUrl: string; authToken?: string | null }) =>
    json<Target>('POST', '/api/targets', body),
  updateTarget: (
    id: number,
    body: { name?: string; baseUrl?: string; authToken?: string | null },
  ) => json<Target>('PATCH', `/api/targets/${id}`, body),
  deleteTarget: (id: number) => json<{ ok: true }>('DELETE', `/api/targets/${id}`),
  testTarget: (id: number) => json<TestResult>('POST', `/api/targets/${id}/test`),
  diffTarget: (id: number) => json<DiffResult>('POST', `/api/targets/${id}/diff`),
  newRundownName: (id: number) =>
    json<NewRundownName>('GET', `/api/targets/${id}/new-rundown-name`),
  syncTarget: (id: number, body: { mode: 'override' | 'merge' | 'new'; targetRundownId?: string }) =>
    json<SyncResult>('POST', `/api/targets/${id}/sync`, body),
};

/** Turn a thrown apiRequest error ("502: {json}") into a readable message. */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.match(/^\d{3}:\s*([\s\S]*)$/);
  const body = m ? m[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.message) return String(parsed.message);
  } catch {
    /* not json */
  }
  return body || 'Something went wrong';
}
