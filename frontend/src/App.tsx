import { FormEvent, useEffect, useState } from 'react';
import { useDevice } from './device/useDevice';
import MobileShell from './shells/MobileShell';
import WebShell from './shells/WebShell';
import { KioskPrompt } from './components/DeviceOverride';
import { getToken, setToken } from './lib/api';

function TokenGate({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!v.trim()) return;
    setToken(v);
    onDone();
  };
  return (
    <form className="gate" onSubmit={submit}>
      <h1>Wall Dashboard</h1>
      <p className="muted">Informe o API_TOKEN configurado no servidor.</p>
      <input type="password" value={v} onChange={(e) => setV(e.target.value)} placeholder="API_TOKEN" autoFocus />
      <button className="btn">Entrar</button>
    </form>
  );
}

export default function App() {
  const { view } = useDevice();
  const [authed, setAuthed] = useState(!!getToken());

  useEffect(() => {
    const onUnauthorized = () => setAuthed(false); // token errado/expirado => pede de novo
    window.addEventListener('wd:unauthorized', onUnauthorized);
    return () => window.removeEventListener('wd:unauthorized', onUnauthorized);
  }, []);

  if (!authed) return <TokenGate onDone={() => setAuthed(true)} />;
  return (
    <>
      {view === 'web' ? <WebShell /> : <MobileShell />}
      <KioskPrompt />
    </>
  );
}
