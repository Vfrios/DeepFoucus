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
  const p = usePager(pages.length, lockable);
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
    <div className={`pager${p.locked ? ' is-locked' : ''}`}>
      <div className="pager-viewport" ref={p.emblaRef}>
        <div className="pager-container">
          {pages.map((pg) => {
            const C = pg.component;
            return (
              <section key={pg.id} className="pager-slide" aria-label={pg.title}>
                <C />
              </section>
            );
          })}
        </div>
      </div>
      {!p.locked && pages.length > 1 && <Dots count={pages.length} index={p.index} onSelect={p.scrollTo} />}
      {lockable && <LockButton locked={p.locked} onLock={() => p.setLocked(true)} onUnlock={() => p.setLocked(false)} />}
    </div>
  );
}
