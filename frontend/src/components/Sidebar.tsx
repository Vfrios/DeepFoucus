import { useEffect, useRef, useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import DeviceOverride from './DeviceOverride';
import PushButton from './PushButton';
import type { PageDef } from '../config';
import { api, clearToken } from '../lib/api';
import { useAuth } from '../AuthContext';

interface Props {
  open: boolean;
  onClose: () => void;
  pages: PageDef[];
  currentIndex: number;
  onNavigate: (index: number) => void;
}

const REPO_URL = 'https://github.com/vitorfrios/DeepFoucus';
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v1.0.0';

interface DevicePairing {
  code: string;
  expiresAt: string;
}

export default function Sidebar({ open, onClose, pages, currentIndex, onNavigate }: Props) {
  const { profile, loading } = useProfile();
  const { isPrimaryOwner } = useAuth();
  const panelRef = useRef<HTMLElement | null>(null);
  const [devicePairing, setDevicePairing] = useState<DevicePairing | null>(null);
  const [startingPairing, setStartingPairing] = useState(false);
  const [pairingError, setPairingError] = useState('');

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

  const startDevicePairing = async () => {
    if (startingPairing) return;
    setStartingPairing(true);
    setPairingError('');
    try {
      setDevicePairing(await api<DevicePairing>('/auth/device-pairing/start', { method: 'POST' }));
      onClose();
    } catch (cause) {
      setPairingError(cause instanceof Error ? cause.message : 'Não foi possível gerar o código de pareamento.');
    } finally {
      setStartingPairing(false);
    }
  };

  const initials = (profile.name || profile.email || '?')
    .trim()
    .slice(0, 1)
    .toUpperCase();

  return (
    <>
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
          {pages.map((p, i) => (
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
          {isPrimaryOwner && (
            <div className="sidebar-pairing">
              <button
                className="btn ghost sidebar-pairing-button"
                type="button"
                disabled={startingPairing}
                onClick={() => void startDevicePairing()}
              >
                {startingPairing ? 'Gerando...' : 'Conectar celular'}
              </button>
              {pairingError && <p className="sidebar-pairing-error" role="alert">{pairingError}</p>}
            </div>
          )}
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
      {devicePairing && (
        <div className="shopping-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="device-pairing-title">
          <div className="shopping-modal shopping-pairing-modal">
            <h3 id="device-pairing-title">Conectar celular</h3>
            <p>Abra o Dashboard no celular usando o IP local do computador e digite este código na tela de login. Ele concede acesso de proprietário por até 30 dias.</p>
            <strong className="shopping-pairing-code" aria-label="Código de pareamento">
              {devicePairing.code.match(/.{1,4}/g)?.join('-')}
            </strong>
            <p>O código expira às {new Date(devicePairing.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} e só pode ser usado uma vez.</p>
            <div className="shopping-modal-actions">
              <button type="button" className="btn" onClick={() => setDevicePairing(null)}>Entendi</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
