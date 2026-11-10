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

type ExpenseFilter = 'all' | 'vitor' | 'sophia';

const origins: Record<Exclude<ExpenseFilter, 'all'>, string> = {
  vitor: 'iOS-Vitor',
  sophia: 'iOS-Sophia',
};
const filters: { id: ExpenseFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'vitor', label: 'Meu Cartão (Vitor)' },
  { id: 'sophia', label: 'Cartão Dela (Sophia)' },
];
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

export default function PageFinance() {
  const [payload, setPayload] = useState<FinancePayload | null>(null);
  const [filter, setFilter] = useState<ExpenseFilter>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      setPayload(await api<FinancePayload>('/finance'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar as finanças.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    return subscribeRealtime((action) => {
      if (action === 'RELOAD_FINANCE') void loadData();
    });
  }, [loadData]);

  const expenses = useMemo(() => {
    if (!payload) return [];
    if (filter === 'all') return payload.gastos;
    const origin = origins[filter];
    return payload.gastos.filter((expense) => expense.origem === origin);
  }, [filter, payload]);

  const totals = useMemo(() => {
    const result = { all: 0, vitor: 0, sophia: 0 };
    for (const expense of expenses) {
      result.all += expense.valor;
      if (expense.origem === origins.vitor) result.vitor += expense.valor;
      if (expense.origem === origins.sophia) result.sophia += expense.valor;
    }
    return {
      all: Number(result.all.toFixed(2)),
      vitor: Number(result.vitor.toFixed(2)),
      sophia: Number(result.sophia.toFixed(2)),
    };
  }, [expenses]);

  const categories = useMemo(() => {
    const totalsByCategory = new Map<string, number>();
    for (const expense of expenses) {
      totalsByCategory.set(
        expense.categoria,
        (totalsByCategory.get(expense.categoria) ?? 0) + expense.valor
      );
    }
    const total = [...totalsByCategory.values()].reduce((sum, value) => sum + value, 0);
    return [...totalsByCategory]
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({
        name,
        value: Number(value.toFixed(2)),
        width: total > 0 ? `${(value / total) * 100}%` : '0%',
      }));
  }, [expenses]);

  const exportSpreadsheet = async () => {
    setExporting(true);
    setError('');
    try {
      const query = filter === 'all' ? '' : `?origem=${encodeURIComponent(origins[filter])}`;
      const response = await fetch(`/api/finance/exportar${query}`, {
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
        <div className="row finance-actions">
          <div className="finance-filters" role="group" aria-label="Filtrar gastos por cartão">
            {filters.map(({ id, label }) => (
              <button
                className={`finance-filter${filter === id ? ' is-active' : ''}`}
                type="button"
                key={id}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="btn ghost finance-refresh"
            type="button"
            aria-label={loading ? 'Atualizando finanças' : 'Atualizar finanças'}
            title="Atualizar finanças"
            disabled={loading}
            onClick={() => void loadData()}
          >
            <span className={loading ? 'finance-refresh-icon is-loading' : 'finance-refresh-icon'} aria-hidden="true">🔄</span>
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
              <span>Total Geral</span>
              <strong>{currency.format(totals.all)}</strong>
            </div>
            <div className="finance-total">
              <span>Total Vitor</span>
              <strong>{currency.format(totals.vitor)}</strong>
            </div>
            <div className="finance-total">
              <span>Total Sophia</span>
              <strong>{currency.format(totals.sophia)}</strong>
            </div>
          </section>

          <section className="finance-section" aria-labelledby="finance-category-title">
            <h3 id="finance-category-title">Gastos por categoria</h3>
            {categories.length === 0 ? (
              <p className="muted">Ainda não há gastos para este filtro.</p>
            ) : (
              <div className="finance-chart" aria-label="Divisão dos gastos por categoria">
                {categories.map(({ name, value, width }) => (
                  <div className="finance-chart-row" key={name}>
                    <span className="finance-chart-label">{name}</span>
                    <div className="finance-chart-track">
                      <div className="finance-chart-bar" style={{ width }} />
                    </div>
                    <strong className="finance-chart-value">{currency.format(value)}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="finance-section" aria-labelledby="finance-expenses-title">
            <h3 id="finance-expenses-title">Últimos gastos</h3>
            {expenses.length === 0 ? (
              <p className="muted">Nenhum gasto registrado para este filtro.</p>
            ) : (
              <div className="finance-table-wrap">
                <table className="finance-table">
                  <thead>
                    <tr>
                      <th scope="col">Data</th>
                      <th scope="col">Estabelecimento</th>
                      <th scope="col">Categoria</th>
                      <th scope="col">Origem</th>
                      <th scope="col" className="finance-value-column">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((expense) => {
                      const originLabel = expense.origem === origins.vitor
                        ? 'Vitor'
                        : expense.origem === origins.sophia
                          ? 'Sophia'
                          : expense.origem || 'Outro';
                      return (
                        <tr key={expense._id}>
                          <td data-label="Data">{dateTime.format(new Date(expense.data))}</td>
                          <td data-label="Estabelecimento" className="finance-establishment">
                            {expense.estabelecimento}
                          </td>
                          <td data-label="Categoria">
                            <span className="finance-category-tag">{expense.categoria}</span>
                          </td>
                          <td data-label="Origem">
                            <span className={`finance-origin-badge${originLabel === 'Sophia' ? ' is-sophia' : ''}`}>
                              {originLabel}
                            </span>
                          </td>
                          <td data-label="Valor" className="finance-value-column">
                            {currency.format(expense.valor)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
