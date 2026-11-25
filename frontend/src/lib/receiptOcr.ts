function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

const NON_PRODUCT_LINE = /\b(cnpj|cpf|nfc.?e|danfe|consumidor|subtotal|total|desconto|pagamento|dinheiro|pix|cartao|troco|valor|chave|protocolo|cupom|operador|cliente|atendimento|obrigado|volte sempre|item)\b/;

export function parseReceiptCandidates(text: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length < 3 || NON_PRODUCT_LINE.test(normalizeText(line))) continue;
    if (/^[\d\s.,:/-]+$/.test(line)) continue;
    // Ruído de OCR (ex.: "ha?") costuma ter menos de 3 letras de verdade
    if ((line.match(/\p{L}/gu) || []).length < 3) continue;

    line = line
      .replace(/^\d{4,}\s+/, '')
      .replace(/\s+(?:\d{1,3}\s*[xX]\s*)?\d{1,4}[,.]\d{2}\s*$/, '')
      .trim();
    if (line.length < 3 || /^[\d\s.,:/-]+$/.test(line)) continue;

    const key = normalizeText(line);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(line.slice(0, 100));
    if (candidates.length === 30) break;
  }

  return candidates;
}
