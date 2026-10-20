import { useEffect, useState } from 'react';
import Pager from '../components/Pager';
import Sidebar from '../components/Sidebar';
import { PomodoroBadge } from '../components/Pomodoro';
import { pages } from '../config';
import { api } from '../lib/api';

interface Summary {
  streakDias: number;
}

export default function WebShell() {
  const [st, setSt] = useState({ index: 0, locked: false });
  const [menuOpen, setMenuOpen] = useState(false);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    let cancel = false;
    const load = () =>
      api<Summary>('/stats/summary')
        .then((s) => {
          if (!cancel) setStreak(s.streakDias);
        })
        .catch(() => undefined);
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancel = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <div className="shell shell-web">
      {!st.locked && (
        <header className="shell-top">
          <button
            className="icon-menu"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
          >
            {/* ícone hambúrguer em SVG puro */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 0 }}>
            <span>{pages[st.index]?.title}</span>
            {streak > 0 && (
              <span
                title={`Streak: ${streak} dia(s) consecutivo(s)`}
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                  borderRadius: 999,
                  padding: '2px 10px',
                  fontSize: '.85rem',
                  color: 'var(--warm)',
                  fontWeight: 600,
                }}
              >
                🔥 {streak}
              </span>
            )}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PomodoroBadge />
          </div>
        </header>
      )}

      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        pages={pages}
        currentIndex={st.index}
        onNavigate={(i) => {
          // No WebShell o Pager controla o index via Embla; para navegar
          // programaticamente usamos o evento de clique nos dots — mas
          // como não temos ref exposta, usamos um hack simples: emular o dot.
          // Solução limpa: o Pager aceita `goTo` via prop opcional.
          // Aqui, usamos um evento customizado lido pelo Pager.
          window.dispatchEvent(new CustomEvent('wd:goto', { detail: i }));
        }}
      />

      <Pager pages={pages} lockable onState={setSt} />
    </div>
  );
}
