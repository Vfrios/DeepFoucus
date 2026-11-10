import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer } from 'ws';

type Device = 'android' | 'ios';

const clients = new Map<Device, WebSocket>();
const webSocketServer = new WebSocketServer({ noServer: true });

function registerClient(device: Device, client: WebSocket) {
  clients.get(device)?.close(1000, 'Replaced by a newer connection');
  clients.set(device, client);
  client.on('close', () => {
    if (clients.get(device) === client) clients.delete(device);
  });
  client.on('error', (error) => console.warn(`[ws] ${device} client error:`, error.message));
}

export function attachWebSocketServer(server: Server) {
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const device = url.searchParams.get('device');
    const token = url.searchParams.get('token');
    const secret = process.env.JWT_SECRET;

    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    if (!secret || !token || (device !== 'android' && device !== 'ios')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || typeof payload.email !== 'string' || !payload.email) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      registerClient(device, client);
      webSocketServer.emit('connection', client, request);
    });
  });
}

export function notifyAndroid(action: string) {
  const client = clients.get('android');
  if (client?.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ action }));
  }
}
