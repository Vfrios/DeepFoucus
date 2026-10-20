import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface Props {
  // Opcional: quando o Pomodoro termina e o pai passou uma tarefa, ela é concluída.
  tarefaSelecionadaId?: string | null;
}

const DURACAO = 25 * 60; // 25 min

function beep() {
  // Web Audio API: bipe curto de 880 Hz por 0,5s (sem arquivo de som)
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.2;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => ctx.close();
  } catch {
    /* ignora falha de áudio */
  }
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function Pomodoro({ tarefaSelecionadaId }: Props) {
  const [restante, setRestante] = useState(DURACAO);
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState('');
  const tick = useRef<number | null>(null);

  useEffect(() => {
    if (!rodando) return;
    tick.current = window.setInterval(() => {
      setRestante((r) => {
        if (r <= 1) {
          window.clearInterval(tick.current!);
          tick.current = null;
          setRodando(false);
          // Dispara efeitos ao terminar
          void finalizar();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (tick.current) window.clearInterval(tick.current);
      tick.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rodando]);

  async function finalizar() {
    beep();
    try {
      // FASE 3: incrementa minutos na coleção `activity`
      await api('/tasks/increment', { method: 'POST', body: JSON.stringify({ minutos: 25 }) });
    } catch {
      setMsg('Sessão concluída, mas falhou registrar os minutos.');
      return;
    }
    if (tarefaSelecionadaId) {
      try {
        await api(`/tasks/${tarefaSelecionadaId}`, {
          method: 'PATCH',
          body: JSON.stringify({ feito: true }),
        });
      } catch {
        setMsg('Minutos registrados, mas falhou concluir a tarefa.');
        return;
      }
    }
    setMsg('Sessão concluída ✅');
  }

  const iniciarPausar = () => {
    if (restante === 0) {
      setRestante(DURACAO);
      setMsg('');
      setRodando(true);
    } else {
      setRodando((v) => !v);
    }
  };

  const resetar = () => {
    setRodando(false);
    setRestante(DURACAO);
    setMsg('');
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: '8px 12px',
      }}
    >
      <span
        style={{
          fontVariantNumeric: 'tabular-nums',
          fontSize: '1.1rem',
          fontWeight: 600,
          minWidth: 62,
        }}
      >
        {fmt(restante)}
      </span>
      <button className="btn" onClick={iniciarPausar} style={{ minHeight: 40, padding: '6px 14px' }}>
        {rodando ? 'Pausar' : restante === 0 ? 'Nova sessão' : 'Play'}
      </button>
      <button className="btn ghost" onClick={resetar} style={{ minHeight: 40, padding: '6px 14px' }}>
        Reset
      </button>
      {msg && <span className="hint" style={{ margin: 0 }}>{msg}</span>}
    </div>
  );
}

/** Versão compacta usada no topo do WebShell. */
export function PomodoroBadge() {
  return <Pomodoro />;
}
