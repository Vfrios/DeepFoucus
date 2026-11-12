import { getToken } from './api';

const listeners = new Set<(action: string) => void>();
let socket: WebSocket | null = null;
let reconnect: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (socket || listeners.size === 0) return;
  const webSocketBaseUrl = import.meta.env.DEV
    ? 'ws://localhost:3001'
    : 'wss://deepfoucus.onrender.com';
  const query = new URLSearchParams({ device: 'android', token: getToken() });
  const connection = new WebSocket(`${webSocketBaseUrl}/ws?${query.toString()}`);
  socket = connection;

  connection.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { action?: unknown };
      if (typeof message.action !== 'string') return;
      for (const listener of listeners) listener(message.action);
    } catch (error) {
      console.error('Mensagem WebSocket inválida:', error);
    }
  };
  connection.onclose = () => {
    if (socket !== connection) return;
    socket = null;
    if (listeners.size > 0) reconnect = setTimeout(connect, 3000);
  };
  connection.onerror = () => connection.close();
}

export function subscribeRealtime(listener: (action: string) => void): () => void {
  listeners.add(listener);
  connect();

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    if (reconnect) clearTimeout(reconnect);
    reconnect = null;
    const active = socket;
    socket = null;
    active?.close();
  };
}
