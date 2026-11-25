import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { jwtDecode } from 'jwt-decode';
import { api, clearToken, getToken } from './lib/api';

export type UserRole = 'owner' | 'finance' | 'guest';

interface TokenPayload {
  role?: unknown;
}

interface AuthContextValue {
  role: UserRole | null;
  isPrimaryOwner: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isUserRole(value: unknown): value is UserRole {
  return value === 'owner' || value === 'finance' || value === 'guest';
}

function readRole(token: string): UserRole | null {
  if (!token) return null;

  try {
    const payload = jwtDecode<TokenPayload>(token);
    return isUserRole(payload.role) ? payload.role : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<UserRole | null>(() => readRole(getToken()));
  const [isPrimaryOwner, setIsPrimaryOwner] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (token && !readRole(token)) clearToken();

    const onUnauthorized = () => {
      clearToken();
      setRole(null);
      setIsPrimaryOwner(false);
    };
    window.addEventListener('wd:unauthorized', onUnauthorized);
    return () => window.removeEventListener('wd:unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    if (role !== 'owner') {
      setIsPrimaryOwner(false);
      return;
    }

    let active = true;
    api<{ isPrimaryOwner: boolean }>('/auth/permissions')
      .then(({ isPrimaryOwner: primaryOwner }) => {
        if (active) setIsPrimaryOwner(primaryOwner);
      })
      .catch((cause) => {
        if (!active) return;
        setIsPrimaryOwner(false);
        console.warn('[auth] não foi possível verificar o proprietário principal:', cause);
      });

    return () => { active = false; };
  }, [role]);

  const value = useMemo(() => ({ role, isPrimaryOwner }), [role, isPrimaryOwner]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return context;
}
