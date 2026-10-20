import { photos } from '../content';

export default function PagePhotos() {
  return (
    <div className="page photos">
      <h2 className="page-title">Fotos</h2>
      {photos.length === 0 ? (
        <p className="muted">Adicione URLs de imagens em <code>frontend/src/content.ts</code>.</p>
      ) : (
        <div className="photo-grid">
          {photos.map((u) => (
            <img key={u} src={u} alt="" loading="lazy" />
          ))}
        </div>
      )}
    </div>
  );
}
