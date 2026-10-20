import { tables } from '../content';

export default function PageTables() {
  return (
    <div className="page tables">
      <h2 className="page-title">Tabelas</h2>
      {tables.map((t) => (
        <section key={t.title} className="table-block">
          <h3>{t.title}</h3>
          <table>
            <thead>
              <tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {t.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
