interface Props {
  locked: boolean;
  onLock: () => void;
  onUnlock: () => void;
}

export default function LockButton({ locked, onLock, onUnlock }: Props) {
  return (
    <button
      className={`lock-btn${locked ? ' is-locked' : ''}`}
      type="button"
      onClick={locked ? onUnlock : onLock}
      aria-label={locked ? 'Destravar tela' : 'Travar no calendário'}
      title={locked ? 'Destravar tela' : 'Travar no calendário'}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        {locked ? (
          <>
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3" />
          </>
        ) : (
          <>
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
          </>
        )}
      </svg>
    </button>
  );
}
