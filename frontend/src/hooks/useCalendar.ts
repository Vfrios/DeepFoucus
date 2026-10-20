import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  color: string;
}

export function useCalendar(days = 7) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const from = new Date();
      from.setHours(0, 0, 0, 0); // início do dia LOCAL
      setEvents(await api<CalEvent[]>(`/calendar/events?days=${days}&from=${encodeURIComponent(from.toISOString())}`));
      setError('');
    } catch (e: any) {
      setError(String(e?.message || 'erro'));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000); // a cada 5 min
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  return { events, error, loading, reload: load };
}
