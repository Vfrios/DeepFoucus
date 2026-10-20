import { api } from './api';

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || (navigator as any).standalone === true;

function b64ToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Permissão -> SW -> subscribe -> envia subscription ao backend. Devolve mensagem para a UI. */
export async function enablePush(): Promise<string> {
  // No iOS o push só existe para PWA instalada na Tela de Início (iOS 16.4+)
  if (isIOS() && !isStandalone()) {
    return 'No iPhone/iPad: abra no Safari → Compartilhar → Adicionar à Tela de Início, abra o app instalado e ative de lá (iOS 16.4+).';
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'Este navegador não suporta notificações push.';
  if (!import.meta.env.PROD) return 'O Service Worker só roda no build de produção (npm run build && npm start).';

  const perm = await Notification.requestPermission(); // precisa ser chamado por um toque do usuário
  if (perm !== 'granted') return 'Permissão negada. Libere nas configurações do dispositivo.';

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('/push/key');
  if (!publicKey) return 'Servidor sem VAPID_PUBLIC_KEY configurada.';

  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey) }));
  await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
  return 'Notificações ativadas ✓';
}

export async function sendTestPush(): Promise<string> {
  const r = await api<{ sent: number }>('/push/test', { method: 'POST' });
  return r.sent ? 'Teste enviado ✓' : 'Nenhum dispositivo inscrito.';
}
