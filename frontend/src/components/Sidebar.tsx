import { useEffect, useRef } from 'react';
import { useProfile } from '../hooks/useProfile';
import DeviceOverride from './DeviceOverride';
import PushButton from './PushButton';
import type { PageDef } from '../config';
import { clearToken } from '../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  pages: PageDef[];
  currentIndex: number;
  onNavigate: (index: number) => void;
}

const REPO_URL = 'https://github.com/vitorfrios/DeepFoucus';
const VERSION = 'v1.0.0';

export default function Sidebar({ open, onClose, pages, currentIndex, onNavigate }: Props) {
  const { profile, loading } = useProfile();
  const panelRef = useRef<HTMLElement | null>(null);

  // Fecha com Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Trava o scroll do body enquanto aberto (boa prática em tablets)
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleNavigate = (i: number) => {
    onNavigate(i);
    onClose();
  };

  const initials = (profile.name || profile.email || '?')
    .trim()
    .slice(0, 1)
    .toUpperCase();

  return (
    <div
      className={`sidebar-backdrop${open ? ' is-open' : ''}`}
      onClick={onClose}
      aria-hidden={!open}
    >
      <aside
        ref={panelRef}
        className={`sidebar${open ? ' is-open' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Menu lateral"
      >
        {/* ---- Cabeçalho do Perfil ---- */}
        <div className="sidebar-profile">
          <div className="avatar" aria-hidden>
            {loading && !profile.picture && <span className="avatar-skeleton" />}
            {!loading && profile.picture && (
              <img src={profile.picture} alt="" referrerPolicy="no-referrer" />
            )}
            {!loading && !profile.picture && <span className="avatar-fallback">{initials}</span>}
          </div>
          <div className="profile-meta">
            {loading ? (
              <span className="muted">Carregando perfil...</span>
            ) : profile.name || profile.email ? (
              <>
                <strong className="profile-name">{profile.name || 'Sem nome'}</strong>
                <span className="profile-email">{profile.email || ''}</span>
              </>
            ) : (
              <span className="muted">
                Google não conectado. Autorize em <code>/api/auth/google?token=…</code>
              </span>
            )}
          </div>
        </div>

        {/* ---- Navegação rápida ---- */}
        <nav className="sidebar-nav" aria-label="Páginas">
          {pages.map((p, i) => p.navigable === false ? null : (
            <button
              key={p.id}
              className={`sidebar-link${i === currentIndex ? ' is-active' : ''}`}
              onClick={() => handleNavigate(i)}
            >
              {p.title}
            </button>
          ))}
        </nav>

        {/* ---- Preferências ---- */}
        <div className="sidebar-section">
          <h3 className="sidebar-title">Preferências</h3>
          <DeviceOverride />
          <div className="sidebar-push">
            <PushButton />
          </div>
        </div>

        {/* ---- Rodapé ---- */}
        <footer className="sidebar-footer">
          <span>{VERSION}</span>
          <div className="sidebar-footer-actions">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              Repositório
            </a>
            <button
              className="sidebar-logout"
              onClick={() => {
                clearToken();
                window.location.reload();
              }}
            >
              Sair
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
