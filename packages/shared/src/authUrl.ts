export type AuthCallback =
  | { kind: 'code'; code: string }
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string };

/**
 * Parse the URL a Supabase magic link redirects to. Handles the PKCE `?code=` form,
 * the implicit `#access_token=...&refresh_token=...` form, and `error_description`.
 */
export function parseAuthCallback(url: string): AuthCallback {
  const params = new URLSearchParams();
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  const query = q >= 0 ? url.slice(q + 1, h > q ? h : undefined) : '';
  const hash = h >= 0 ? url.slice(h + 1) : '';
  for (const part of [query, hash]) {
    new URLSearchParams(part).forEach((v, k) => params.set(k, v));
  }

  const err = params.get('error_description') ?? params.get('error');
  if (err) return { kind: 'error', message: err.replace(/\+/g, ' ') };

  const code = params.get('code');
  if (code) return { kind: 'code', code };

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken };

  return { kind: 'error', message: 'This sign-in link is missing its token. Request a new one.' };
}
