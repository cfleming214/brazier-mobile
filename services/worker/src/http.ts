export type FetchJson = <T = unknown>(url: string, init?: RequestInit) => Promise<T>;

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    body: string,
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
  }
}

/** fetch + JSON with a timeout and an identifying user agent. */
export function createFetchJson(userAgent: string, timeoutMs = 15_000): FetchJson {
  return async <T>(url: string, init: RequestInit = {}) => {
    const res = await fetch(url, {
      ...init,
      headers: { 'user-agent': userAgent, accept: 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
    return (await res.json()) as T;
  };
}
