import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// Each browser gets its own isolated instance. The client owns the session
// id: it is created once, persisted in a cookie where the environment allows,
// and sent as x-session-id on every request. This avoids a race
// where parallel first requests each mint a different server-side session.
function readCookieSid(): string | null {
  try {
    return document.cookie.match(/(?:^|;\s*)mosctools_sid=([^;\s]+)/)?.[1] ?? null;
  } catch {
    return null; /* sandboxed iframe blocks cookies */
  }
}

function persistSid(sid: string) {
  try {
    document.cookie = `mosctools_sid=${sid}; path=/; max-age=${30 * 86400}; SameSite=Lax`;
  } catch {
    /* fine — in-memory id still keeps this page load consistent */
  }
}

let sessionId: string =
  readCookieSid() ??
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `sid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
persistSid(sessionId);

function sessionHeaders(): Record<string, string> {
  return { "x-session-id": sessionId };
}

function captureSession(res: Response) {
  const sid = res.headers.get("x-session-id");
  if (sid && sid !== sessionId) {
    sessionId = sid;
    persistSid(sid);
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: { ...sessionHeaders(), ...(data ? { "Content-Type": "application/json" } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });

  captureSession(res);
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { headers: sessionHeaders() });

    captureSession(res);
    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
