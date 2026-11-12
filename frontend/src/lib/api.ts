const KEY = 'wd:jwt';
const FALLBACK_KEYS = ['token', 'wd:token'] as const;
const NETWORK_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

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

export const getToken = () =>
  localStorage.getItem(KEY) || FALLBACK_KEYS.map((key) => localStorage.getItem(key)).find(Boolean) || '';
export const setToken = (token: string) => localStorage.setItem(KEY, token.trim());
export const clearToken = () => {
  localStorage.removeItem(KEY);
  FALLBACK_KEYS.forEach((key) => localStorage.removeItem(key));
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (attempt >= NETWORK_RETRIES || init.signal?.aborted) throw error;
      await wait(RETRY_DELAY_MS);
    }
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else headers.delete('Authorization');

  const res = await fetchWithRetry('/api' + path, { ...init, headers });
  if (res.status === 401) {
    window.dispatchEvent(new Event('wd:unauthorized'));
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.status === 204 ? (undefined as T) : res.json();
}
