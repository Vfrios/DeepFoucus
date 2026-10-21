import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../lib/api';

export interface GoogleCalendar {
  id: string;
  summary: string;
  backgroundColor: string;
  primary: boolean;
}

interface CalendarState {
  calendars: GoogleCalendar[];
  selectedIds: string[];
  loading: boolean;
  error: string;
}

const STORAGE_KEY = 'wd:selected-calendars';
const listeners = new Set<() => void>();
let request: Promise<void> | null = null;
let state: CalendarState = {
  calendars: [],
  selectedIds: [],
  loading: true,
  error: '',
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notify = () => listeners.forEach((listener) => listener());

function setState(next: CalendarState) {
  state = next;
  notify();
}

async function loadCalendars() {
  if (request) return request;
  request = api<GoogleCalendar[]>('/calendar/lists')
    .then((calendars) => {
      const saved = localStorage.getItem(STORAGE_KEY);
      let selectedIds: string[];
      if (saved) {
        try {
          const storedIds: unknown = JSON.parse(saved);
          const validStoredIds = Array.isArray(storedIds)
            ? storedIds.filter((id): id is string => typeof id === 'string')
            : [];
          const known = new Set(calendars.map((calendar) => calendar.id));
          selectedIds = [
            ...validStoredIds.filter((id) => known.has(id)),
            ...calendars
              .map((calendar) => calendar.id)
              .filter((id) => !validStoredIds.includes(id)),
          ];
        } catch {
          selectedIds = calendars.map((calendar) => calendar.id);
        }
      } else {
        selectedIds = calendars.map((calendar) => calendar.id);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds));
      setState({ calendars, selectedIds, loading: false, error: '' });
    })
    .catch((error: unknown) => {
      setState({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : 'Não foi possível carregar os calendários.',
      });
    });
  return request;
}

export function useGoogleCalendars() {
  const current = useSyncExternalStore(subscribe, () => state, () => state);

  useEffect(() => {
    void loadCalendars();
  }, []);

  const toggleCalendar = (calendarId: string) => {
    const selectedIds = current.selectedIds.includes(calendarId)
      ? current.selectedIds.filter((id) => id !== calendarId)
      : [...current.selectedIds, calendarId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds));
    setState({ ...state, selectedIds });
  };

  return { ...current, toggleCalendar };
}
