import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken } from './api';
import type { Lookups, Me } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>('/auth/me');
      setCsrfToken(m.csrfToken);
      setMe(m);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setMe(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    void refresh();
    const onSignedOut = () => {
      setMe(null);
      qc.clear();
    };
    window.addEventListener('stja:signed-out', onSignedOut);
    return () => window.removeEventListener('stja:signed-out', onSignedOut);
  }, [refresh, qc]);

  const can = useCallback((p: string) => !!me?.permissions.includes(p), [me]);
  return <AuthContext.Provider value={{ me, loading, can, refresh, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** All dropdown values, straight from Setup (FR-102). Refetched after any Setup change (FR-103). */
export function useLookups() {
  const q = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/setup/lookups'), staleTime: 60_000 });
  const data = q.data;
  const label = (list: string, code: string | null | undefined) => {
    if (!code) return '';
    return data?.lists[list]?.find((v) => v.code === code)?.label ?? code;
  };
  const options = (list: string, includeInactive = false) =>
    (data?.lists[list] ?? []).filter((v) => includeInactive || v.active).map((v) => ({ value: v.code, label: v.label }));
  return { ...q, lookups: data, label, options };
}
