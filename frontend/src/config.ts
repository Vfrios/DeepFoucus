import type { ComponentType } from 'react';
import PageCalendar from './components/PageCalendar';
import PageTasks from './components/PageTasks';
import PagePhotos from './components/PagePhotos';
import PageTables from './components/PageTables';
import PageStats from './components/PageStats';

export interface PageDef {
  id: string;
  title: string;
  component: ComponentType;
  mobile: boolean;
}

// Para adicionar uma página: crie o componente e inclua aqui.
export const pages: PageDef[] = [
  { id: 'calendar', title: 'Calendário', component: PageCalendar, mobile: true },
  { id: 'tasks', title: 'Tarefas', component: PageTasks, mobile: true },
  { id: 'stats', title: 'Progresso', component: PageStats, mobile: false },
  { id: 'photos', title: 'Fotos', component: PagePhotos, mobile: false },
  { id: 'tables', title: 'Tabelas', component: PageTables, mobile: false },
];
