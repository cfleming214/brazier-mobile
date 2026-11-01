import { parseAuthCallback } from '@drophawk/shared';
import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

type AuthState = { session: Session | null; loading: boolean };

const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      setState({ session, loading: false }),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Deep link the magic link email returns to. */
export const authRedirectUrl = () => Linking.createURL('auth-callback');

/** Send a magic link + one-time code to the email address. */
export async function sendSignInEmail(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: authRedirectUrl(), shouldCreateUser: true },
  });
  if (error) throw error;
}

/** Verify the 6-digit code from the email. */
export async function verifyEmailCode(email: string, token: string) {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });
  if (error) throw error;
}

/** Complete sign-in from a magic link URL (PKCE code or implicit-flow tokens). */
export async function completeSignInFromUrl(url: string) {
  const result = parseAuthCallback(url);
  if (result.kind === 'error') throw new Error(result.message);
  const { error } =
    result.kind === 'code'
      ? await supabase.auth.exchangeCodeForSession(result.code)
      : await supabase.auth.setSession({
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
        });
  if (error) throw error;
}

export const signOut = () => supabase.auth.signOut();
