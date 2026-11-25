function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

const NON_PRODUCT_LINE = /\b(cnpj|cpf|nfc.?e|danfe|consumidor|subtotal|total|desconto|pagamento|dinheiro|pix|cartao|troco|valor|chave|protocolo|cupom|operador|cliente|atendimento|obrigado|volte sempre|item)\b/;

/** Remove, repetidamente, "0,586 kg x 59,90", "8 LT x 4,18" e preços/totais no fim da linha. */
function stripTrailingPricing(value: string): string {
  let line = value.trim();
  let previous: string;
  do {
    previous = line;
    line = line
      .replace(/\s+\d+(?:[.,]\d+)?\s*(?:kg|g|un|lt|l|ml|pc|pct|pt|bj|cx)?\s*[xX]\s*\d{1,4}[.,]\d{2}\s*$/i, '')
      .replace(/\s+\d{1,4}[.,]\d{2}\s*$/, '')
      .trim();
  } while (line !== previous);
  return line;
}

export function parseReceiptCandidates(text: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length < 3 || NON_PRODUCT_LINE.test(normalizeText(line))) continue;
    if (/^[\d\s.,:/-]+$/.test(line)) continue;
    // Ruído de OCR (ex.: "ha?") costuma ter menos de 3 letras de verdade
    if ((line.match(/\p{L}/gu) || []).length < 3) continue;

    line = stripTrailingPricing(line.replace(/^\d{4,}\s+/, ''));
    if (line.length < 3 || /^[\d\s.,:/-]+$/.test(line)) continue;

    const key = normalizeText(line);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(line.slice(0, 100));
    if (candidates.length === 30) break;
  }

  return candidates;
}
