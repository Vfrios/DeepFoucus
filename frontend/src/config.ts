import type { ComponentType } from 'react';
import PageCalendar from './components/PageCalendar';
import PageTasks from './components/PageTasks';
import PageStats from './components/PageStats';
import PageNotes from './components/PageNotes';

export interface PageDef {
  id: string;
  title: string;
  component: ComponentType;
  mobile: boolean;
}

// Para adicionar uma página: crie o componente e inclua aqui.
export const pages: PageDef[] = [
  { id: 'calendar', title: 'Calendário', component: PageCalendar, mobile: true },
  { id: 'tasks', title: 'Agenda', component: PageTasks, mobile: true },
  { id: 'stats', title: 'Progresso', component: PageStats, mobile: false },
  { id: 'notes', title: 'Notas', component: PageNotes, mobile: false },
];
