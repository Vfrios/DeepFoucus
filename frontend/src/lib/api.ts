const KEY = 'wd:token';

/** Permite configurar o token uma vez via URL: /?token=XYZ (depois é removido da barra). */
export function captureTokenFromUrl() {
  const u = new URL(location.href);
  const t = u.searchParams.get('token');
  if (t) {
    localStorage.setItem(KEY, t);
    u.searchParams.delete('token');
    history.replaceState(null, '', u.toString());
  }
}
export const getToken = () => localStorage.getItem(KEY) || '';
export const setToken = (t: string) => localStorage.setItem(KEY, t.trim());

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...(init.headers || {}) },
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event('wd:unauthorized'));
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.status === 204 ? (undefined as T) : res.json();
}
