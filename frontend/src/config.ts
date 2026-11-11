import type { ComponentType } from 'react';
import type { UserRole } from './AuthContext';
import PageCalendar from './components/PageCalendar';
import PageFinance from './components/PageFinance';
import PageHealth from './components/PageHealth';
import PageShopping from './components/PageShopping';
import PageTasks from './components/PageTasks';

export type DockIconName = 'calendar' | 'tasks' | 'finance' | 'shopping' | 'health';

export interface PageDef {
  id: string;
  title: string;
  component: ComponentType;
  icon: DockIconName;
}

export const pages: PageDef[] = [
  { id: 'calendar', title: 'Calendário', component: PageCalendar, icon: 'calendar' },
  { id: 'tasks', title: 'Tarefas', component: PageTasks, icon: 'tasks' },
  { id: 'finance', title: 'Finanças', component: PageFinance, icon: 'finance' },
  { id: 'shopping', title: 'Compras', component: PageShopping, icon: 'shopping' },
  { id: 'health', title: 'Saúde', component: PageHealth, icon: 'health' },
];

export function pagesForRole(role: UserRole): PageDef[] {
  if (role === 'owner') return pages;
  if (role === 'finance') return pages.filter((page) => page.id === 'finance' || page.id === 'shopping');
  return pages.filter((page) => page.id === 'shopping');
}
