import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { jwtDecode } from 'jwt-decode';
import { clearToken, getToken } from './lib/api';

export type UserRole = 'owner' | 'finance' | 'guest';

interface TokenPayload {
  role?: unknown;
}

interface AuthContextValue {
  role: UserRole | null;
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

  useEffect(() => {
    const token = getToken();
    if (token && !readRole(token)) clearToken();

    const onUnauthorized = () => {
      clearToken();
      setRole(null);
    };
    window.addEventListener('wd:unauthorized', onUnauthorized);
    return () => window.removeEventListener('wd:unauthorized', onUnauthorized);
  }, []);

  const value = useMemo(() => ({ role }), [role]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return context;
}
