import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { PageDef } from '../config';

const STORE = 'wd:pager';
const SWIPE_THRESHOLD = 45;

interface Saved {
  locked: boolean;
  index: number;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  target: EventTarget | null;
  scrollNode: HTMLElement | null;
  scrollLeft: number;
  scrollTop: number;
  axis: 'x' | 'y' | null;
}

function readSaved(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    return null;
  }
}

export function usePager(pages: PageDef[], lockable: boolean) {
  const saved = useMemo(readSaved, []);
  const navigablePages = pages.filter((page) => page.navigable !== false);
  const availableRows = [...new Set(navigablePages.map((page) => page.row - 1))].sort((a, b) => a - b);
  const startLocked = lockable && !!saved?.locked;
  const startIndex = startLocked
    ? Math.min(Math.max(saved!.index, 0), pages.length - 1)
    : 0;
  const [locked, setLockedState] = useState(startLocked);
  const [index, setIndex] = useState(startIndex);
  const lockedRef = useRef(startLocked);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  lockedRef.current = locked;

  // Cada página determina o andar e a coluna; a troca vertical tenta preservar a coluna atual.
  const positionOf = useCallback((pageIndex: number) => {
    const page = pages[pageIndex];
    return page ? { row: page.row - 1, column: page.column - 1 } : { row: 0, column: 0 };
  }, [pages]);

  const scrollTo = useCallback((pageIndex: number) => {
    if (lockedRef.current || !pages[pageIndex] || pages[pageIndex].navigable === false) return;
    setIndex(pageIndex);
  }, [pages]);

  const jumpTo = useCallback((pageIndex: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      scrollTo(pageIndex);
      return;
    }
    viewport.classList.add('is-jumping');
    scrollTo(pageIndex);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      viewport.classList.remove('is-jumping');
    }));
  }, [scrollTo]);

  const nearestInRow = useCallback((row: number, column: number) => {
    return navigablePages
      .map((page) => ({ page, index: pages.indexOf(page) }))
      .filter(({ page }) => page.row === row)
      .sort((a, b) =>
        Math.abs(a.page.column - column) - Math.abs(b.page.column - column)
      )[0]?.index ?? index;
  }, [index, navigablePages, pages]);

  const move = useCallback((axis: 'x' | 'y', direction: -1 | 1) => {
    const current = positionOf(index);
    if (axis === 'x') {
      const rowPages = navigablePages
        .map((page) => ({ page, index: pages.indexOf(page) }))
        .filter(({ page }) => page.row - 1 === current.row)
        .sort((a, b) => a.page.column - b.page.column);
      const currentPosition = rowPages.findIndex(({ index: pageIndex }) => pageIndex === index);
      if (currentPosition < 0 || rowPages.length < 2) return;
      const nextPosition = (currentPosition + direction + rowPages.length) % rowPages.length;
      const wrapped = (direction > 0 && nextPosition < currentPosition) ||
        (direction < 0 && nextPosition > currentPosition);
      (wrapped ? jumpTo : scrollTo)(rowPages[nextPosition].index);
      return;
    }
    const currentRowIndex = availableRows.indexOf(current.row);
    if (currentRowIndex < 0 || availableRows.length < 2) return;
    const nextRowIndex = (currentRowIndex + direction + availableRows.length) % availableRows.length;
    const wrapped = (direction > 0 && nextRowIndex < currentRowIndex) ||
      (direction < 0 && nextRowIndex > currentRowIndex);
    (wrapped ? jumpTo : scrollTo)(
      nearestInRow(availableRows[nextRowIndex] + 1, current.column + 1)
    );
  }, [availableRows, index, jumpTo, navigablePages, nearestInRow, pages, positionOf, scrollTo]);

  const onMiddleMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const selectRow = useCallback((row: number) => {
    const current = positionOf(index);
    scrollTo(nearestInRow(row, current.column + 1));
  }, [index, nearestInRow, positionOf, scrollTo]);

  const selectColumn = useCallback((column: number) => {
    const current = pages[index];
    if (current) scrollTo(nearestInRow(current.row, column));
  }, [index, nearestInRow, pages, scrollTo]);

  const clearDrag = useCallback(() => {
    const track = trackRef.current;
    const viewport = viewportRef.current;
    track?.style.removeProperty('--drag-x');
    track?.style.removeProperty('--drag-y');
    viewport?.classList.remove('is-dragging');
    dragRef.current = null;
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const isMiddleButton = event.button === 1;
    if (lockedRef.current || !event.isPrimary || (event.button !== 0 && !isMiddleButton)) return;
    if (isMiddleButton) event.preventDefault();
    const target = event.target;
    if (!isMiddleButton && (
      target instanceof Element &&
      target.closest('input, textarea, select, button, a, [data-nodrag], [data-no-page-swipe], .sidebar, .modal-backdrop')
    )) return;
    let scrollNode = target instanceof Element ? target.parentElement : null;
    while (scrollNode && scrollNode !== event.currentTarget) {
      const style = window.getComputedStyle(scrollNode);
      const scrollableX = /(auto|scroll)/.test(style.overflowX) && scrollNode.scrollWidth > scrollNode.clientWidth + 1;
      const scrollableY = /(auto|scroll)/.test(style.overflowY) && scrollNode.scrollHeight > scrollNode.clientHeight + 1;
      if (scrollableX || scrollableY) break;
      scrollNode = scrollNode.parentElement;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      target,
      scrollNode: scrollNode === event.currentTarget ? null : scrollNode,
      scrollLeft: scrollNode?.scrollLeft ?? 0,
      scrollTop: scrollNode?.scrollTop ?? 0,
      axis: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || lockedRef.current) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 5) return;
    drag.axis ??= Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
    const scrollAxis = drag.axis;
    let remaining = scrollAxis === 'x' ? deltaX : deltaY;
    const canScrollAxis = drag.scrollNode &&
      (scrollAxis === 'x'
        ? drag.scrollNode.scrollWidth > drag.scrollNode.clientWidth + 1
        : drag.scrollNode.scrollHeight > drag.scrollNode.clientHeight + 1);
    if (drag.scrollNode && canScrollAxis) {
      const start = scrollAxis === 'x' ? drag.scrollLeft : drag.scrollTop;
      const max = scrollAxis === 'x'
        ? drag.scrollNode.scrollWidth - drag.scrollNode.clientWidth
        : drag.scrollNode.scrollHeight - drag.scrollNode.clientHeight;
      const desired = Math.max(0, Math.min(max, start - remaining));
      if (scrollAxis === 'x') drag.scrollNode.scrollLeft = desired;
      else drag.scrollNode.scrollTop = desired;
      remaining += desired - start;
      if (Math.abs(remaining) < 1) {
        trackRef.current?.style.removeProperty('--drag-x');
        trackRef.current?.style.removeProperty('--drag-y');
        event.currentTarget.classList.remove('is-dragging');
        return;
      }
    }
    event.preventDefault();
    const track = trackRef.current;
    if (!track) return;
    event.currentTarget.classList.add('is-dragging');
    track.style.setProperty('--drag-x', `${scrollAxis === 'x' ? remaining : 0}px`);
    track.style.setProperty('--drag-y', `${scrollAxis === 'y' ? remaining : 0}px`);
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    let deltaX = event.clientX - drag.startX;
    let deltaY = event.clientY - drag.startY;
    if (drag.scrollNode) {
      deltaX += drag.scrollNode.scrollLeft - drag.scrollLeft;
      deltaY += drag.scrollNode.scrollTop - drag.scrollTop;
    }
    clearDrag();
    if (lockedRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const threshold = Math.max(SWIPE_THRESHOLD, Math.min(viewport.clientWidth, viewport.clientHeight) * 0.12);
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < threshold) return;
    const axis = drag.axis ?? (Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y');
    if (axis === 'x') move('x', deltaX < 0 ? 1 : -1);
    else move('y', deltaY < 0 ? 1 : -1);
  }, [clearDrag, move]);

  const onPointerCancel = useCallback(() => clearDrag(), [clearDrag]);

  useEffect(() => {
    if (lockable) localStorage.setItem(STORE, JSON.stringify({ locked, index }));
  }, [index, lockable, locked]);

  useEffect(() => {
    if (locked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      if (event.key === 'ArrowRight') move('x', 1);
      if (event.key === 'ArrowLeft') move('x', -1);
      if (event.key === 'ArrowDown') move('y', 1);
      if (event.key === 'ArrowUp') move('y', -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [locked, move]);

  const setLocked = useCallback((value: boolean) => {
    if (value) clearDrag();
    setLockedState(value);
  }, [clearDrag]);

  return {
    viewportRef,
    trackRef,
    index,
    scrollTo,
    selectRow,
    selectColumn,
    locked,
    setLocked,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onMiddleMouseDown,
    position: positionOf(index),
  };
}
