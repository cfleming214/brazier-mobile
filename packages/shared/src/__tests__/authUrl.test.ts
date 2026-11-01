import { describe, expect, it } from 'vitest';
import { parseAuthCallback } from '../authUrl';

describe('parseAuthCallback', () => {
  it('reads a PKCE code', () => {
    expect(parseAuthCallback('drophawk://auth-callback?code=abc123')).toEqual({
      kind: 'code',
      code: 'abc123',
    });
  });
  it('reads implicit-flow tokens from the fragment', () => {
    expect(
      parseAuthCallback('drophawk://auth-callback#access_token=AT&refresh_token=RT&type=magiclink'),
    ).toEqual({ kind: 'tokens', accessToken: 'AT', refreshToken: 'RT' });
  });
  it('reads tokens when both query and fragment exist', () => {
    expect(
      parseAuthCallback(
        'exp://192.168.1.2:8081/--/auth-callback?x=1#access_token=A&refresh_token=R',
      ),
    ).toEqual({ kind: 'tokens', accessToken: 'A', refreshToken: 'R' });
  });
  it('surfaces errors', () => {
    expect(
      parseAuthCallback(
        'drophawk://auth-callback#error=access_denied&error_description=Email+link+is+invalid',
      ),
    ).toEqual({ kind: 'error', message: 'Email link is invalid' });
  });
  it('reports a missing token', () => {
    expect(parseAuthCallback('drophawk://auth-callback').kind).toBe('error');
  });
});
