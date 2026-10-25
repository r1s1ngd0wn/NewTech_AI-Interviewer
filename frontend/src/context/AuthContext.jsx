import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, AUTH_EXPIRED_EVENT } from '../lib/api.js';
import { supabase, requireSupabase, previewAuth } from '../lib/supabase.js';
import { useRef } from 'react';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const lifecycle = useRef({ epoch: 0, mounted: false, userId: null, logoutPending: false, pendingAuth: false });
  function isCurrent(epoch, candidateId) {
    const state = lifecycle.current;
    return state.mounted && state.epoch === epoch && !state.logoutPending &&
      (!candidateId || !state.userId || candidateId === state.userId);
  }
  function applyUser(currentUser, epoch) {
    if (!isCurrent(epoch, currentUser?.id)) return false;
    lifecycle.current.userId = currentUser?.id || null;
    setUser(currentUser || null);
    return true;
  }
  function beginAuthTransition() {
    const state = lifecycle.current;
    state.epoch++;
    state.userId = null;
    state.logoutPending = false;
    state.pendingAuth = true;
    setUser(null);
    return state.epoch;
  }
  useEffect(() => {
    let cancelled = false;
    lifecycle.current.mounted = true;
    async function sync(checkCallback = false) {
      const current = lifecycle.current.epoch;
      const callbackParams = new URLSearchParams(window.location.search);
      const hasCallback = checkCallback && !previewAuth && ['code', 'error', 'error_code', 'error_description'].some(key => callbackParams.has(key));
      try {
        if (checkCallback && !previewAuth && supabase) {
          const initialized = await supabase.auth.initialize();
          if (initialized?.error) {
            if (!cancelled && isCurrent(current)) {
              setUser(null);
              lifecycle.current.userId = null;
              setAuthError('Google sign-in could not be completed. Please try again.');
            }
            return;
          }
        }
        const token = await getToken();
        const result = token ? await api.me() : null;
        if (!cancelled && applyUser(result?.user || null, current)) {
          if (result?.user) setAuthError('');
          else if (hasCallback) setAuthError('Google sign-in could not be completed. Please try again.');
        }
      } catch {
        if (!cancelled && isCurrent(current)) {
          setUser(null);
          lifecycle.current.userId = null;
          setAuthError('Could not load your account. Please try signing in again.');
        }
      } finally { if (!cancelled && isCurrent(current)) setLoading(false); }
    }
    sync(true);
    const subscription = !previewAuth && supabase?.auth.onAuthStateChange((event, session) => {
      // Bootstrap already awaits initialization. Repeating it for INITIAL_SESSION
      // can race with the callback error and hide its explanation.
      if (event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT') {
        lifecycle.current.epoch++;
        lifecycle.current.userId = null;
        lifecycle.current.logoutPending = false;
        lifecycle.current.pendingAuth = false;
        setUser(null); setLoading(false);
      } else {
        const incomingUserId = session?.user?.id || null;
        if (event === 'SIGNED_IN' && incomingUserId) {
          if (lifecycle.current.userId && incomingUserId !== lifecycle.current.userId) lifecycle.current.epoch++;
          else if (!lifecycle.current.userId && !lifecycle.current.pendingAuth) lifecycle.current.epoch++;
          lifecycle.current.userId = incomingUserId;
          lifecycle.current.pendingAuth = false;
        }
        setTimeout(() => { if (!cancelled) sync(); }, 0);
      }
    });
    const expired = () => {
      lifecycle.current.epoch++;
      lifecycle.current.userId = null;
      lifecycle.current.logoutPending = false;
      lifecycle.current.pendingAuth = false;
      setUser(null); setLoading(false); setToken(null);
      if (!previewAuth && supabase) supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    return () => {
      cancelled = true;
      lifecycle.current.mounted = false;
      lifecycle.current.epoch++;
      lifecycle.current.userId = null;
      lifecycle.current.pendingAuth = false;
      subscription?.data.subscription.unsubscribe();
      window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
    };
  }, []);
  const refreshUser = useCallback(async () => {
    const current = lifecycle.current.epoch;
    const expectedUserId = lifecycle.current.userId;
    const { user: currentUser } = await api.me();
    if (!isCurrent(current, expectedUserId) || !applyUser(currentUser, current)) return null;
    return currentUser;
  }, []);
  const login = useCallback(async (email, password) => {
    setAuthError('');
    const current = beginAuthTransition();
    if (previewAuth) {
      const r = await api.login({ email, password });
      if (!isCurrent(current, r.user?.id)) throw new Error('Authentication changed before sign-in completed. Please try again.');
      lifecycle.current.pendingAuth = false;
      setToken(r.token); applyUser(r.user, current);
      return r.user;
    }
    try {
      const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!isCurrent(current, data?.user?.id)) throw new Error('Authentication changed before sign-in completed. Please try again.');
      if (data?.user?.id) lifecycle.current.userId = data.user.id;
      lifecycle.current.pendingAuth = false;
      const currentUser = await refreshUser();
      if (!currentUser) throw new Error('Authentication changed before sign-in completed. Please try again.');
      return currentUser;
    } catch (error) {
      if (lifecycle.current.epoch === current) lifecycle.current.pendingAuth = false;
      throw error;
    }
  }, [refreshUser]);
  const loginGoogle = useCallback(async () => {
    setAuthError('');
    const current = beginAuthTransition();
    try {
      const { error } = await requireSupabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/login` } });
      if (error) throw error;
    } catch (error) {
      if (lifecycle.current.epoch === current) lifecycle.current.pendingAuth = false;
      throw error;
    }
  }, []);
  const register = useCallback(async (email, password, name) => {
    setAuthError('');
    const current = beginAuthTransition();
    if (previewAuth) {
      const r = await api.register({ email, password, name });
      if (!isCurrent(current, r.user?.id)) throw new Error('Authentication changed before registration completed. Please try again.');
      lifecycle.current.pendingAuth = false;
      setToken(r.token); applyUser(r.user, current);
      return r.user;
    }
    try {
      const { data, error } = await requireSupabase().auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: `${window.location.origin}/login` } });
      if (error) throw error;
      if (!isCurrent(current, data?.user?.id)) throw new Error('Authentication changed before registration completed. Please try again.');
      if (!data.session) { lifecycle.current.pendingAuth = false; return { confirmationRequired: true }; }
      if (data?.user?.id) lifecycle.current.userId = data.user.id;
      lifecycle.current.pendingAuth = false;
      const currentUser = await refreshUser();
      if (!currentUser) throw new Error('Authentication changed before registration completed. Please try again.');
      return currentUser;
    } catch (error) {
      if (lifecycle.current.epoch === current) lifecycle.current.pendingAuth = false;
      throw error;
    }
  }, [refreshUser]);
  const logout = useCallback(async () => {
    // Server invalidation must succeed before claiming a secure logout.
    const state = lifecycle.current;
    const previousUserId = state.userId || user?.id || null;
    const current = ++state.epoch;
    state.logoutPending = true;
    state.pendingAuth = false;
    try {
      await api.logout();
      if (!previewAuth) {
        const { error } = await requireSupabase().auth.signOut({ scope: 'local' });
        if (error) throw error;
      }
      if (state.epoch === current && state.mounted) {
        state.logoutPending = false;
        state.userId = null;
        setToken(null); setUser(null);
      }
    } catch (error) {
      if (state.epoch === current) {
        state.logoutPending = false;
        state.userId = previousUserId;
      }
      throw error;
    }
  }, [user]);
  const updateProfile = useCallback(async patch => {
    const current = lifecycle.current.epoch;
    const expectedUserId = lifecycle.current.userId || user?.id;
    const { user: currentUser } = await api.updateProfile(patch);
    if (!isCurrent(current, expectedUserId) || !applyUser(currentUser, current)) return null;
    return currentUser;
  }, [user]);
  return <AuthContext.Provider value={{ user, loading, authError, login, loginGoogle, register, logout, refreshUser, updateProfile }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used inside AuthProvider'); return value; }
