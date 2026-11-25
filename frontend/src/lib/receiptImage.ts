/**
 * Preparação de imagem para OCR (tudo em memória, nada é enviado ao servidor).
 * Fotos de celular têm 12MP+ e travam o Tesseract no navegador; aqui reduzimos,
 * aplicamos tons de cinza com contraste e geramos versões rotacionadas.
 */

const MAX_SIDE = 1600;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
    img.src = url;
  });
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Reduz a imagem (respeitando a orientação EXIF do <img>) e normaliza contraste. */
export async function prepareReceiptCanvas(imageUrl: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(imageUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  // Tons de cinza + alongamento de contraste (ignora 2% extremos)
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = Math.round(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
    px[i] = px[i + 1] = px[i + 2] = g;
    hist[g] += 1;
  }
  const total = w * h;
  let low = 0;
  let high = 255;
  let acc = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v];
    if (acc >= total * 0.02) { low = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v -= 1) {
    acc += hist[v];
    if (acc >= total * 0.02) { high = v; break; }
  }
  const range = Math.max(1, high - low);
  for (let i = 0; i < px.length; i += 4) {
    const g = Math.min(255, Math.max(0, Math.round(((px[i] - low) / range) * 255)));
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** JPEG colorido e reduzido (data URL) para a leitura por IA. Fica só em memória. */
export async function receiptToJpegDataUrl(imageUrl: string): Promise<string> {
  const img = await loadImage(imageUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = Math.min(1, 1400 / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** Retorna uma cópia rotacionada (90, 180 ou 270 graus no sentido horário). */
export function rotateCanvas(source: HTMLCanvasElement, degrees: 90 | 180 | 270): HTMLCanvasElement {
  const swap = degrees !== 180;
  const out = makeCanvas(swap ? source.height : source.width, swap ? source.width : source.height);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}
