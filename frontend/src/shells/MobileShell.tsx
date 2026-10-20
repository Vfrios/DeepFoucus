import { useState } from 'react';
import Pager from '../components/Pager';
import Sidebar from '../components/Sidebar';
import { pages } from '../config';

const mobilePages = pages.filter((p) => p.mobile);

export default function MobileShell() {
  const [st, setSt] = useState({ index: 0, locked: false });
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="shell shell-mobile">
      <header className="shell-top">
        <button
          className="icon-menu"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 style={{ margin: 0 }}>{mobilePages[st.index]?.title}</h1>
        <span style={{ width: 44 }} aria-hidden /> {/* espaçador para centralizar título */}
      </header>

      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        pages={mobilePages}
        currentIndex={st.index}
        onNavigate={(i) => {
          // No MobileShell os dots já nos dão navegação; reaproveitamos
          // o mesmo evento customizado.
          window.dispatchEvent(new CustomEvent('wd:goto', { detail: i }));
        }}
      />

      <Pager pages={mobilePages} lockable={false} onState={setSt} />
    </div>
  );
}
