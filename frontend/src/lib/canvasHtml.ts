import DOMPurify from 'dompurify';

const CANVAS_ORIGIN = 'https://pucminas.instructure.com';
const TIME_ZONE = 'America/Sao_Paulo';

export type DeliveryStatus =
  | 'corrigido'
  | 'entregue'
  | 'pendente'
  | 'atrasado'
  | 'dispensado'
  | 'sem_entrega_online';

export function formatSaoPauloDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  return `${min}m ${remSec}s`;
}

export function statusBadgeInfo(
  status: DeliveryStatus,
  score?: number | null,
  pointsPossible?: number | null,
  grade?: string | null
): { label: string; tone: 'ok' | 'accent' | 'warm' | 'danger' | 'muted' } {
  switch (status) {
    case 'corrigido': {
      const note =
        typeof score === 'number' && typeof pointsPossible === 'number'
          ? `${score}/${pointsPossible}`
          : grade || (typeof score === 'number' ? String(score) : '');
      return { label: note ? `Corrigido (${note})` : 'Corrigido', tone: 'accent' };
    }
    case 'entregue':
      return { label: 'Entregue', tone: 'ok' };
    case 'atrasado':
      return { label: 'Atrasado', tone: 'danger' };
    case 'pendente':
      return { label: 'Pendente', tone: 'warm' };
    case 'dispensado':
      return { label: 'Dispensado', tone: 'muted' };
    case 'sem_entrega_online':
      return { label: 'Sem entrega online', tone: 'muted' };
  }
}

export function isDueTodaySaoPaulo(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE });
  return fmt.format(d) === fmt.format(new Date());
}

export function isDueWithinDaysSaoPaulo(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE }).format(new Date());
  const start = new Date(`${todayStr}T00:00:00.000-03:00`).getTime();
  const end = start + days * 24 * 60 * 60 * 1000 - 1;
  return d.getTime() >= start && d.getTime() <= end;
}

/**
 * Sanitiza HTML vindo do Canvas com DOMPurify e converte URLs relativas
 * (`/courses/...`, `/files/...`) em absolutas para `https://pucminas.instructure.com`.
 */
export function sanitizeCanvasHtml(rawHtml: string | null | undefined): string {
  if (!rawHtml) return '';
  const clean = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    ADD_ATTR: ['target', 'rel'],
  });

  if (typeof document === 'undefined') return clean;
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;

  tpl.content.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('/')) {
      a.setAttribute('href', `${CANVAS_ORIGIN}${href}`);
    }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  tpl.content.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('/')) {
      img.setAttribute('src', `${CANVAS_ORIGIN}${src}`);
    }
    img.setAttribute('loading', 'lazy');
  });

  return tpl.innerHTML;
}
