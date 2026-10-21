import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';

const STORE = 'wd:pager';

interface Saved {
  locked: boolean;
  index: number;
}
function readSaved(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    return null;
  }
}

/**
 * Estado do pager (Embla). No modo LOCK:
 *  - o arrasto é desligado (watchDrag via ref, sem reinicializar o Embla);
 *  - estado {locked,index} persiste em localStorage => recarregar continua travado.
 */
export function usePager(count: number, lockable: boolean) {
  const saved = useMemo(readSaved, []);
  const startLocked = lockable && !!saved?.locked;
  const startIndex = startLocked ? Math.min(Math.max(saved!.index, 0), count - 1) : 0;

  const [locked, setLockedState] = useState(startLocked);
  const [index, setIndex] = useState(startIndex);
  const lockedRef = useRef(startLocked);
  lockedRef.current = locked;

  const options = useMemo(
    () => ({
      startIndex,
      duration: 20,
      loop: count > 1,
      // Função: bloqueia o arrasto quando travado e ignora elementos [data-nodrag] (ex.: alça de reordenar tarefas)
      watchDrag: (_api: unknown, evt: Event) => !lockedRef.current && !(evt.target as HTMLElement)?.closest?.('[data-nodrag]'),
    }),
    [count, startIndex]
  );
  const [emblaRef, embla] = useEmblaCarousel(options);

  useEffect(() => {
    if (!embla) return;
    const onSelect = () => setIndex(embla.selectedScrollSnap());
    embla.on('select', onSelect);
    return () => {
      embla.off('select', onSelect);
    };
  }, [embla]);

  useEffect(() => {
    if (!embla) return;

    let accumulated = 0;
    let gestureConsumed = false;
    let gestureReset: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (event: WheelEvent) => {
      const target = event.target;
      if (
        lockedRef.current ||
        event.ctrlKey ||
        Math.abs(event.deltaX) <= Math.abs(event.deltaY) ||
        !(target instanceof Element) ||
        !target.closest('.shell') ||
        target.closest('input, textarea, select, [data-no-page-swipe], .sidebar, .modal-backdrop')
      ) {
        return;
      }

      const forward = event.deltaX > 0;
      if (!(forward ? embla.canScrollNext() : embla.canScrollPrev())) return;

      event.preventDefault();
      if (gestureReset) clearTimeout(gestureReset);
      gestureReset = setTimeout(() => {
        accumulated = 0;
        gestureConsumed = false;
        gestureReset = undefined;
      }, 120);
      if (gestureConsumed) return;

      const deltaX = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaX * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaX * window.innerWidth
          : event.deltaX;
      if (accumulated && Math.sign(accumulated) !== Math.sign(event.deltaX)) {
        accumulated = 0;
      }
      accumulated += deltaX;
      if (Math.abs(accumulated) < 18) return;

      if (accumulated > 0) embla.scrollNext();
      else embla.scrollPrev();
      accumulated = 0;
      gestureConsumed = true;
    };

    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
      if (gestureReset) clearTimeout(gestureReset);
    };
  }, [embla]);

  // Persistência
  useEffect(() => {
    if (lockable) localStorage.setItem(STORE, JSON.stringify({ locked, index }));
  }, [locked, index, lockable]);

  // Travado: sempre volta para a página travada (ex.: ao reabrir a aba / rotacionar)
  useEffect(() => {
    if (!embla || !locked) return;
    const back = () => embla.scrollTo(index, true);
    document.addEventListener('visibilitychange', back);
    window.addEventListener('resize', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('resize', back);
    };
  }, [embla, locked, index]);

  // Teclado (desktop) quando destravado
  useEffect(() => {
    if (!embla || locked) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') embla.scrollNext();
      if (e.key === 'ArrowLeft') embla.scrollPrev();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [embla, locked]);

  const scrollTo = useCallback((i: number) => embla?.scrollTo(i), [embla]);
  const setLocked = useCallback(
    (v: boolean) => {
      if (v && embla) embla.scrollTo(embla.selectedScrollSnap(), true); // trava exatamente onde está
      setLockedState(v);
    },
    [embla]
  );

  return { emblaRef, index, scrollTo, locked, setLocked };
}
