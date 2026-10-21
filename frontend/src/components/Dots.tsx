import type { PageDef } from '../config';

interface Props {
  pages: PageDef[];
  index: number;
  onSelectRow: (row: number) => void;
  onSelectColumn: (column: number) => void;
}

export default function Dots({ pages, index, onSelectRow, onSelectColumn }: Props) {
  const current = pages[index];
  const navigablePages = pages.filter((page) => page.navigable !== false);
  const rows = [...new Set(navigablePages.map((page) => page.row))].sort((a, b) => a - b);
  const currentRowPages = navigablePages
    .filter((page) => page.row === current?.row)
    .sort((a, b) => a.column - b.column);

  return (
    <nav className="dots" aria-label="Navegação por andares e páginas">
      <div className="dots-floors" aria-label="Andares">
        {rows.map((row) => {
          return (
            <button
              key={row}
              type="button"
              className={`dot${current?.row === row ? ' on' : ''}`}
              aria-label={`Andar ${row}`}
              aria-current={current?.row === row ? 'true' : undefined}
              onClick={() => onSelectRow(row)}
            />
          );
        })}
      </div>
      <div className="dots-pages" aria-label="Páginas">
        {currentRowPages.map((page) => {
          return (
            <button
              key={page.id}
              type="button"
              className={`dot${current?.id === page.id ? ' on' : ''}`}
              aria-label={`Página ${page.column}: ${page.title}`}
              aria-current={current?.id === page.id ? 'true' : undefined}
              onClick={() => onSelectColumn(page.column)}
            />
          );
        })}
      </div>
    </nav>
  );
}
