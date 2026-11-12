import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
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
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  hourCycle: 'h23',
  timeZone: 'America/Sao_Paulo',
});

export default function PageFinance() {
  const [payload, setPayload] = useState<FinancePayload | null>(null);
  const [filter, setFilter] = useState<ExpenseFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ valor: '', estabelecimento: '', categoria: 'Outros', responsavel: 'Vitor' });
  const [savingExpense, setSavingExpense] = useState(false);

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

  const categoryOptions = useMemo(
    () => [...new Set(payload?.gastos.map((expense) => expense.categoria) ?? [])]
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [payload]
  );

  const expenses = useMemo(() => {
    if (!payload) return [];
    return payload.gastos.filter((expense) => {
      const matchesOrigin = filter === 'all' || expense.origem === origins[filter];
      const matchesCategory = !categoryFilter || expense.categoria === categoryFilter;
      return matchesOrigin && matchesCategory;
    });
  }, [categoryFilter, filter, payload]);

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
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('origem', origins[filter]);
      if (categoryFilter) params.set('categoria', categoryFilter);
      const query = params.size > 0 ? `?${params.toString()}` : '';
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

  const deleteExpense = async (expense: Expense) => {
    if (!window.confirm(`Excluir o gasto de ${expense.estabelecimento}?`)) return;
    setDeletingId(expense._id);
    setError('');
    try {
      await api<void>(`/finance/${encodeURIComponent(expense._id)}`, { method: 'DELETE' });
      setPayload((current) => current
        ? { ...current, gastos: current.gastos.filter((item) => item._id !== expense._id) }
        : current);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível excluir o gasto.');
    } finally {
      setDeletingId('');
    }
  };

  const openExpenseModal = (expense?: Expense) => {
    setEditingExpense(expense || null);
    setExpenseForm(expense ? { valor: String(expense.valor).replace('.', ','), estabelecimento: expense.estabelecimento, categoria: expense.categoria, responsavel: expense.responsavel } : { valor: '', estabelecimento: '', categoria: 'Outros', responsavel: 'Vitor' });
    setExpenseModalOpen(true);
  };
  const saveExpense = async (event: FormEvent) => {
    event.preventDefault();
    setSavingExpense(true); setError('');
    try {
      const body = { ...expenseForm, data: editingExpense?.data || new Date().toISOString(), local: editingExpense?.local || '', origem: editingExpense?.origem || (expenseForm.responsavel.toLocaleLowerCase('pt-BR') === 'sophia' ? origins.sophia : origins.vitor) };
      if (editingExpense) await api<Expense>(`/finance/${editingExpense._id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/finance/add', { method: 'POST', body: JSON.stringify(body) });
      setExpenseModalOpen(false); await loadData();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o gasto.'); }
    finally { setSavingExpense(false); }
  };

  const renderCategoryTag = (category: string) => {
    let hue = 0;
    for (let index = 0; index < category.length; index += 1) {
      hue = (hue * 31 + category.charCodeAt(index)) % 360;
    }
    return (
      <span
        className="finance-category-tag"
        style={{
          backgroundColor: `hsl(${hue} 75% 55% / 12%)`,
          color: `hsl(${hue} 75% 72%)`,
        }}
      >
        {category}
      </span>
    );
  };

  const renderDeleteButton = (expense: Expense) => (
    <button
      className="finance-delete"
      type="button"
      aria-label={`Excluir gasto de ${expense.estabelecimento}`}
      title="Excluir gasto"
      disabled={deletingId === expense._id}
      onClick={() => void deleteExpense(expense)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" />
      </svg>
    </button>
  );
  const renderActions = (expense: Expense) => <div className="finance-row-actions"><button className="finance-delete" type="button" aria-label={`Editar gasto de ${expense.estabelecimento}`} title="Editar gasto" onClick={() => openExpenseModal(expense)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20ZM14 7l3 3" /></svg></button>{renderDeleteButton(expense)}</div>;

  return (
    <main className="finance-page">
      <header className="finance-header">
        <h2 className="page-title">Finanças do mês</h2>
        <div className="row finance-actions">
          <button className="btn" type="button" onClick={() => openExpenseModal()}>Novo Gasto</button>
          <button
            className="btn ghost finance-refresh"
            type="button"
            aria-label={loading ? 'Atualizando finanças' : 'Atualizar finanças'}
            title="Atualizar finanças"
            disabled={loading}
            onClick={() => void loadData()}
          >
            <svg className={loading ? 'finance-refresh-icon is-loading' : 'finance-refresh-icon'} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 7v5h-5M4 17v-5h5m-3.1-3A7 7 0 0 1 18 7l2 5M4 12l2 5a7 7 0 0 0 12.1 2" />
            </svg>
          </button>
          <button className="btn ghost finance-export" type="button" disabled={exporting} onClick={() => void exportSpreadsheet()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4" />
            </svg>
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
            <div className="finance-total finance-total-primary">
              <span>Total Geral</span>
              <strong className="finance-numeric">{currency.format(totals.all)}</strong>
            </div>
            <div className="finance-total">
              <span>Vitor</span>
              <strong className="finance-numeric">{currency.format(totals.vitor)}</strong>
            </div>
            <div className="finance-total">
              <span>Sophia</span>
              <strong className="finance-numeric">{currency.format(totals.sophia)}</strong>
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
                    <strong className="finance-chart-value finance-numeric">{currency.format(value)}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="finance-section" aria-labelledby="finance-expenses-title">
            <h3 id="finance-expenses-title">Últimos gastos</h3>
            <div className="finance-toolbar" aria-label="Filtros de gastos">
              <label className="finance-select">
                <span>Origem</span>
                <select
                  value={filter}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value === 'all' || value === 'vitor' || value === 'sophia') setFilter(value);
                  }}
                >
                  <option value="all">Todos</option>
                  <option value="vitor">Vitor</option>
                  <option value="sophia">Sophia</option>
                </select>
              </label>
              <label className="finance-select">
                <span>Categoria</span>
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.currentTarget.value)}>
                  <option value="">Todas</option>
                  {categoryOptions.map((category) => <option value={category} key={category}>{category}</option>)}
                </select>
              </label>
            </div>
            {expenses.length === 0 ? (
              <p className="muted">Nenhum gasto registrado para este filtro.</p>
            ) : (
              <>
                <div className="finance-table-wrap">
                <table className="finance-table">
                  <thead>
                    <tr>
                      <th scope="col">Data</th>
                      <th scope="col">Estabelecimento</th>
                      <th scope="col">Categoria</th>
                      <th scope="col">Origem</th>
                      <th scope="col" className="finance-value-column">Valor</th>
                      <th scope="col" className="finance-action-column">
                        <span className="finance-visually-hidden">Ações</span>
                      </th>
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
                          <td data-label="Data" className="finance-numeric">{dateTime.format(new Date(expense.data))}</td>
                          <td data-label="Estabelecimento" className="finance-establishment">
                            {expense.estabelecimento}
                          </td>
                          <td data-label="Categoria">
                            {renderCategoryTag(expense.categoria)}
                          </td>
                          <td data-label="Origem">
                            <span className={`finance-origin-badge${originLabel === 'Sophia' ? ' is-sophia' : ''}`}>
                              {originLabel}
                            </span>
                          </td>
                          <td data-label="Valor" className="finance-value-column finance-numeric">
                            {currency.format(expense.valor)}
                          </td>
                          <td className="finance-action-column">{renderActions(expense)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                <div className="finance-mobile-list">
                  {expenses.map((expense) => (
                    <article className="finance-mobile-card" key={expense._id}>
                      <div className="finance-mobile-card-top">
                        <div>
                          <span className="finance-mobile-date finance-numeric">{dateTime.format(new Date(expense.data))}</span>
                          <strong className="finance-mobile-establishment">{expense.estabelecimento}</strong>
                        </div>
                        {renderActions(expense)}
                      </div>
                      <div className="finance-mobile-card-bottom">
                        <strong className="finance-mobile-value finance-numeric">{currency.format(expense.valor)}</strong>
                        <span className={`finance-origin-badge${expense.origem === origins.sophia ? ' is-sophia' : ''}`}>
                          {expense.origem === origins.vitor
                            ? 'Vitor'
                            : expense.origem === origins.sophia
                              ? 'Sophia'
                              : expense.origem || 'Outro'}
                        </span>
                        {renderCategoryTag(expense.categoria)}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
      {expenseModalOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingExpense) setExpenseModalOpen(false); }}><form className="modal finance-expense-modal" onSubmit={saveExpense}><header className="modal-head"><h3>{editingExpense ? 'Editar gasto' : 'Novo gasto'}</h3><button className="modal-close" type="button" aria-label="Fechar" onClick={() => setExpenseModalOpen(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></header><label className="field"><span>Valor</span><input inputMode="decimal" value={expenseForm.valor} required placeholder="0,00" onChange={(event) => setExpenseForm((form) => ({ ...form, valor: event.target.value }))} /></label><label className="field"><span>Estabelecimento</span><input value={expenseForm.estabelecimento} required maxLength={200} onChange={(event) => setExpenseForm((form) => ({ ...form, estabelecimento: event.target.value }))} /></label><label className="field"><span>Categoria</span><input value={expenseForm.categoria} required maxLength={80} onChange={(event) => setExpenseForm((form) => ({ ...form, categoria: event.target.value }))} /></label><label className="field"><span>Responsável</span><select value={expenseForm.responsavel} onChange={(event) => setExpenseForm((form) => ({ ...form, responsavel: event.target.value }))}><option>Vitor</option><option>Sophia</option></select></label><footer className="modal-foot"><button className="btn ghost" type="button" onClick={() => setExpenseModalOpen(false)}>Cancelar</button><button className="btn" type="submit" disabled={savingExpense}>{savingExpense ? 'Salvando…' : 'Salvar'}</button></footer></form></div>}
    </main>
  );
}
