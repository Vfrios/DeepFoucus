import type { ComponentType } from 'react';
import PageCalendar from './components/PageCalendar';
import PageTasks from './components/PageTasks';
import PageStats from './components/PageStats';
import PageNotes from './components/PageNotes';
import PageMonthCalendar from './components/PageMonthCalendar';
import PageWeekCalendar from './components/PageWeekCalendar';
import EmptyPage from './components/EmptyPage';

export interface PageDef {
  id: string;
  title: string;
  component: ComponentType;
  mobile: boolean;
  row: 1 | 2;
  column: 1 | 2 | 3 | 4;
  navigable?: boolean;
}

// Para adicionar uma página: crie o componente e inclua aqui.
export const pages: PageDef[] = [
  { id: 'calendar', title: 'Calendário Diário', component: PageCalendar, mobile: true, row: 1, column: 1 },
  { id: 'tasks', title: 'Tarefas', component: PageTasks, mobile: true, row: 1, column: 2 },
  { id: 'stats', title: 'Progresso', component: PageStats, mobile: false, row: 1, column: 3 },
  { id: 'notes', title: 'Notas', component: PageNotes, mobile: false, row: 1, column: 4 },
  { id: 'month-calendar', title: 'Calendário Mensal', component: PageMonthCalendar, mobile: false, row: 2, column: 1 },
  { id: 'week-calendar', title: 'Calendário Semanal', component: PageWeekCalendar, mobile: false, row: 2, column: 2 },
  { id: 'empty-2-3', title: '', component: EmptyPage, mobile: false, row: 2, column: 3, navigable: false },
  { id: 'empty-2-4', title: '', component: EmptyPage, mobile: false, row: 2, column: 4, navigable: false },
];
