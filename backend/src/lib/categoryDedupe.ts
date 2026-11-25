import { normalizeCategoryName } from './financeCategories';

export interface CategoryForDedupe<TId = unknown> {
  _id: TId;
  nome?: unknown;
  criadoEm?: unknown;
  sinonimos?: unknown;
}

export interface CategoryDedupeGroup<TId = unknown> {
  survivorId: TId;
  nomeNormalizado: string;
  sinonimos: string[];
  duplicateIds: TId[];
}

function createdAt(category: CategoryForDedupe<unknown>): number {
  if (category.criadoEm === undefined || category.criadoEm === null) return 0;
  const timestamp = new Date(category.criadoEm as string | number | Date).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function planCategoryDedupe<TId>(
  categories: readonly CategoryForDedupe<TId>[]
): CategoryDedupeGroup<TId>[] {
  const groups = new Map<string, CategoryForDedupe<TId>[]>();

  for (const category of categories) {
    if (typeof category.nome !== 'string') continue;
    const nomeNormalizado = normalizeCategoryName(category.nome);
    if (!nomeNormalizado) continue;
    const group = groups.get(nomeNormalizado) ?? [];
    group.push(category);
    groups.set(nomeNormalizado, group);
  }

  return Array.from(groups, ([nomeNormalizado, group]) => {
    if (group.length < 2) return null;
    const ordered = [...group].sort((a, b) =>
      createdAt(a) - createdAt(b) || String(a._id).localeCompare(String(b._id))
    );
    const survivor = ordered[0];
    const canonicalName = normalizeCategoryName(String(survivor.nome));
    const seen = new Set([canonicalName]);
    const sinonimos: string[] = [];

    for (const category of ordered) {
      const candidates = [
        ...(Array.isArray(category.sinonimos) ? category.sinonimos : []),
        ...(category === survivor || typeof category.nome !== 'string' ? [] : [category.nome]),
      ];
      for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const trimmed = candidate.trim();
        const normalized = normalizeCategoryName(trimmed);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        sinonimos.push(trimmed);
      }
    }

    return {
      survivorId: survivor._id,
      nomeNormalizado,
      sinonimos,
      duplicateIds: ordered.slice(1).map((category) => category._id),
    };
  }).filter((group): group is CategoryDedupeGroup<TId> => group !== null);
}
