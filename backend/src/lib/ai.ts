import OpenAI from 'openai';

/**
 * FALLBACK EM CASCATA:
 * Tenta Groq -> Gemini -> OpenRouter, silenciosamente.
 * Só lança erro se TODOS falharem (ou estiverem sem chave).
 */

type Provedor = {
  nome: string;
  apiKey: string | undefined;
  baseURL: string;
  model: string;
};

export interface TarefaIA {
  texto: string;
  data: string; // ISO UTC-3 (ex.: "2026-10-26T20:00:00.000-03:00")
}

const SYSTEM_PROMPT = `
Você é um assistente que transforma roteiros de estudo em tarefas.
Retorne APENAS um JSON válido, sem markdown, sem comentários, no formato:
{ "tasks": [ { "texto": "Nome da tarefa", "data": "YYYY-MM-DDTHH:mm:ss.sss-03:00" } ] }

Regras:
- Fuso horário: Brasília (UTC-3). A string "data" deve terminar em "-03:00".
- Se o ano não for informado, use o ano atual (${new Date().getFullYear()}).
- Se o horário não for informado, use 20:00.
- "texto" deve ser curto e acionável (máx. 200 caracteres).
- Se o roteiro não contiver nenhuma tarefa reconhecível, retorne { "tasks": [] }.
`.trim();

function provedores(): Provedor[] {
  return [
    {
      nome: 'Groq',
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      model: 'llama3-70b-8192',
    },
    {
      nome: 'Gemini',
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      model: 'gemini-1.5-flash',
    },
    {
      nome: 'OpenRouter',
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'meta-llama/llama-3-8b-instruct:free',
    },
  ];
}

/** Valida e normaliza a resposta JSON do provedor. */
function normalizarTarefas(raw: unknown): TarefaIA[] {
  if (!raw || typeof raw !== 'object') throw new Error('json_invalido');
  const obj = raw as { tasks?: unknown };
  if (!Array.isArray(obj.tasks)) throw new Error('json_sem_tasks');

  const out: TarefaIA[] = [];
  for (const item of obj.tasks) {
    if (!item || typeof item !== 'object') continue;
    const t = item as { texto?: unknown; data?: unknown };
    const texto = typeof t.texto === 'string' ? t.texto.trim().slice(0, 200) : '';
    const data = typeof t.data === 'string' ? t.data : '';
    if (!texto || !data) continue;
    // Só aceita datas parseáveis
    if (isNaN(new Date(data).getTime())) continue;
    out.push({ texto, data });
  }
  return out;
}

export async function gerarTarefasIA(roteiro: string): Promise<TarefaIA[]> {
  const userPrompt = `Roteiro:\n${roteiro}`;

  for (const p of provedores()) {
    if (!p.apiKey) {
      // Pula silenciosamente provedor sem chave configurada
      continue;
    }

    try {
      const client = new OpenAI({ apiKey: p.apiKey, baseURL: p.baseURL });
      const response = await client.chat.completions.create({
        model: p.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const conteudo = response.choices[0]?.message?.content || '';
      const json = JSON.parse(conteudo);
      const tarefas = normalizarTarefas(json);

      // JSON válido (mesmo que vazio) é sucesso: o provedor respondeu
      return tarefas;
    } catch (err: any) {
      // Rate limit, timeout, JSON inválido, etc. — tenta o próximo
      const msg = err?.message ? String(err.message).slice(0, 120) : 'erro_desconhecido';
      console.warn(`[IA] ${p.nome} falhou: ${msg}`);
    }
  }

  throw new Error('Todos os provedores de IA falharam ou estão sem chave.');
}
