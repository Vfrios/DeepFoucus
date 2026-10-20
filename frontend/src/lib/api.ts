const KEY = 'wd:jwt';

export function captureJwtFromUrl(): 'success' | 'error' | null {
  const url = new URL(location.href);
  const token = url.searchParams.get('jwt');
  const status = url.searchParams.get('login');
  localStorage.removeItem('wd:token');
  if (token) localStorage.setItem(KEY, token);
  if (token || status) {
    url.searchParams.delete('jwt');
    url.searchParams.delete('login');
    history.replaceState(null, '', url.toString());
  }
  if (token) return 'success';
  return status === 'error' ? 'error' : null;
}

export const getToken = () => localStorage.getItem(KEY) || '';
export const setToken = (token: string) => localStorage.setItem(KEY, token.trim());
export const clearToken = () => localStorage.removeItem(KEY);

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else headers.delete('Authorization');

  const res = await fetch('/api' + path, { ...init, headers });
  if (res.status === 401) {
    window.dispatchEvent(new Event('wd:unauthorized'));
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.status === 204 ? (undefined as T) : res.json();
}
