import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import DockShell from './DockShell';

interface Summary {
  streakDias: number;
}

export default function WebShell() {
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    let cancel = false;
    const load = () =>
      api<Summary>('/stats/summary')
        .then((summary) => {
          if (!cancel) setStreak(summary.streakDias);
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    const onVisibilityChange = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancel = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return <DockShell mode="web" streak={streak} />;
}
