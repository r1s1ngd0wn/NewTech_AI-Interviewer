import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, AUTH_EXPIRED_EVENT } from '../lib/api.js';
import { supabase, requireSupabase, previewAuth } from '../lib/supabase.js';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let version = 0;
    async function sync(checkCallback = false) {
      const current = ++version;
      const callbackParams = new URLSearchParams(window.location.search);
      const hasCallback = checkCallback && !previewAuth && ['code', 'error', 'error_code', 'error_description'].some(key => callbackParams.has(key));
      try {
        if (checkCallback && !previewAuth && supabase) {
          const initialized = await supabase.auth.initialize();
          if (initialized?.error) {
            if (!cancelled && current === version) {
              setUser(null);
              setAuthError('Google sign-in could not be completed. Please try again.');
            }
            return;
          }
        }
        const token = await getToken();
        const result = token ? await api.me() : null;
        if (!cancelled && current === version) {
          setUser(result?.user || null);
          if (result?.user) setAuthError('');
          else if (hasCallback) setAuthError('Google sign-in could not be completed. Please try again.');
        }
      } catch {
        if (!cancelled && current === version) {
          setUser(null);
          setAuthError('Could not load your account. Please try signing in again.');
        }
      } finally { if (!cancelled && current === version) setLoading(false); }
    }
    sync(true);
    const subscription = !previewAuth && supabase?.auth.onAuthStateChange((event) => {
      // Bootstrap already awaits initialization. Repeating it for INITIAL_SESSION
      // can race with the callback error and hide its explanation.
      if (event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT') { version++; setUser(null); setLoading(false); }
      else setTimeout(() => { if (!cancelled) sync(); }, 0);
    });
    const expired = () => {
      version++; setUser(null); setLoading(false); setToken(null);
      if (!previewAuth && supabase) supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    return () => { cancelled = true; subscription?.data.subscription.unsubscribe(); window.removeEventListener(AUTH_EXPIRED_EVENT, expired); };
  }, []);
  const refreshUser = useCallback(async () => { const { user } = await api.me(); setUser(user); return user; }, []);
  const login = useCallback(async (email, password) => {
    setAuthError('');
    if (previewAuth) { const r = await api.login({ email, password }); setToken(r.token); setUser(r.user); return r.user; }
    const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return refreshUser();
  }, [refreshUser]);
  const loginGoogle = useCallback(async () => {
    setAuthError('');
    const { error } = await requireSupabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/login` } });
    if (error) throw error;
  }, []);
  const register = useCallback(async (email, password, name) => {
    setAuthError('');
    if (previewAuth) { const r = await api.register({ email, password, name }); setToken(r.token); setUser(r.user); return r.user; }
    const { data, error } = await requireSupabase().auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: `${window.location.origin}/login` } });
    if (error) throw error;
    if (!data.session) return { confirmationRequired: true };
    return refreshUser();
  }, [refreshUser]);
  const logout = useCallback(async () => {
    // Server invalidation must succeed before claiming a secure logout.
    await api.logout();
    if (!previewAuth) { const { error } = await requireSupabase().auth.signOut({ scope: 'local' }); if (error) throw error; }
    setToken(null); setUser(null);
  }, []);
  const updateProfile = useCallback(async patch => { const { user } = await api.updateProfile(patch); setUser(user); return user; }, []);
  return <AuthContext.Provider value={{ user, loading, authError, login, loginGoogle, register, logout, refreshUser, updateProfile }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used inside AuthProvider'); return value; }
