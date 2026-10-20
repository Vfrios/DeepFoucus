import { useEffect, useState } from 'react';
import { useDevice } from './device/useDevice';
import MobileShell from './shells/MobileShell';
import WebShell from './shells/WebShell';
import { KioskPrompt } from './components/DeviceOverride';
import { clearToken, getToken } from './lib/api';

interface Props {
  loginResult: 'success' | 'error' | null;
}

function LoginScreen({ loginResult }: Props) {
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-mark" aria-hidden="true">W</div>
        <p className="login-eyebrow">SEU ESPAÇO DE FOCO</p>
        <h1>Wall Dashboard</h1>
        <p className="login-description">
          Organize suas tarefas, acompanhe seu progresso e mantenha seus estudos em ritmo.
        </p>
        {loginResult === 'error' && (
          <p className="login-error" role="alert">
            Não foi possível entrar com o Google. Tente novamente ou confirme que sua conta está autorizada.
          </p>
        )}
        <a className="google-login" href="/api/auth/login">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 4)" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.42 38.05 46.98 31.92 46.98 24.55Z" />
            <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19Z" transform="translate(0 2)" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 -2)" />
          </svg>
          <span>Entrar com o Google</span>
        </a>
        <p className="login-legal">
          Ao continuar, você concorda com os <a href="/terms.html">Termos de Serviço</a> e reconhece a{' '}
          <a href="/privacy.html">Política de Privacidade</a>.
        </p>
      </section>
    </main>
  );
}

export default function App({ loginResult }: Props) {
  const { view } = useDevice();
  const [authed, setAuthed] = useState(() => Boolean(getToken()));

  useEffect(() => {
    const onUnauthorized = () => {
      clearToken();
      setAuthed(false);
    };
    window.addEventListener('wd:unauthorized', onUnauthorized);
    return () => window.removeEventListener('wd:unauthorized', onUnauthorized);
  }, []);

  if (!authed) return <LoginScreen loginResult={loginResult} />;
  return (
    <>
      {view === 'web' ? <WebShell /> : <MobileShell />}
      <KioskPrompt />
    </>
  );
}
