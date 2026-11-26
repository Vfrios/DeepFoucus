import OpenAI from 'openai';

export type ProviderKind = 'gemini' | 'groq' | 'openrouter' | 'custom';

interface CacheEntry {
  models: string[];
  expiresAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos
const modelCache = new Map<string, CacheEntry>();

const NON_CHAT_PATTERNS = [
  /embed/i,
  /whisper/i,
  /tts/i,
  /audio/i,
  /speech/i,
  /imagen/i,
  /veo/i,
  /lyria/i,
  /aqa/i,
  /guard/i,
  /moderation/i,
  /rerank/i,
  /dall-e/i,
  /transcribe/i,
  /realtime/i,
  /live/i,
  /robotics/i,
  /computer-use/i,
  /deep-research/i,
  /playai/i,
  /orpheus/i,
  /image/i,
  /nano-banana/i,
  /omni/i,
  /decision/i,
  /genie/i,
  /translate/i,
];

function isChatModelId(id: string): boolean {
  if (!id) return false;
  return !NON_CHAT_PATTERNS.some((re) => re.test(id));
}

function normalizeModelId(kind: ProviderKind, rawId: string): string {
  const id = rawId.trim();
  if (kind === 'gemini') {
    return id.replace(/^models\//i, '');
  }
  return id;
}

function scoreModel(kind: ProviderKind, id: string): number {
  const lower = id.toLowerCase();
  if (kind === 'gemini') {
    if (!lower.startsWith('gemini-')) return -100;
    let score = 10;
    if (lower.includes('flash-lite')) score += 45; // maior cota diária (RPD)
    else if (lower.includes('flash')) score += 30;
    if (lower.includes('3.8') || lower.includes('3.6') || lower.includes('3.5') || lower.includes('3.1') || lower.includes('3-')) {
      score += 25;
    } else if (lower.includes('2.5')) {
      score += 10;
    } else if (lower.includes('2.0') || lower.includes('2-')) {
      score -= 10;
    }
    if (lower.includes('latest')) score += 15;
    if (lower.includes('exp') || lower.includes('preview')) score -= 5;
    if (lower.includes('pro')) score -= 15; // planos gratuitos costumam ter cota 0/0 em Pro
    return score;
  }

  if (kind === 'groq') {
    let score = 10;
    if (lower.includes('llama-3.3') || lower.includes('llama-4')) score += 30;
    if (lower.includes('gpt-oss-120b') || lower.includes('qwen')) score += 25;
    if (lower.includes('70b') || lower.includes('versatile') || lower.includes('instruct')) score += 15;
    if (lower.includes('8b') || lower.includes('instant')) score += 10;
    if (lower.includes('compound')) score -= 10;
    return score;
  }

  if (kind === 'openrouter') {
    if (lower === 'openrouter/free') return 100;
    if (!lower.endsWith(':free')) return -100;
    let score = 20;
    if (lower.includes('llama') || lower.includes('qwen') || lower.includes('gemma') || lower.includes('gemini')) {
      score += 15;
    }
    if (lower.includes('instruct') || lower.includes('it')) score += 5;
    return score;
  }

  return 10;
}

export function inferProviderKind(baseURL: string): ProviderKind {
  const lower = baseURL.toLowerCase();
  if (lower.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (lower.includes('api.groq.com')) return 'groq';
  if (lower.includes('openrouter.ai')) return 'openrouter';
  return 'custom';
}

/**
 * Descobre dinamicamente os modelos de chat disponíveis no provedor via `/models`,
 * ordenados por adequação, com cache em memória.
 */
export async function resolveAvailableModels(params: {
  apiKey: string;
  baseURL: string;
  kind?: ProviderKind;
  preferredModel?: string;
  limit?: number;
}): Promise<string[]> {
  const kind = params.kind ?? inferProviderKind(params.baseURL);
  const limit = params.limit ?? 3;
  const preferred = (params.preferredModel || '').trim();
  const cacheKey = `${kind}:${params.baseURL}`;

  let discovered: string[] = [];
  const cached = modelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    discovered = cached.models;
  } else {
    try {
      const client = new OpenAI({
        apiKey: params.apiKey,
        baseURL: params.baseURL,
        timeout: 10_000,
        maxRetries: 0,
      });
      const page = await client.models.list();
      const ids = new Set<string>();
      for (const item of page.data || []) {
        if (!item?.id) continue;
        const normalized = normalizeModelId(kind, item.id);
        if (!isChatModelId(normalized)) continue;
        if (kind === 'openrouter' && !normalized.endsWith(':free') && normalized !== 'openrouter/free') {
          continue;
        }
        if (kind === 'gemini' && !normalized.toLowerCase().startsWith('gemini-')) {
          continue;
        }
        ids.add(normalized);
      }

      if (kind === 'openrouter') {
        ids.add('openrouter/free');
      }

      discovered = Array.from(ids).sort((a, b) => scoreModel(kind, b) - scoreModel(kind, a));

      if (discovered.length > 0) {
        modelCache.set(cacheKey, {
          models: discovered,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      }
    } catch {
      if (kind === 'openrouter') {
        discovered = ['openrouter/free'];
      }
    }
  }

  const result: string[] = [];
  if (preferred) result.push(preferred);
  for (const m of discovered) {
    if (!result.includes(m)) result.push(m);
    if (result.length >= limit) break;
  }

  return result;
}
