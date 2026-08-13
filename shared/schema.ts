import { z } from 'zod';

/** Per-session app settings: which sheet is the source of truth for that user. */
export interface Settings {
  id: number;
  sessionId: string;
  sheetId: string;
  tabName: string;
  showName: string;
}

export const updateSettingsSchema = z.object({
  sheetId: z.string().trim().min(10, 'Sheet ID looks too short'),
  tabName: z.string().trim().min(1, 'Tab name is required'),
  showName: z.string().trim().min(1, 'Show name is required'),
});
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

/** Browser sessions — each visitor gets an isolated instance that expires when idle. */
export interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
}

/** An Ontime instance we can push to. */
export interface Target {
  id: number;
  sessionId: string;
  name: string;
  baseUrl: string;
  authToken: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
}

export const insertTargetSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  baseUrl: z
    .string()
    .trim()
    .default('')
    .refine(
      (v) => v === '' || /^https?:\/\/[^\s/]+/i.test(v),
      'Base URL must start with http:// or https:// — for example http://localhost:4001',
    ),
  authToken: z.string().trim().nullish(),
});
export type InsertTarget = z.infer<typeof insertTargetSchema>;
export const updateTargetSchema = insertTargetSchema.partial();
export type UpdateTarget = z.infer<typeof updateTargetSchema>;

/** Every manual sync attempt is recorded. */
export interface SyncLogEntry {
  id: number;
  targetId: number;
  timestamp: string;
  status: string; // success | error
  summary: string | null; // JSON text: {mode, added, changed, removed, total}
  errorMessage: string | null;
}

export type InsertSyncLog = Omit<SyncLogEntry, 'id'>;
