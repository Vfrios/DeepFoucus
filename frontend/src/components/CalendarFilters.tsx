import { useGoogleCalendars } from '../hooks/useGoogleCalendars';

export default function CalendarFilters() {
  const { calendars, selectedIds, loading, error, toggleCalendar } = useGoogleCalendars();

  if (loading && calendars.length === 0) {
    return <p className="calendar-filters-status">Carregando calendários…</p>;
  }
  if (error && calendars.length === 0) {
    return <p className="calendar-filters-status" role="status">Calendários indisponíveis: {error}</p>;
  }
  if (calendars.length === 0) return null;

  return (
    <fieldset className="calendar-filters">
      <legend>Calendários</legend>
      {calendars.map((calendar) => (
        <label className="calendar-filter" key={calendar.id}>
          <input
            type="checkbox"
            checked={selectedIds.includes(calendar.id)}
            onChange={() => toggleCalendar(calendar.id)}
          />
          <span
            className="calendar-filter-color"
            style={{ backgroundColor: calendar.backgroundColor }}
            aria-hidden="true"
          />
          <span>{calendar.summary}{calendar.primary ? ' (principal)' : ''}</span>
        </label>
      ))}
    </fieldset>
  );
}
