import emoji = require('emoji-dictionary');

const customEmojis: Record<string, string> = {
  'papel higienico': '🧻',
  arroz: '🍚',
  feijao: '🫘',
  carne: '🥩',
  frango: '🍗',
  sabao: '🧼',
  detergente: '🧴',
  maca: '🍎',
  leite: '🥛',
  pao: '🍞',
  ovo: '🥚',
  queijo: '🧀',
  banana: '🍌',
  tomate: '🍅',
  batata: '🥔',
  cebola: '🧅',
  cenoura: '🥕',
  peixe: '🐟',
};

const dictionaryNames = new Set(emoji.names);

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function wordVariants(word: string): string[] {
  const variants = new Set<string>();

  if (word.endsWith('oes')) variants.add(`${word.slice(0, -3)}ao`);
  if (word.endsWith('aes')) variants.add(`${word.slice(0, -3)}ao`);
  if (word.endsWith('ais')) variants.add(`${word.slice(0, -3)}al`);
  if (word.endsWith('ns')) variants.add(`${word.slice(0, -1)}m`);
  if (word.endsWith('es')) variants.add(word.slice(0, -2));
  if (word.endsWith('s')) variants.add(word.slice(0, -1));

  if (word.endsWith('ao')) variants.add(`${word.slice(0, -2)}oes`);
  else if (word.endsWith('m')) variants.add(`${word.slice(0, -1)}ns`);
  else if (!word.endsWith('s')) variants.add(`${word}s`);

  return [...variants].filter(Boolean);
}

function lookupWord(word: string): string | undefined {
  const dictionaryName = word.replace(/\s+/g, '_');
  if (!dictionaryNames.has(dictionaryName)) return undefined;
  return emoji.getUnicode(dictionaryName);
}

function lookupItemWord(word: string): string | undefined {
  return customEmojis[word] || lookupWord(word);
}

export function getItemEmoji(itemName: string): string {
  const normalized = normalize(itemName);
  if (!normalized) return '📦';

  const exactMatch = lookupItemWord(normalized);
  if (exactMatch) return exactMatch;

  for (const variant of wordVariants(normalized)) {
    const match = lookupItemWord(variant);
    if (match) return match;
  }

  const words = normalized.split(' ').reverse();
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const match = lookupItemWord(word);
    if (match) return match;
    for (const variant of wordVariants(word)) {
      const variantMatch = lookupItemWord(variant);
      if (variantMatch) return variantMatch;

      const phrase = [...words];
      phrase[index] = variant;
      const phraseMatch = lookupItemWord(phrase.reverse().join(' '));
      if (phraseMatch) return phraseMatch;
    }
  }

  return '📦';
}
