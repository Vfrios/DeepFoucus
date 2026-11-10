import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken } from '../lib/api';
import { subscribeRealtime } from '../lib/realtime';

interface Expense {
  _id: string;
  data: string;
  valor: number;
  estabelecimento: string;
  local: string;
  responsavel: string;
  categoria: string;
  origem: string;
}

interface FinancePayload {
  gastos: Expense[];
  resumo: {
    totalGeral: number;
    porResponsavel: Record<string, number>;
    porCategoria: Record<string, number>;
  };
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

export default function PageFinance() {
  const [payload, setPayload] = useState<FinancePayload | null>(null);
  const [showValues, setShowValues] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setPayload(await api<FinancePayload>('/finance'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar as finanças.');
    }
  }, []);

  useEffect(() => {
    void load();
    return subscribeRealtime((action) => {
      if (action === 'RELOAD_FINANCE') void load();
    });
  }, [load]);

  const categories = useMemo(() => {
    const entries = Object.entries(payload?.resumo.porCategoria ?? {})
      .sort(([, a], [, b]) => b - a);
    const max = Math.max(0, ...entries.map(([, value]) => value));
    return entries.map(([name, value]) => ({
      name,
      value,
      width: max > 0 ? `${(value / max) * 100}%` : '0%',
    }));
  }, [payload]);

  const exportSpreadsheet = async () => {
    setExporting(true);
    setError('');
    try {
      const response = await fetch('/api/finance/exportar', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (response.status === 401) {
        window.dispatchEvent(new Event('wd:unauthorized'));
        throw new Error('Sessão expirada. Entre novamente.');
      }
      if (!response.ok) throw new Error((await response.text()) || 'Falha ao exportar planilha.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'financeiro.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível exportar a planilha.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="finance-page">
      <header className="finance-header">
        <h2 className="page-title">Finanças do mês</h2>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => setShowValues((visible) => !visible)}>
            {showValues ? 'Ocultar Valores' : 'Mostrar Valores'}
          </button>
          <button className="btn" type="button" disabled={exporting} onClick={() => void exportSpreadsheet()}>
            {exporting ? 'Exportando…' : 'Exportar Excel'}
          </button>
        </div>
      </header>

      {error && <p className="finance-error" role="alert">{error}</p>}
      {!payload ? (
        <p className="muted">Carregando finanças…</p>
      ) : (
        <>
          <section className="finance-summary" aria-label="Resumo mensal">
            <div className="finance-total">
              <span>Total do mês</span>
              <strong>{showValues ? currency.format(payload.resumo.totalGeral) : '••••••'}</strong>
            </div>
            {Object.entries(payload.resumo.porResponsavel).sort(([, a], [, b]) => b - a).map(([name, total]) => (
              <div className="finance-total finance-person" key={name}>
                <span>{name}</span>
                <strong>{showValues ? currency.format(total) : '••••••'}</strong>
              </div>
            ))}
          </section>

          <h3>Gastos por categoria</h3>
          {categories.length === 0 ? (
            <p className="muted">Ainda não há gastos neste mês.</p>
          ) : (
            <div className="finance-chart" role="img" aria-label="Gráfico de gastos agrupados por categoria">
              {categories.map(({ name, value, width }) => (
                <div className="finance-chart-row" key={name}>
                  <span className="finance-chart-label">{name}</span>
                  <div className="finance-chart-track">
                    <div className="finance-chart-bar" style={{ width }} />
                  </div>
                  <strong className="finance-chart-value">
                    {showValues ? currency.format(value) : '••••'}
                  </strong>
                </div>
              ))}
            </div>
          )}

          <h3>Últimos gastos</h3>
          {payload.gastos.length === 0 ? (
            <p className="muted">Nenhum gasto registrado neste mês.</p>
          ) : (
            <ul className="finance-list">
              {payload.gastos.map((expense) => (
                <li key={expense._id}>
                  <div className="finance-details">
                    <strong>{expense.estabelecimento}</strong>
                    <span className="muted">
                      {expense.categoria} · {expense.responsavel} · {dateTime.format(new Date(expense.data))}
                    </span>
                  </div>
                  <span className="finance-amount">
                    {showValues ? currency.format(expense.valor) : '••••'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
