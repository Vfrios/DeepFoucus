import { useMemo, useState } from 'react';
import { addDays, addWeeks, format, startOfDay, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar } from 'react-big-calendar';
import type { SlotInfo, View } from 'react-big-calendar';
import { TaskModal } from './PageTasks';
import { useTasks, type Task } from '../hooks/useTasks';
import { useCalendar } from '../hooks/useCalendar';
import { useGoogleCalendars } from '../hooks/useGoogleCalendars';
import {
  calendarMessages,
  calendarLocalizer,
  getCalendarEvents,
  getCalendarTasks,
  getEventColor,
  getEventTextColor,
  type CalendarEvent,
} from './calendarUtils';

const initialView: View = 'week';
const availableViews: View[] = ['week', 'day'];
const timeMin = new Date(1970, 0, 1, 8);
const timeMax = new Date(1970, 0, 1, 20);

export default function PageWeekCalendar() {
  const { tasks, error, create, update, previewFromIA } = useTasks();
  const [date, setDate] = useState(() => new Date());
  const [view, setView] = useState<View>(initialView);
  const { calendars, selectedIds } = useGoogleCalendars();
  const weekStart = startOfWeek(date, { locale: ptBR });
  const eventRangeStart = view === 'day' ? startOfDay(date) : weekStart;
  const { events: googleEvents, error: calendarError } = useCalendar(
    eventRangeStart,
    view === 'day' ? 1 : 7
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [modalStart, setModalStart] = useState<string | null>(null);
  const [modalEnd, setModalEnd] = useState<string | null>(null);

  const visibleTasks = useMemo(
    () => getCalendarTasks(tasks, googleEvents, calendars)
      .filter((task) => selectedIds.includes(task.calendarId || 'primary')),
    [tasks, googleEvents, calendars, selectedIds]
  );
  const events = useMemo(() => getCalendarEvents(visibleTasks), [visibleTasks]);
  const weekEnd = addDays(weekStart, 6);
  const rangeLabel = view === 'day'
    ? format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })
    : weekStart.getMonth() === weekEnd.getMonth()
      ? `${format(weekStart, 'd', { locale: ptBR })}–${format(weekEnd, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}`
      : `${format(weekStart, 'd MMM', { locale: ptBR })} – ${format(weekEnd, "d MMM yyyy", { locale: ptBR })}`;

  const openCreate = ({ start, end }: SlotInfo) => {
    setEditing(null);
    setModalStart(start.toISOString());
    setModalEnd(end.toISOString());
    setModalOpen(true);
  };

  const editTask = (event: CalendarEvent) => {
    setEditing(event.resource);
    setModalStart(null);
    setModalEnd(null);
    setModalOpen(true);
  };

  const saveTask = async (payload: {
    titulo: string;
    descricao: string;
    tipo: Task['tipo'];
    cor: string;
    corPersonalizada: boolean;
    inicio: string | null;
    fim: string | null;
    calendarId: string;
  }) => {
    if (editing) await update(editing._id, payload);
    else await create(payload);
  };

  return (
    <main className="week-page">
      <header className="calendar-view-header">
        <div>
          <p className="calendar-eyebrow">VISÃO SEMANAL</p>
          <h2>{rangeLabel}</h2>
        </div>
        <div className="calendar-nav">
          <button
            className="btn ghost"
            onClick={() => setDate((current) => view === 'day' ? addDays(current, -1) : addWeeks(current, -1))}
          >
            Anterior
          </button>
          <button className="btn ghost" onClick={() => setDate(new Date())}>Hoje</button>
          <button
            className="btn ghost"
            onClick={() => setDate((current) => view === 'day' ? addDays(current, 1) : addWeeks(current, 1))}
          >
            Próximo
          </button>
          <div className="calendar-view-toggle" aria-label="Visualização do calendário">
            {availableViews.map((availableView) => (
              <button
                key={availableView}
                className={`btn ghost${view === availableView ? ' active' : ''}`}
                onClick={() => setView(availableView)}
                aria-pressed={view === availableView}
              >
                {availableView === 'week' ? 'Semana' : 'Dia'}
              </button>
            ))}
          </div>
        </div>
      </header>
      {error && <p className="notice">{error}</p>}
      {calendarError && <p className="notice">Não foi possível carregar eventos do Google Calendar.</p>}
      <div
        className="calendar-rbc-wrap week-calendar-wrap"
        onPointerDown={(event) => {
          if (event.target instanceof Element && event.target.closest('.rbc-time-content')) {
            event.stopPropagation();
          }
        }}
      >
        <Calendar<CalendarEvent>
          className="wall-calendar week-calendar"
          localizer={calendarLocalizer}
          culture="pt-BR"
          date={date}
          view={view}
          views={availableViews}
          events={events}
          startAccessor="start"
          endAccessor="end"
          titleAccessor="title"
          defaultView={initialView}
          toolbar={false}
          selectable
          onNavigate={setDate}
          onView={setView}
          onSelectSlot={openCreate}
          onSelectEvent={(event) => {
            if (!event.resource.externalCalendarEvent) editTask(event);
          }}
          eventPropGetter={(event) => ({
            style: {
              backgroundColor: getEventColor(event.resource),
              borderColor: getEventColor(event.resource),
              color: getEventTextColor(event.resource),
              opacity: event.resource.feito ? 0.55 : undefined,
            },
          })}
          min={timeMin}
          max={timeMax}
          step={30}
          timeslots={2}
          scrollToTime={new Date(1970, 0, 1, 8)}
          messages={calendarMessages}
          style={{ height: '100%' }}
        />
      </div>
      <TaskModal
        open={modalOpen}
        inicial={editing}
        initialStart={modalStart}
        initialEnd={modalEnd}
        onSuggest={previewFromIA}
        onClose={() => setModalOpen(false)}
        onSave={saveTask}
      />
    </main>
  );
}
