import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useAuth } from '../AuthContext';
import LockButton from '../components/LockButton';
import Sidebar from '../components/Sidebar';
import { pagesForRole, type DockIconName, type PageDef } from '../config';

interface Props {
  mode: 'web' | 'mobile';
  streak?: number;
}

interface PointerStart {
  id: number;
  x: number;
  y: number;
}

const SWIPE_THRESHOLD = 56;

function readSavedLock(): boolean {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('wd:pager') || 'null');
    return typeof saved === 'object' && saved !== null && 'locked' in saved && saved.locked === true;
  } catch {
    return false;
  }
}

function DockIcon({ name }: { name: DockIconName }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      {name === 'calendar' && (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
          <path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" />
        </>
      )}
      {name === 'tasks' && (
        <>
          <path d="m4 7 1.5 1.5L8 6M10.5 7H20M4 13l1.5 1.5L8 12M10.5 13H20M4 19l1.5 1.5L8 18M10.5 19H20" />
        </>
      )}
      {name === 'finance' && (
        <>
          <path d="M4 19.5V10M10 19.5V4.5M16 19.5v-6M22 19.5H2" />
          <path d="m3.5 7 5-3 5.5 5 6-4" />
        </>
      )}
      {name === 'shopping' && (
        <>
          <path d="M4 8h16l-1.3 12H5.3L4 8Z" />
          <path d="M9 8a3 3 0 0 1 6 0" />
        </>
      )}
      {name === 'health' && (
        <>
          <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z" />
          <path d="M12 8v7M8.5 11.5h7" />
        </>
      )}
    </svg>
  );
}

function initialPageIndex(pages: PageDef[]): number {
  const requestedPage = new URLSearchParams(location.search).get('page');
  const requestedIndex = pages.findIndex((page) => page.id === requestedPage);
  if (requestedIndex >= 0) return requestedIndex;
  const calendarIndex = pages.findIndex((page) => page.id === 'calendar');
  return calendarIndex >= 0 ? calendarIndex : 0;
}

export default function DockShell({ mode, streak }: Props) {
  const { role } = useAuth();
  const pages = useMemo(() => role ? pagesForRole(role) : [], [role]);
  const [initialState] = useState(() => {
    const locked = mode === 'web' && readSavedLock();
    const calendarIndex = pages.findIndex((page) => page.id === 'calendar');
    return {
      locked,
      activeIndex: locked && calendarIndex >= 0 ? calendarIndex : initialPageIndex(pages),
    };
  });
  const [activeIndex, setActiveIndex] = useState(initialState.activeIndex);
  const [lockedState, setLocked] = useState(initialState.locked);
  // Cadeado (modo Parede) existe apenas no WebShell; no celular nunca trava.
  const isWeb = mode === 'web';
  const locked = isWeb && lockedState;
  const [menuOpen, setMenuOpen] = useState(false);
  const pointerStart = useRef<PointerStart | null>(null);
  const unlockTimer = useRef<number | null>(null);
  const activePage = pages[activeIndex];

  const navigateTo = (index: number) => {
    if (locked || !pages[index]) return;
    setActiveIndex(index);
    const url = new URL(location.href);
    url.searchParams.set('page', pages[index].id);
    history.replaceState(null, '', url.toString());
  };

  const onSwipeStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, input, textarea, select, [contenteditable="true"], [data-no-shell-swipe]')) return;
    pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const onSwipeEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.id !== event.pointerId || locked) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY) || pages.length < 2) return;
    const nextIndex = (activeIndex + (deltaX < 0 ? 1 : -1) + pages.length) % pages.length;
    navigateTo(nextIndex);
  };

  const onUnlockStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    unlockTimer.current = window.setTimeout(() => {
      setLocked(false);
      unlockTimer.current = null;
    }, 750);
  };

  const cancelUnlock = () => {
    if (unlockTimer.current !== null) {
      window.clearTimeout(unlockTimer.current);
      unlockTimer.current = null;
    }
  };

  useEffect(() => cancelUnlock, []);
  // MobileShell: libera a rolagem do documento (html/body/#root) enquanto montado.
  useEffect(() => {
    if (mode !== 'mobile') return;
    const root = document.documentElement;
    root.classList.add('is-mobile-shell');
    return () => root.classList.remove('is-mobile-shell');
  }, [mode]);
  useEffect(() => {
    if (mode === 'web') {
      localStorage.setItem('wd:pager', JSON.stringify({ locked, index: activeIndex }));
    }
  }, [activeIndex, locked, mode]);

  return (
    <div className={`shell shell-${mode}${locked ? ' is-locked' : ''}`}>
      {!locked && (
        <div className="shell-toolbar">
          <button
            className="shell-menu-button"
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {typeof streak === 'number' && streak > 0 && (
            <span className="streak-badge" title={`${streak} dias consecutivos`}>
              {streak} dias em sequência
            </span>
          )}
        </div>
      )}

      <main
        className="shell-content"
        onPointerDown={onSwipeStart}
        onPointerUp={onSwipeEnd}
        onPointerCancel={() => { pointerStart.current = null; }}
      >
        {activePage && (() => {
          const Page = activePage.component;
          return (
            <section
              key={activePage.id}
              className={`dock-page${activePage.id === 'calendar' ? ' dock-page-calendar' : ''}`}
              aria-label={activePage.title}
            >
              <Page />
            </section>
          );
        })()}
        {locked && (
          <div
            className="ambient-unlock-surface"
            aria-label="Mantenha pressionado para destravar"
            onPointerDown={onUnlockStart}
            onPointerUp={cancelUnlock}
            onPointerCancel={cancelUnlock}
            onContextMenu={(event) => event.preventDefault()}
          />
        )}
      </main>

      {!locked && (
        <nav className="dock" aria-label="Navegação principal">
          {pages.map((page, index) => (
            <button
              key={page.id}
              type="button"
              className={`dock-item${index === activeIndex ? ' is-active' : ''}`}
              aria-label={page.title}
              aria-current={index === activeIndex ? 'page' : undefined}
              onClick={() => navigateTo(index)}
            >
              <DockIcon name={page.icon} />
              <span>{page.title}</span>
            </button>
          ))}
        </nav>
      )}

      {isWeb && !locked && activePage?.id === 'calendar' && (
        <LockButton locked={locked} onLock={() => setLocked(true)} onUnlock={() => setLocked(false)} />
      )}
      {isWeb && locked && (
        <LockButton locked onLock={() => setLocked(true)} onUnlock={() => setLocked(false)} />
      )}

      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        pages={pages}
        currentIndex={activeIndex}
        onNavigate={(index) => navigateTo(index)}
      />
    </div>
  );
}
