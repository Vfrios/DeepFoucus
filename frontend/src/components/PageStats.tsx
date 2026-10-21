import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

type Tipo = 'tarefa' | 'evento' | 'estudo';

interface DiaStats {
  dia: string; // YYYY-MM-DD
  concluidas: number;
}

interface BreakdownItem {
  contagem: number;
}

interface InsightsPayload {
  streakDias: number;
  tarefasPendentes: number;
  tarefasConcluidas: number;
  dias: DiaStats[];
  breakdown: Record<Tipo, BreakdownItem>;
  insight: string | null;
  insightErro?: string;
}

// ---------- cores ----------
const COR_TIPO: Record<Tipo, string> = {
  estudo: '#f0b95a', // laranja
  evento: '#9db4ff', // azul
  tarefa: '#86d7c0', // verde-água
};
const LABEL_TIPO: Record<Tipo, string> = {
  estudo: 'Estudo',
  evento: 'Eventos',
  tarefa: 'Tarefas',
};
const ORDEM_TIPOS: Tipo[] = ['estudo', 'evento', 'tarefa'];

// Faixas do heatmap (tarefas concluídas)
function corPorConcluidas(n: number): string {
  if (n <= 0) return '#1a222c';
  if (n === 1) return '#0e4429';
  if (n <= 3) return '#006d32';
  if (n <= 5) return '#26a641';
  return '#39d353';
}

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------- heatmap ----------

function Heatmap({ dias }: { dias: DiaStats[] }) {
  const anoAtual = new Date().getFullYear();

  const grid = useMemo(() => {
    const mapa = new Map<string, DiaStats>();
    for (const d of dias) mapa.set(d.dia, d);

    const inicioAno = new Date(anoAtual, 0, 1);
    const inicioGrid = new Date(inicioAno);
    inicioGrid.setDate(inicioGrid.getDate() - inicioGrid.getDay());

    const colunas = 53;
    const linhas = 7;
    const cells: Array<{ dia: string | null; stats: DiaStats | null }> = [];

    for (let col = 0; col < colunas; col++) {
      for (let row = 0; row < linhas; row++) {
        const d = new Date(inicioGrid);
        d.setDate(inicioGrid.getDate() + col * 7 + row);
        if (d.getFullYear() !== anoAtual) {
          cells.push({ dia: null, stats: null });
        } else {
          const k = keyOf(d);
          cells.push({ dia: k, stats: mapa.get(k) || null });
        }
      }
    }
    return cells;
  }, [dias, anoAtual]);

  return (
    <>
      <div className="heatmap">
        {grid.map((c, i) => (
          <div
            key={i}
            className="heatmap-cell"
            title={
              c.dia && c.stats
                ? `${c.dia} · ${c.stats.concluidas} tarefa(s) concluída(s)`
                : c.dia
                  ? `${c.dia} · nenhuma tarefa concluída`
                  : ''
            }
            style={{
              background: c.dia ? corPorConcluidas(c.stats?.concluidas || 0) : 'transparent',
            }}
          />
        ))}
      </div>
      <div className="heatmap-legend">
        <span>Menos concluídas</span>
        {[0, 1, 2, 4, 6].map((n) => (
          <span key={n} className="heatmap-legend-box" style={{ background: corPorConcluidas(n) }} />
        ))}
        <span>Mais concluídas</span>
      </div>
    </>
  );
}

// ---------- gráfico de divisão por tipo ----------

function Breakdown({ breakdown }: { breakdown: Record<Tipo, BreakdownItem> }) {
  const totalContagem = ORDEM_TIPOS.reduce((a, t) => a + breakdown[t].contagem, 0);
  const total = totalContagem;

  if (total === 0) {
    return <p className="muted">Sem itens na última semana para compor o gráfico.</p>;
  }

  return (
    <div className="breakdown">
      <div className="breakdown-bar" role="img" aria-label="Divisão por tipo">
        {ORDEM_TIPOS.map((t) => {
          const valor = breakdown[t].contagem;
          if (valor <= 0) return null;
          const pct = (valor / total) * 100;
          return (
            <div
              key={t}
              className="breakdown-seg"
              style={{ width: `${pct}%`, background: COR_TIPO[t] }}
              title={`${LABEL_TIPO[t]}: ${valor} tarefa(s) concluída(s) (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>
      <ul className="breakdown-legend">
        {ORDEM_TIPOS.map((t) => {
          const valor = breakdown[t].contagem;
          const pct = total ? (valor / total) * 100 : 0;
          return (
            <li key={t}>
              <span className="breakdown-dot" style={{ background: COR_TIPO[t] }} />
              <span className="breakdown-label">{LABEL_TIPO[t]}</span>
              <span className="breakdown-val">
                {valor} {valor === 1 ? 'item' : 'itens'} · {pct.toFixed(0)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- bloco de IA ----------

function InsightBlock({ payload }: { payload: InsightsPayload }) {
  if (payload.insight) {
    return (
      <div className="insight-block">
        <span className="insight-icon" aria-hidden>
          🤖
        </span>
        <p className="insight-text">{payload.insight}</p>
      </div>
    );
  }
  if (payload.insightErro) {
    return (
      <div className="insight-block insight-block-muted">
        <span className="insight-icon" aria-hidden>
          🤖
        </span>
        <p className="insight-text">
          Análise personalizada indisponível no momento. Confira a conexão e os logs do backend
          para verificar a resposta dos provedores de IA.
        </p>
      </div>
    );
  }
  return null;
}

// ---------- página ----------

export default function PageStats() {
  const [payload, setPayload] = useState<InsightsPayload | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancel = false;
    const load = () => {
      api<InsightsPayload>('/stats/insights')
        .then((p) => {
          if (cancel) return;
          setPayload(p);
          setErro('');
        })
        .catch(() => {
          if (cancel) return;
          setErro('Não foi possível carregar as estatísticas.');
        })
        .finally(() => {
          if (!cancel) setCarregando(false);
        });
    };
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

  if (carregando && !payload) {
    return (
      <div className="page stats">
        <h2 className="page-title">Progresso</h2>
        <p className="muted">Carregando…</p>
      </div>
    );
  }

  if (erro && !payload) {
    return (
      <div className="page stats">
        <h2 className="page-title">Progresso</h2>
        <p className="notice">{erro}</p>
      </div>
    );
  }

  if (!payload) return null;

  return (
    <div className="page stats">
      <h2 className="page-title">Progresso</h2>

      {erro && <p className="notice">{erro}</p>}

      {/* ---- Cartões ---- */}
      <section className="stats-cards">
        <div className="stats-card">
          <span className="stats-card-label">🔥 Streak</span>
          <strong className="stats-card-value">
            {payload.streakDias} dia{payload.streakDias === 1 ? '' : 's'}
          </strong>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Tarefas não feitas</span>
          <strong className="stats-card-value">{payload.tarefasPendentes}</strong>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Tarefas finalizadas</span>
          <strong className="stats-card-value">{payload.tarefasConcluidas}</strong>
        </div>
      </section>

      {/* ---- Heatmap ---- */}
      <section className="stats-section">
        <h3 className="stats-section-title">Tarefas concluídas no ano</h3>
        <Heatmap dias={payload.dias} />
      </section>

      {/* ---- Divisão por tipo ---- */}
      <section className="stats-section">
        <h3 className="stats-section-title">Divisão por tipo (últimos 7 dias)</h3>
        <Breakdown breakdown={payload.breakdown} />
      </section>

      {/* ---- IA ---- */}
      <section className="stats-section">
        <h3 className="stats-section-title">Análise da IA</h3>
        <InsightBlock payload={payload} />
      </section>
    </div>
  );
}
