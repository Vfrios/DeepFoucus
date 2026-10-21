import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  color: string;
}

export function useCalendar(from: Date, days: number) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fromTime = from.getTime();
  const load = useCallback(async () => {
    try {
      const start = new Date(fromTime);
      setEvents(await api<CalEvent[]>(`/calendar/events?days=${days}&from=${encodeURIComponent(start.toISOString())}`));
      setError('');
    } catch (e: any) {
      setError(String(e?.message || 'erro'));
    } finally {
      setLoading(false);
    }
  }, [days, fromTime]);

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
