import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

interface DiaStats {
  dia: string; // YYYY-MM-DD
  concluidas: number;
  minutos: number;
}

interface Summary {
  streakDias: number;
  minutosHoje: number;
  metaSemanal: number;
}

// Faixas de cor por minutos de estudo
function corPorMinutos(m: number): string {
  if (m <= 0) return '#1a222c';
  if (m <= 30) return '#0e4429';
  if (m <= 60) return '#006d32';
  if (m <= 120) return '#26a641';
  return '#39d353';
}

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function PageStats() {
  const [dias, setDias] = useState<DiaStats[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [erro, setErro] = useState('');

  const anoAtual = new Date().getFullYear();

  useEffect(() => {
    let cancel = false;
    Promise.all([
      api<DiaStats[]>(`/stats/heatmap?year=${anoAtual}`),
      api<Summary>('/stats/summary'),
    ])
      .then(([h, s]) => {
        if (cancel) return;
        setDias(h);
        setSummary(s);
        setErro('');
      })
      .catch(() => {
        if (cancel) return;
        setErro('Não foi possível carregar as estatísticas.');
      });
    return () => {
      cancel = true;
    };
  }, [anoAtual]);

  // FASE 2: monta a grade do ano corrente.
  // Cálculo do heatmap: percorre o ano por semanas (colunas) e dias (linhas, 0=domingo).
  // 53 semanas × 7 dias = 371 células; dias fora do ano ficam vazios.
  const grid = useMemo(() => {
    const mapa = new Map<string, DiaStats>();
    for (const d of dias) mapa.set(d.dia, d);

    const inicioAno = new Date(anoAtual, 0, 1);
    // Garante que a 1ª coluna começa no domingo da semana de 1º de janeiro
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
    <div className="page stats">
      <h2 className="page-title">Progresso</h2>

      {summary && (
        <div
          style={{
            display: 'flex',
            gap: 20,
            flexWrap: 'wrap',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            padding: '12px 16px',
            marginBottom: 16,
          }}
        >
          <div>
            <div style={{ color: 'var(--mute)', fontSize: '.85rem' }}>Streak</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>
              🔥 {summary.streakDias} dia{summary.streakDias === 1 ? '' : 's'}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--mute)', fontSize: '.85rem' }}>Hoje</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{summary.minutosHoje} min</div>
          </div>
          <div>
            <div style={{ color: 'var(--mute)', fontSize: '.85rem' }}>Meta semanal</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>
              {summary.minutosHoje} / {summary.metaSemanal} min
            </div>
          </div>
        </div>
      )}

      {erro && <p className="notice">{erro}</p>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(53, 1fr)',
          gridTemplateRows: 'repeat(7, 1fr)',
          gridAutoFlow: 'column',
          gap: 3,
          maxWidth: 860,
          padding: '8px 0',
        }}
      >
        {grid.map((c, i) => (
          <div
            key={i}
            title={
              c.dia && c.stats
                ? `${c.dia} · ${c.stats.concluidas} concluída(s) · ${c.stats.minutos} min`
                : c.dia
                ? `${c.dia} · sem atividade`
                : ''
            }
            style={{
              aspectRatio: '1 / 1',
              borderRadius: 2,
              background: c.dia ? corPorMinutos(c.stats?.minutos || 0) : 'transparent',
              border: c.dia ? 'none' : '1px solid transparent',
            }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 12, color: 'var(--mute)', fontSize: '.85rem' }}>
        <span>Menos</span>
        {[0, 15, 45, 90, 150].map((m) => (
          <span
            key={m}
            style={{ width: 12, height: 12, borderRadius: 2, background: corPorMinutos(m), display: 'inline-block' }}
          />
        ))}
        <span>Mais</span>
      </div>
    </div>
  );
}
