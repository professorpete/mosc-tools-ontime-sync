/**
 * Backend proxy for the Ontime v4 API. All calls to Ontime instances go through
 * here so the browser never hits CORS and tokens never leave the server.
 *
 * Routes verified against Ontime v4 source (rundown.router.ts / customFields.router.ts):
 *   GET  {base}/data/rundowns          -> { loaded, rundowns[] }
 *   GET  {base}/data/rundowns/current  -> normalised Rundown
 *   GET  {base}/data/custom-fields     -> CustomFields
 *   POST {base}/data/rundowns/import   -> { loaded, rundowns[] }
 */

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
  method?: 'GET' | 'POST';
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
      throw new OntimeError(
        `Ontime returned 404 for ${path}. This usually means the address points at something other than an Ontime v4 server.`,
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
