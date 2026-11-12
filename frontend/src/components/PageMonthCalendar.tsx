import { useMemo, useState } from 'react';
import { addMonths, differenceInCalendarDays, endOfMonth, format, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar } from 'react-big-calendar';
import type { EventProps } from 'react-big-calendar';
import { TaskModal } from './PageTasks';
import { useTasks, type Task } from '../hooks/useTasks';
import { useCalendar } from '../hooks/useCalendar';
import { useGoogleCalendars } from '../hooks/useGoogleCalendars';
import CalendarFilters from './CalendarFilters';
import {
  calendarMessages,
  calendarLocalizer,
  getCalendarEvents,
  getCalendarTasks,
  getEventColor,
  getEventTintColor,
  type CalendarEvent,
} from './calendarUtils';

function MonthEvent({ event }: EventProps<CalendarEvent>) {
  return (
    <span className="month-event-content" title={event.title}>
      <i className="month-event-dot" style={{ backgroundColor: getEventColor(event.resource) }} aria-hidden="true" />
      <span>{event.title}</span>
    </span>
  );
}

interface Props {
  onBack: () => void;
}

export default function PageMonthCalendar({ onBack }: Props) {
  const { tasks, error, create, update, remove, previewFromIA } = useTasks();
  const [date, setDate] = useState(() => new Date());
  const { calendars, selectedIds } = useGoogleCalendars();
  const rangeStart = startOfMonth(date);
  const rangeEnd = endOfMonth(date);
  const { events: googleEvents, error: calendarError } = useCalendar(
    rangeStart,
    differenceInCalendarDays(rangeEnd, rangeStart) + 1
  );
  const [editing, setEditing] = useState<Task | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStart, setModalStart] = useState<string | null>(null);
  const visibleTasks = useMemo(
    () => getCalendarTasks(tasks, googleEvents, calendars)
      .filter((task) => selectedIds.includes(task.calendarId || 'primary')),
    [tasks, googleEvents, calendars, selectedIds]
  );
  const events = useMemo(() => getCalendarEvents(visibleTasks), [visibleTasks]);

  const editTask = (event: CalendarEvent) => {
    setEditing(event.resource);
    setModalStart(null);
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
    <main className="month-page calendar-subview" data-no-shell-swipe>
      <header className="calendar-view-header">
        <div>
          <p className="calendar-eyebrow">VISÃO MENSAL</p>
          <h2>{format(date, 'MMMM yyyy', { locale: ptBR })}</h2>
        </div>
        <div className="calendar-nav">
          <button className="btn" type="button" onClick={() => { setEditing(null); setModalStart(new Date().toISOString()); setModalOpen(true); }}>Novo Item</button>
          <button className="btn ghost calendar-back" onClick={onBack}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="m15 18-6-6 6-6M9 12h12" />
            </svg>
            Voltar para Atual
          </button>
          <button className="btn ghost" onClick={() => setDate((current) => addMonths(current, -1))}>Anterior</button>
          <button className="btn ghost" onClick={() => setDate(new Date())}>Hoje</button>
          <button className="btn ghost" onClick={() => setDate((current) => addMonths(current, 1))}>Próximo</button>
        </div>
      </header>
      {error && <p className="notice">{error}</p>}
      {calendarError && <p className="notice">Não foi possível carregar eventos do Google Calendar.</p>}
      <CalendarFilters />
      <div
        className="calendar-rbc-wrap month-calendar-wrap"
        onPointerDown={(event) => {
          if (event.target instanceof Element && event.target.closest('.rbc-event, .rbc-date-cell button')) {
            event.stopPropagation();
          }
        }}
      >
        <Calendar<CalendarEvent>
          className="wall-calendar month-calendar"
          localizer={calendarLocalizer}
          culture="pt-BR"
          date={date}
          view="month"
          views={['month']}
          events={events}
          startAccessor="start"
          endAccessor="end"
          titleAccessor="title"
          toolbar={false}
          selectable
          components={{ event: MonthEvent }}
          onNavigate={setDate}
          onSelectEvent={(event) => {
            editTask(event);
          }}
          onSelectSlot={(slot) => { setEditing(null); setModalStart(slot.start.toISOString()); setModalOpen(true); }}
          messages={calendarMessages}
          eventPropGetter={(event) => ({
            style: {
              backgroundColor: getEventTintColor(event.resource),
              borderColor: getEventColor(event.resource),
              color: 'var(--paper)',
              opacity: event.resource.feito ? 0.55 : undefined,
            },
          })}
          style={{ height: '100%' }}
        />
      </div>
      <TaskModal
        open={modalOpen}
        inicial={editing}
        initialStart={modalStart}
        onSuggest={previewFromIA}
        onClose={() => setModalOpen(false)}
        onSave={saveTask}
        onDelete={editing ? () => remove(editing._id) : undefined}
      />
    </main>
  );
}
