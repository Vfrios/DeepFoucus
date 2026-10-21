import { format, getDay, parse, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { dateFnsLocalizer } from 'react-big-calendar';
import type { Messages } from 'react-big-calendar';
import type { Task } from '../hooks/useTasks';
import type { CalEvent } from '../hooks/useCalendar';
import type { GoogleCalendar } from '../hooks/useGoogleCalendars';
import { getDefaultTaskColor, getTaskTextColor, getTaskTintColor, isHexColor } from '../lib/taskColors';

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  resource: Task;
}

export const calendarLocalizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { 'pt-BR': ptBR },
});

export const calendarMessages: Messages<CalendarEvent> = {
  allDay: 'Dia inteiro',
  previous: 'Anterior',
  next: 'Próximo',
  today: 'Hoje',
  month: 'Mês',
  week: 'Semana',
  day: 'Dia',
  agenda: 'Agenda',
  showMore: (count) => `+${count} mais`,
  noEventsInRange: 'Nenhum evento neste período',
  yesterday: 'Ontem',
  tomorrow: 'Amanhã',
};

function primaryCalendarId(calendars: GoogleCalendar[]) {
  return calendars.find((calendar) => calendar.primary)?.id || 'primary';
}

function taskCalendarId(task: Task, calendars: GoogleCalendar[]) {
  return !task.calendarId || task.calendarId === 'primary'
    ? primaryCalendarId(calendars)
    : task.calendarId;
}

export function getCalendarTasks(
  tasks: Task[],
  googleEvents: CalEvent[],
  calendars: GoogleCalendar[]
): Task[] {
  const primaryId = primaryCalendarId(calendars);
  const calendarById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  const linkedEventIds = new Set(
    tasks
      .filter((task) => task.googleEventId)
      .map((task) => `${taskCalendarId(task, calendars)}:${task.googleEventId}`)
  );
  const decoratedTasks = tasks.map((task) => ({
    ...task,
    calendarId: taskCalendarId(task, calendars),
    calendarBackgroundColor: calendarById.get(taskCalendarId(task, calendars))?.backgroundColor,
  }));
  const standaloneEvents = googleEvents
    .filter((event) => !linkedEventIds.has(event.id))
    .map<Task>((event) => {
      const start = event.allDay && /^\d{4}-\d{2}-\d{2}$/.test(event.start)
        ? `${event.start}T00:00:00`
        : event.start;
      const end = event.allDay && /^\d{4}-\d{2}-\d{2}$/.test(event.end)
        ? `${event.end}T00:00:00`
        : event.end;
      return {
        _id: `google:${event.id}`,
        titulo: event.title,
        descricao: event.location,
        tipo: 'evento',
        cor: getDefaultTaskColor('evento'),
        inicio: start,
        fim: end,
        texto: event.title,
        data: start,
        feito: false,
        ordem: 0,
        calendarId: event.calendarId || primaryId,
        calendarBackgroundColor: event.color,
        externalCalendarEvent: true,
        allDay: event.allDay,
      };
    });
  return [...decoratedTasks, ...standaloneEvents];
}

export function getCalendarEvents(tasks: Task[]): CalendarEvent[] {
  return tasks.flatMap((task) => {
    if (!task.inicio) return [];

    const start = new Date(task.inicio);
    if (Number.isNaN(start.getTime())) return [];

    const parsedEnd = task.fim ? new Date(task.fim) : null;
    const end = parsedEnd && !Number.isNaN(parsedEnd.getTime()) && parsedEnd > start
      ? parsedEnd
      : new Date(start.getTime() + 30 * 60_000);

    return [{ title: task.titulo, start, end, allDay: task.allDay, resource: task }];
  });
}

export function getEventColor(task: Task): string {
  const defaultColor = getDefaultTaskColor(task.tipo);
  if (
    isHexColor(task.cor) &&
    (task.corPersonalizada === true ||
      (task.corPersonalizada !== false && task.cor.toLowerCase() !== defaultColor.toLowerCase()))
  ) {
    return task.cor;
  }
  if (isHexColor(task.calendarBackgroundColor)) return task.calendarBackgroundColor;
  return isHexColor(task.cor) ? task.cor : defaultColor;
}

export const getEventTextColor = (task: Task): string => getTaskTextColor(getEventColor(task));

export const getEventTintColor = (task: Task): string => getTaskTintColor(getEventColor(task));
