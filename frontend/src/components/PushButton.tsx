import { useEffect, useState } from 'react';
import { enablePush, isIOS, isPushEnabled, isStandalone, sendTestPush } from '../lib/push';

export default function PushButton() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [on, setOn] = useState(false);

  useEffect(() => {
    let active = true;
    isPushEnabled()
      .then((enabled) => {
        if (active) setOn(enabled);
      })
      .catch((error: unknown) => {
        if (active) setMsg('Não foi possível verificar as notificações: ' + (error instanceof Error ? error.message : 'falhou'));
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      const m = await fn();
      setMsg(m);
      if (m.includes('ativadas')) setOn(true);
    } catch (e: any) {
      setMsg('Erro: ' + (e?.message || 'falhou'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="push">
      <div className="row">
        <button className="btn" disabled={busy || checking || on} onClick={() => run(enablePush)}>
          {checking ? 'Verificando notificações...' : on ? 'Notificações ativadas' : 'Ativar notificações'}
        </button>
        {on && (
          <button className="btn ghost" disabled={busy} onClick={() => run(sendTestPush)}>
            Enviar teste
          </button>
        )}
      </div>
      {isIOS() && !isStandalone() && (
        <p className="hint">iPhone/iPad (iOS 16.4+): instale primeiro em Safari → Compartilhar → Adicionar à Tela de Início e abra o ícone criado. Sem isso o push não funciona.</p>
      )}
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}
