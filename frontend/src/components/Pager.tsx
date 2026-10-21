import { useEffect } from 'react';
import { usePager } from '../hooks/usePager';
import type { PageDef } from '../config';
import Dots from './Dots';
import LockButton from './LockButton';

interface Props {
  pages: PageDef[];
  lockable: boolean;
  onState?: (s: { index: number; locked: boolean }) => void;
}

export default function Pager({ pages, lockable, onState }: Props) {
  const p = usePager(pages, lockable);
  const columns = Math.max(...pages.map((page) => page.column), 1);
  const rows = Math.max(...pages.map((page) => page.row), 1);
  useEffect(() => onState?.({ index: p.index, locked: p.locked }), [p.index, p.locked]); // eslint-disable-line

  // Navegação externa (usada pela Sidebar no WebShell)
  useEffect(() => {
    const onGoto = (e: Event) => {
      const i = (e as CustomEvent<number>).detail;
      if (typeof i === 'number') p.scrollTo(i);
    };
    window.addEventListener('wd:goto', onGoto);
    return () => window.removeEventListener('wd:goto', onGoto);
  }, [p.scrollTo]);

  return (
    <div
      className={`pager${p.locked ? ' is-locked' : ''}`}
      onMouseDownCapture={p.onMiddleMouseDown}
      onAuxClickCapture={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        className="pager-viewport"
        ref={p.viewportRef}
        onPointerDownCapture={(event) => {
          if (event.button !== 1) return;
          p.onPointerDown(event);
          event.stopPropagation();
        }}
        onPointerDown={p.onPointerDown}
        onPointerMove={p.onPointerMove}
        onPointerUp={p.onPointerUp}
        onPointerCancel={p.onPointerCancel}
        onLostPointerCapture={p.onPointerCancel}
      >
        <div
          className="pager-container"
          ref={p.trackRef}
          style={{
            width: `${columns * 100}%`,
            height: `${rows * 100}%`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            transform: `translate3d(calc(-${p.position.column * (100 / columns)}% + var(--drag-x, 0px)), calc(-${p.position.row * (100 / rows)}% + var(--drag-y, 0px)), 0)`,
          }}
        >
          {pages.map((pg, i) => {
            const C = pg.component;
            return (
              <section
                key={pg.id}
                className={`pager-slide${pg.id === 'calendar' ? ' calendar-slide' : ''}`}
                style={{ gridRow: pg.row, gridColumn: pg.column }}
                aria-label={pg.title}
                data-page-index={i}
              >
                <C />
              </section>
            );
          })}
        </div>
      </div>
      {!p.locked && pages.length > 1 && (
        <Dots
          pages={pages}
          index={p.index}
          onSelectRow={p.selectRow}
          onSelectColumn={p.selectColumn}
        />
      )}
      {lockable && <LockButton locked={p.locked} onLock={() => p.setLocked(true)} onUnlock={() => p.setLocked(false)} />}
    </div>
  );
}
