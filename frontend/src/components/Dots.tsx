export default function Dots({ count, index, onSelect }: { count: number; index: number; onSelect: (i: number) => void }) {
  return (
    <nav className="dots" aria-label="Páginas">
      {Array.from({ length: count }, (_, i) => (
        <button key={i} className={`dot${i === index ? ' on' : ''}`} onClick={() => onSelect(i)} aria-label={`Página ${i + 1}`} aria-current={i === index} />
      ))}
    </nav>
  );
}
