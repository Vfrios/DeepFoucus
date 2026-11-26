import OpenAI from 'openai';
import { provedores } from './ai';
import { resolveAvailableModels } from './aiModels';
import {
  BriefingSections,
  stripMarkdownAndEmoji,
  validateBriefingText,
} from './briefingCore';

export const BRIEFING_AI_TIMEOUT_MS = 6_000;
export const SPEECH_MAX_WORDS = 125;
export const FULL_MAX_WORDS = 450;

export const BRIEFING_AI_SYSTEM_PROMPT = `
Você é um assistente pessoal direto e objetivo. Redija o briefing da manhã em português do Brasil natural para ser falado pelo iPhone.
Retorne APENAS JSON válido no formato {"speech":"...","full":"..."}.

Regras obrigatórias:
1. Use SOMENTE os dados fornecidos no JSON de entrada. Não invente nenhum fato, horário, nota ou evento.
2. NÃO adicione frases genéricas de motivação, conselhos genéricos ou saudações repetidas.
3. NÃO use markdown (sem asteriscos, sem hashtags, sem crases, sem listas com hífen) e NÃO use emojis.
4. Use horários por extenso curto ("às 18h", "às 19h30") e datas relativas ("hoje", "amanhã", "sexta").
5. Mantenha a ordem das seções: cabeçalho, foco do dia, clima, agenda, PUC, tarefas, alertas do sistema e notas de falha (omitindo qualquer seção nula ou vazia).
6. Nunca repita o mesmo item ou o mesmo número duas vezes.
7. "speech": máximo de 115 palavras (cerca de 15 a 20 segundos falados). Inclua apenas o essencial: saudação + data, foco do dia, clima em uma frase, agenda principal, entregas PUC de hoje/amanhã/atrasadas, contagem de a verificar/prontas para enviar e alertas.
8. "full": versão completa para ler na tela, com todas as seções presentes nos dados, em parágrafos curtos separados por linha em branco.
`.trim();

export interface BriefingAiRedactionResult {
  usedAi: boolean;
  provider: string | null;
  model: string | null;
  speech: string | null;
  full: string | null;
  fallbackReason: string | null;
}

export type BriefingAiCaller = (
  systemPrompt: string,
  userJson: string,
  timeoutMs: number
) => Promise<{ provider: string; model: string; raw: unknown }>;

async function defaultBriefingAiCaller(
  systemPrompt: string,
  userJson: string,
  timeoutMs: number
): Promise<{ provider: string; model: string; raw: unknown }> {
  const deadline = Date.now() + timeoutMs;
  const availableProviders = provedores().filter((p) => Boolean(p.apiKey));
  if (availableProviders.length === 0) {
    throw new Error('no_ai_providers_configured');
  }

  let lastError = 'all_providers_failed';

  for (let idx = 0; idx < availableProviders.length; idx++) {
    const p = availableProviders[idx];
    const remaining = deadline - Date.now();
    if (remaining <= 400) {
      throw new Error('ai_timeout');
    }

    const providersLeft = availableProviders.length - idx;
    const perProviderBudget = Math.max(1500, Math.min(remaining, Math.floor(remaining / providersLeft) + 1200));

    let model = p.model;
    if (!model) {
      try {
        const models = await Promise.race([
          resolveAvailableModels({
            apiKey: p.apiKey!,
            baseURL: p.baseURL,
            preferredModel: p.model,
            limit: 1,
          }),
          new Promise<string[]>((resolve) => setTimeout(() => resolve([]), Math.min(1500, remaining))),
        ]);
        model = models[0] || '';
      } catch {
        model = '';
      }
    }
    if (!model) {
      lastError = `no_model_${p.nome.toLowerCase()}`;
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(perProviderBudget, Math.max(300, deadline - Date.now())));

    try {
      const client = new OpenAI({
        apiKey: p.apiKey,
        baseURL: p.baseURL,
        timeout: Math.min(perProviderBudget, Math.max(300, deadline - Date.now())),
        maxRetries: 0,
      });

      const response = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userJson },
          ],
          temperature: 0.2,
          max_tokens: 700,
          response_format: { type: 'json_object' },
          ...(p.reasoningEffort && model.includes('gpt-oss') ? { reasoning_effort: p.reasoningEffort } : {}),
        },
        { signal: controller.signal }
      );

      const content = response.choices[0]?.message?.content || '';
      const parsed = JSON.parse(content);
      return { provider: p.nome, model, raw: parsed };
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'timeout' : String(err?.message || 'error').slice(0, 100);
      console.warn(`[briefing/ai] ${p.nome} (${model}) falhou: ${msg}`);
      lastError = `${p.nome}:${msg}`;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}

/**
 * Redige o briefing com IA a partir das seções estruturadas já filtradas.
 * Se a IA falhar, estourar 6s ou produzir texto fora das regras, retorna usedAi=false para fallback determinístico.
 */
export async function redactBriefingWithAI(
  sections: BriefingSections,
  opts: { timeoutMs?: number; caller?: BriefingAiCaller } = {}
): Promise<BriefingAiRedactionResult> {
  const timeoutMs = opts.timeoutMs ?? BRIEFING_AI_TIMEOUT_MS;
  const caller = opts.caller ?? defaultBriefingAiCaller;
  const userPayload = JSON.stringify(sections);

  try {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const response = await Promise.race([
      caller(BRIEFING_AI_SYSTEM_PROMPT, userPayload, timeoutMs),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('ai_timeout')), timeoutMs);
      }),
    ]).finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    });

    const obj =
      response.raw && typeof response.raw === 'object' && !Array.isArray(response.raw)
        ? (response.raw as Record<string, unknown>)
        : {};

    const rawSpeech = typeof obj.speech === 'string' ? obj.speech : '';
    const rawFull = typeof obj.full === 'string' ? obj.full : '';

    const speechCheck = validateBriefingText(rawSpeech, SPEECH_MAX_WORDS);
    const fullCheck = validateBriefingText(rawFull, FULL_MAX_WORDS);

    // Se vier com markdown/emoji leve mas dentro do limite, sanitiza e revalida; se estourar limite ou vier vazio, cai no determinístico
    const finalSpeech = speechCheck.ok
      ? speechCheck.text
      : validateBriefingText(stripMarkdownAndEmoji(rawSpeech), SPEECH_MAX_WORDS).ok
        ? stripMarkdownAndEmoji(rawSpeech)
        : null;

    const finalFull = fullCheck.ok
      ? fullCheck.text
      : validateBriefingText(stripMarkdownAndEmoji(rawFull), FULL_MAX_WORDS).ok
        ? stripMarkdownAndEmoji(rawFull)
        : null;

    if (!finalSpeech || !finalFull) {
      return {
        usedAi: false,
        provider: response.provider,
        model: response.model,
        speech: null,
        full: null,
        fallbackReason: !finalSpeech
          ? `invalid_speech:${speechCheck.reason || 'invalid'}`
          : `invalid_full:${fullCheck.reason || 'invalid'}`,
      };
    }

    return {
      usedAi: true,
      provider: response.provider,
      model: response.model,
      speech: finalSpeech,
      full: finalFull,
      fallbackReason: null,
    };
  } catch (err: any) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      usedAi: false,
      provider: null,
      model: null,
      speech: null,
      full: null,
      fallbackReason: reason,
    };
  }
}
