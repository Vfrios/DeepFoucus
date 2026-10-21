import OpenAI from 'openai';

/**
 * MOTOR DE IA GENÉRICO
 * - `callAI(system, user)` tenta Groq → Gemini → OpenRouter silenciosamente.
 * - Funções específicas (`gerarTarefasIA`, `gerarInsightIA`) montam prompts e validam respostas.
 * - Mantém o formato antigo (`TarefaIA` com texto/data) como campos espelho de
 *   compatibilidade para o frontend legado; o formato canônico agora é o "ItemIA" rico.
 */

type Provedor = {
  nome: string;
  apiKey: string | undefined;
  baseURL: string;
  model: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
};

export type TipoItem = 'tarefa' | 'evento' | 'estudo';

/** Formato canônico retornado pela IA e persistido no Mongo. */
export interface ItemIA {
  titulo: string;               // máx. 200 chars
  descricao: string;            // máx. 1000 chars, pode ser ''
  tipo: TipoItem;
  inicio: string | null;        // null para tarefas sem data
  fim: string | null;           // ISO UTC-3 ou null (padrão: inicio + 1h)
}

/** Legado: ainda usado por partes da UI não migradas (Página 2 antiga). */
export interface TarefaIA {
  texto: string;
  data: string;
}

const TIPOS_VALIDOS: TipoItem[] = ['tarefa', 'evento', 'estudo'];

function provedores(): Provedor[] {
  return [
    {
      nome: 'Groq',
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-120b',
      reasoningEffort: 'low',
    },
    {
      nome: 'Gemini',
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      model: 'gemini-3.5-flash',
    },
    {
      nome: 'OpenRouter',
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'google/gemma-4-26b-a4b-it:free',
    },
  ];
}

/**
 * Chamada genérica com fallback em cascata.
 * Lança erro SOMENTE se todos os provedores falharem/estiverem sem chave.
 * Retorna o objeto JSON já parseado (o provedor foi instruído a responder JSON).
 */
export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<unknown> {
  let ultimoErro = '';

  for (const p of provedores()) {
    if (!p.apiKey) continue; // provedor sem chave é pulado silenciosamente
    try {
      const client = new OpenAI({
        apiKey: p.apiKey,
        baseURL: p.baseURL,
        timeout: 15_000,
        maxRetries: 0,
      });
      const response = await client.chat.completions.create({
        model: p.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: opts.temperature ?? 0.1,
        max_tokens: opts.maxTokens,
        response_format: { type: 'json_object' },
        ...(p.reasoningEffort ? { reasoning_effort: p.reasoningEffort } : {}),
      });
      const conteudo = response.choices[0]?.message?.content || '';
      return JSON.parse(conteudo);
    } catch (err: any) {
      const msg = err?.message ? String(err.message).slice(0, 120) : 'erro_desconhecido';
      console.warn(`[IA] ${p.nome} falhou: ${msg}`);
      ultimoErro = msg;
    }
  }

  throw new Error(
    ultimoErro
      ? `Todos os provedores de IA falharam. Último erro: ${ultimoErro}`
      : 'Todos os provedores de IA estão sem chave configurada.'
  );
}

// ---------- Normalização de datas ----------

/** Garante que a string ISO termine em -03:00 (Brasília). */
function normalizarDataISO(raw: string): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return null;
  // A IA retorna "YYYY-MM-DDTHH:mm:ss.sss-03:00"; aceitamos qualquer ISO parseável
  // e reemitimos no fuso de Brasília para manter consistência.
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const partes = fmt.formatToParts(parsed);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}.000-03:00`;
}

function normalizarTipo(raw: unknown): TipoItem {
  return typeof raw === 'string' && (TIPOS_VALIDOS as string[]).includes(raw)
    ? (raw as TipoItem)
    : 'tarefa';
}

/** Valida e normaliza itens da agenda e tarefas sem data. */
function normalizarItens(
  raw: unknown,
  options: { permitirSemData?: boolean; tipoSemData?: TipoItem } = {}
): ItemIA[] {
  if (!raw || typeof raw !== 'object') throw new Error('json_invalido');
  const obj = raw as { tasks?: unknown };
  if (!Array.isArray(obj.tasks)) throw new Error('json_sem_tasks');

  const out: ItemIA[] = [];
  for (const item of obj.tasks) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;

    const titulo = typeof t.titulo === 'string'
      ? t.titulo.trim().slice(0, 200)
      : typeof t.texto === 'string' // compatibilidade com prompts antigos
        ? t.texto.trim().slice(0, 200)
        : '';
    const inicioRaw = typeof t.inicio === 'string' ? t.inicio
      : typeof t.data === 'string' ? t.data
      : '';
    const inicio = inicioRaw ? normalizarDataISO(inicioRaw) : null;
    if (!titulo || (inicioRaw && !inicio) || (!inicio && !options.permitirSemData)) continue;

    const fimRaw = typeof t.fim === 'string' ? t.fim : null;
    let fim = inicio && fimRaw ? normalizarDataISO(fimRaw) : null;
    if (inicio && (!fim || new Date(fim) <= new Date(inicio))) {
      // default: +1h
      fim = normalizarDataISO(new Date(new Date(inicio).getTime() + 3600_000).toISOString());
    }

    out.push({
      titulo,
      descricao: typeof t.descricao === 'string' ? t.descricao.trim().slice(0, 1000) : '',
      tipo: options.tipoSemData ?? normalizarTipo(t.tipo),
      inicio,
      fim,
    });
  }
  return out;
}

// ---------- gerarTarefasIA ----------

const SYSTEM_PROMPT_TAREFAS = `
Você é um assistente que transforma roteiros em blocos de agenda e tarefas que o usuário poderá concluir individualmente.
Retorne APENAS um JSON válido, sem markdown, no formato:
{
  "agenda": [
    { "titulo": "Revisar herança", "descricao": "Ler os materiais indicados.",
      "tipo": "estudo", "inicio": "YYYY-MM-DDTHH:mm:ss.sss-03:00",
      "fim": "YYYY-MM-DDTHH:mm:ss.sss-03:00" }
  ],
  "tarefas": [
    { "titulo": "Refazer exercício", "descricao": "Resolver sem consultar.",
      "inicio": null, "fim": null }
  ]
}

Regras:
- "agenda": crie somente os blocos de horário explicitamente planejados no roteiro, sem perder títulos, horários, datas ou descrições. Se o roteiro mencionar somente quarta-feira, não crie itens em outros dias.
- Não invente datas, dias da semana, horários ou blocos para preencher lacunas. Um item só entra em "agenda" se o roteiro informar claramente quando acontece; não use um horário padrão.
- Mantenha exercícios, metas, exemplos e checklists que estejam dentro da descrição de um bloco apenas na descrição desse bloco; não os transforme em itens separados.
- "tarefas": crie itens sem horário somente quando houver uma seção/lista separada e explicitamente identificada como tarefas, checklist ou ações a concluir. Não extraia tarefas de descrições dos blocos de agenda. Se não houver uma seção separada desse tipo, retorne "tarefas": [].
- Não duplique um bloco da agenda como tarefa nem crie itens por inferência.
- Para tarefas de uma seção separada sem prazo/data própria, use "inicio": null e "fim": null. Não invente horário.
- Toda tarefa extraída deve ter título acionável e descrição com o contexto necessário para executá-la; não omita as ações concretas dos checklists.
- Fuso: Brasília (UTC-3). Todas as datas terminam em "-03:00".
- Se o ano não for informado, use ${new Date().getFullYear()}.
- Quando o roteiro informar início, mas não informar fim, some 1 hora ao início.
- "titulo": curto e acionável (máx. 200 caracteres).
- "descricao": detalhes extraídos do roteiro; vazio se não houver.
- "tipo": "estudo" para sessões de estudo/revisão, "evento" para compromissos com hora marcada, "tarefa" para afazeres sem hora fixa.
- Se o roteiro não contiver nada reconhecível, retorne { "agenda": [], "tarefas": [] }.
`.trim();

function roteiroTemSecaoDeTarefas(roteiro: string): boolean {
  return roteiro.split(/\r?\n/).some((linha) =>
    /^\s*(?:#{1,6}\s*)?(?:tarefas(?:\s+para\s+concluir)?|checklist(?:\s+de\s+tarefas)?|ações\s+a\s+concluir)\s*:?\s*$/i.test(linha)
  );
}

export async function gerarTarefasIA(roteiro: string): Promise<ItemIA[]> {
  const json = await callAI(SYSTEM_PROMPT_TAREFAS, `Roteiro:\n${roteiro}`);
  if (!json || typeof json !== 'object') throw new Error('json_invalido');
  const resposta = json as { agenda?: unknown; tarefas?: unknown; tasks?: unknown };
  const agenda = Array.isArray(resposta.agenda)
    ? resposta.agenda
    : Array.isArray(resposta.tasks)
      ? resposta.tasks
      : [];
  const itensAgenda = normalizarItens({ tasks: agenda });
  const tarefas = normalizarItens(
    {
      tasks: roteiroTemSecaoDeTarefas(roteiro) && Array.isArray(resposta.tarefas)
        ? resposta.tarefas
        : [],
    },
    { permitirSemData: true, tipoSemData: 'tarefa' }
  );
  return [...itensAgenda, ...tarefas];
}

/** Formato legado: converte ItensIA para {texto,data} (usado por rotas não migradas). */
export function paraFormatoLegado(itens: ItemIA[]): TarefaIA[] {
  return itens.flatMap((i) => (i.inicio ? [{ texto: i.titulo, data: i.inicio }] : []));
}

// ---------- gerarInsightIA (usado na Fase 4) ----------

export interface EstatisticasInsight {
  streakDias: number;
  tarefasPendentes: number;
  tarefasConcluidas: number;
  dias: Array<{ dia: string; concluidas: number }>;
  porTipo?: { tarefa: number; evento: number; estudo: number };
}

const SYSTEM_PROMPT_INSIGHT = `
Você é um coach de produtividade. Analise as estatísticas de tarefas concluídas fornecidas e
escreva UM parágrafo curto (máx. 320 caracteres) em português do Brasil, motivador e específico.
Retorne APENAS JSON: { "insight": "texto..." }
Não invente números; use somente os dados recebidos. Se os dados estiverem vazios,
encoraje o usuário a concluir uma tarefa.
`.trim();

export async function gerarInsightIA(stats: EstatisticasInsight): Promise<string> {
  const json = (await callAI(
    SYSTEM_PROMPT_INSIGHT,
    `Dados:\n${JSON.stringify(stats)}`,
    { temperature: 0.6, maxTokens: 200 }
  )) as { insight?: unknown };

  const texto = typeof json?.insight === 'string' ? json.insight.trim() : '';
  if (!texto) throw new Error('IA não retornou insight');
  return texto.slice(0, 400);
}


// ---------- Fase 5: sumarização de notas ----------

export interface NotaParaIA {
  titulo: string;
  conteudo: string;
}

export interface ResumoNotas {
  resumo: string;
  tarefas: ItemIA[];
}

const SYSTEM_PROMPT_NOTAS = `
Você é um assistente que organiza anotações soltas em um resumo coerente e sugere ações.
Receba uma lista de notas (título + conteúdo) e retorne APENAS JSON:
{
  "resumo": "Parágrafo curto (máx. 400 caracteres) resumindo os temas das notas.",
  "tarefas": [
    { "titulo": "...", "descricao": "...", "tipo": "tarefa"|"evento"|"estudo",
      "inicio": "YYYY-MM-DDTHH:mm:ss.sss-03:00", "fim": "YYYY-MM-DDTHH:mm:ss.sss-03:00" }
  ]
}

Regras:
- "resumo" em português do Brasil, tom neutro e útil.
- "tarefas": extraia apenas ações concretas das notas. Se não houver nenhuma, retorne [].
- Se uma nota mencionar um prazo explícito, use-o como "inicio". Caso contrário, use
  ${new Date().toISOString().replace('Z', '-03:00')} (agora, em Brasília).
- Fuso: Brasília (UTC-3). Todas as datas terminam em "-03:00".
- "tipo": "estudo" para estudo, "evento" para compromissos com hora, "tarefa" para o resto.
- NÃO invente tarefas que não estejam implícitas nas notas.
`.trim();

export async function sumarizarNotas(notas: NotaParaIA[]): Promise<ResumoNotas> {
  const entrada = notas
    .map((n, i) => `#${i + 1} ${n.titulo}\n${n.conteudo}`)
    .join('\n\n---\n\n');

  const json = await callAI(SYSTEM_PROMPT_NOTAS, `Notas:\n\n${entrada}`, {
    temperature: 0.3,
    maxTokens: 900,
  });

  const obj = json as { resumo?: unknown; tarefas?: unknown };
  const resumo = typeof obj?.resumo === 'string' ? obj.resumo.trim().slice(0, 800) : '';
  // Reaproveita o normalizador de itens (Fase 1). Ele ignora entradas inválidas.
  let tarefas: ItemIA[] = [];
  try {
    tarefas = normalizarItens({ tasks: Array.isArray(obj?.tarefas) ? obj.tarefas : [] });
  } catch {
    tarefas = [];
  }
  return { resumo, tarefas };
}
