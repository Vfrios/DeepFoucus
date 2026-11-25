/**
 * Vocabulário de produtos comuns de mercado (pt-BR), usado para corrigir erros
 * de OCR em letra manuscrita (ex.: "QUEISO" -> "Queijo", "SVO" -> "Ovo").
 */
export const GROCERY_VOCABULARY: string[] = [
  'Leite', 'Queijo', 'Pão', 'Ovo', 'Ovos', 'Arroz', 'Feijão', 'Macarrão', 'Farinha', 'Açúcar', 'Sal', 'Café',
  'Óleo', 'Azeite', 'Vinagre', 'Manteiga', 'Margarina', 'Requeijão', 'Iogurte', 'Presunto', 'Mortadela',
  'Frango', 'Carne', 'Peixe', 'Linguiça', 'Salsicha', 'Bacon', 'Carne Moída', 'Bife', 'Costela',
  'Tomate', 'Cebola', 'Alho', 'Batata', 'Cenoura', 'Alface', 'Pepino', 'Pimentão', 'Abobrinha', 'Brócolis',
  'Couve', 'Repolho', 'Beterraba', 'Chuchu', 'Mandioca', 'Milho', 'Ervilha', 'Cheiro Verde', 'Limão', 'Laranja',
  'Banana', 'Maçã', 'Uva', 'Mamão', 'Melancia', 'Abacaxi', 'Morango', 'Manga', 'Pera', 'Abacate', 'Melão',
  'Água', 'Suco', 'Refrigerante', 'Cerveja', 'Vinho', 'Chá', 'Achocolatado', 'Leite em Pó', 'Leite Condensado',
  'Creme de Leite', 'Biscoito', 'Bolacha', 'Bolo', 'Chocolate', 'Cereal', 'Aveia', 'Granola', 'Mel', 'Geleia',
  'Molho de Tomate', 'Extrato de Tomate', 'Ketchup', 'Maionese', 'Mostarda', 'Catchup', 'Orégano', 'Pimenta',
  'Fermento', 'Amido de Milho', 'Sabão em Pó', 'Sabão', 'Detergente', 'Amaciante', 'Desinfetante',
  'Água Sanitária', 'Esponja', 'Papel Higiênico', 'Papel Toalha', 'Guardanapo', 'Shampoo', 'Condicionador',
  'Sabonete', 'Creme Dental', 'Escova de Dente', 'Desodorante', 'Absorvente', 'Fralda', 'Saco de Lixo',
  'Pipoca', 'Amendoim', 'Castanha', 'Lentilha', 'Grão de Bico', 'Tapioca', 'Pão de Forma', 'Torrada',
  'Atum', 'Sardinha', 'Camarão', 'Peito de Frango', 'Coxa de Frango', 'Pizza', 'Lasanha', 'Hambúrguer',
];

function normalizeWord(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]/g, '');
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

const LOWERCASE_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'para', 'a', 'o']);

function titleCase(value: string): string {
  return value
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((word, index) => (index > 0 && LOWERCASE_WORDS.has(word)
      ? word
      : word.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase('pt-BR'))))
    .join(' ');
}

/**
 * Corrige cada candidato para o produto conhecido mais parecido (distância de edição
 * pequena em relação ao tamanho da palavra). Itens que já existem no app têm prioridade.
 * Sem correspondência próxima, apenas padroniza a capitalização.
 */
export function snapToKnownProducts(candidates: string[], knownItems: string[] = []): string[] {
  const vocabulary = [...knownItems, ...GROCERY_VOCABULARY]
    .map((name) => ({ name: name.trim(), key: normalizeWord(name) }))
    .filter((entry) => entry.key.length >= 2);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    const key = normalizeWord(candidate);
    let output = titleCase(candidate);

    if (key.length >= 3) {
      let best: { name: string; distance: number } | null = null;
      for (const entry of vocabulary) {
        const distance = editDistance(key, entry.key);
        const ratio = distance / Math.max(key.length, entry.key.length);
        if (ratio <= 0.34 && (!best || distance < best.distance)) {
          best = { name: entry.name, distance };
          if (distance === 0) break;
        }
      }
      if (best) output = titleCase(best.name);
    }

    const dedupe = normalizeWord(output);
    if (!dedupe || seen.has(dedupe)) continue;
    seen.add(dedupe);
    result.push(output);
  }
  return result;
}
