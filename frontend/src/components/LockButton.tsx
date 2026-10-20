interface Props {
  locked: boolean;
  onLock: () => void;
  onUnlock: () => void;
}

export default function LockButton({ locked, onLock, onUnlock }: Props) {
  return (
    <button
      className={`lock-btn${locked ? ' is-locked' : ''}`}
      onClick={locked ? onUnlock : onLock}
      aria-label={locked ? 'Destravar páginas' : 'Travar nesta página'}
    >
      {locked ? '🔒 Destravar' : '🔓'}
    </button>
  );
}
