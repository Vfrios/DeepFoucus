import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import { callAI, gerarDietaSaude, gerarTarefasIA, gerarTreinoSaude, importarDadosSaude } from '../backend/src/lib/ai';

const originalFetch = globalThis.fetch;
const originalKeys = {
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
};

after(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalKeys)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

it('falls back from Groq to the current Gemini model and parses the JSON result', async () => {
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  delete process.env.OPENROUTER_API_KEY;

  const requests: Array<{ url: string; model: string; reasoningEffort?: string }> = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string; reasoning_effort?: string };
    requests.push({
      url: String(input),
      model: body.model,
      reasoningEffort: body.reasoning_effort,
    });

    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'model unavailable' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        id: 'test-response',
        object: 'chat.completion',
        created: 0,
        model: body.model,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '{"insight":"Bom trabalho!"}' },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const result = await callAI('system', 'user');

  assert.deepEqual(result, { insight: 'Bom trabalho!' });
  assert.deepEqual(
    requests.map((request) => request.model),
    ['openai/gpt-oss-120b', 'gemini-3.5-flash']
  );
  assert.equal(requests[0].reasoningEffort, 'low');
  assert.match(requests[0].url, /api\.groq\.com/);
  assert.match(requests[1].url, /generativelanguage\.googleapis\.com/);
});

it('returns scheduled agenda blocks plus separately completable undated tasks', async () => {
  process.env.GROQ_API_KEY = 'test-groq-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const respostaIA = {
    agenda: [
      {
        titulo: 'PM2 D1: Herança',
        descricao: 'Ler PM_7, PM_8 e PM_9; praticar o uso de super.',
        tipo: 'estudo',
        inicio: '2026-10-21T08:00:00.000-03:00',
        fim: '2026-10-21T10:00:00.000-03:00',
      },
    ],
    tarefas: [
      {
        titulo: 'Escrever de memória Aluno.relatorio()',
        descricao: 'Implementar o método chamando super.relatorio().',
        inicio: null,
        fim: null,
      },
    ],
  };
  let systemPrompt = '';
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    systemPrompt = body.messages.find((message) => message.role === 'system')?.content ?? '';
    return new Response(
      JSON.stringify({
        id: 'test-response',
        object: 'chat.completion',
        created: 0,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: JSON.stringify(respostaIA) },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const result = await gerarTarefasIA(
    'Agenda de quarta-feira com blocos horários.\n\nTarefas para concluir:\n- escrever o método de memória.'
  );

  assert.match(systemPrompt, /não os transforme em itens separados/i);
  assert.match(systemPrompt, /seção\/lista separada e explicitamente identificada/i);
  assert.match(systemPrompt, /não crie itens em outros dias/i);
  assert.equal(result.length, 2);
  assert.equal(result[0].titulo, 'PM2 D1: Herança');
  assert.equal(result[0].inicio, '2026-10-21T08:00:00.000-03:00');
  assert.equal(result[0].fim, '2026-10-21T10:00:00.000-03:00');
  assert.equal(result[1].titulo, 'Escrever de memória Aluno.relatorio()');
  assert.equal(result[1].tipo, 'tarefa');
  assert.equal(result[1].inicio, null);
  assert.equal(result[1].fim, null);
});

it('does not turn scheduled item descriptions into separate tasks', async () => {
  process.env.GROQ_API_KEY = 'test-groq-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    return new Response(
      JSON.stringify({
        id: 'test-response',
        object: 'chat.completion',
        created: 0,
        model: body.model,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({
                agenda: [
                  {
                    titulo: 'Estudar herança',
                    descricao: 'Exercício: escrever o método usando super.',
                    tipo: 'estudo',
                    inicio: '2026-10-21T08:00:00.000-03:00',
                    fim: '2026-10-21T10:00:00.000-03:00',
                  },
                ],
                tarefas: [
                  {
                    titulo: 'Escrever método usando super',
                    descricao: 'Fazer de memória.',
                    inicio: null,
                    fim: null,
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const result = await gerarTarefasIA(
    '## Quarta-feira\n08:00–10:00 Estudar herança. Exercício: escrever o método usando super.'
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].titulo, 'Estudar herança');
  assert.equal(result[0].descricao, 'Exercício: escrever o método usando super.');
});

it('sends selected food preferences and restrictions to the diet model', async () => {
  process.env.GROQ_API_KEY = 'test-groq-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  let prompt = '';
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    prompt = body.messages.find((message) => message.role === 'user')?.content || '';
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"refeicoes":[]}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await gerarDietaSaude({
    peso: 70,
    altura: 170,
    objetivo: 'manutenção do peso',
    preferencias: ['Frango', 'Arroz'],
    restricoes: ['Jiló'],
  });

  assert.match(prompt, /"preferencias":\["Frango","Arroz"\]/);
  assert.match(prompt, /"restricoes":\["Jiló"\]/);
  assert.match(prompt, /170 cm/);
});

it('extracts and sanitizes health data from imported workout and diet text', async () => {
  process.env.GROQ_API_KEY = 'test-groq-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const sourceText = 'Treino ABC. Gosto de frango e arroz; evito peixe e tenho restrição a lactose.';
  let prompt = '';
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    prompt = body.messages.find((message) => message.role === 'user')?.content || '';
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            alimentosPreferidos: ['Frango', 'Arroz', 'Frango'],
            alimentosQueNaoGosta: ['Peixe'],
            treinoBase: 'ABC',
            restricoes: ['Lactose'],
            extra: 'ignorado',
          }),
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await importarDadosSaude(sourceText);

  assert.match(prompt, /"textoAntigo":"Treino ABC/);
  assert.deepEqual(result, {
    alimentosPreferidos: ['Frango', 'Arroz'],
    alimentosQueNaoGosta: ['Peixe'],
    treinoBase: 'ABC',
    restricoes: ['Lactose'],
  });
});

it('sends the selected workout split, level and available hours to the training model', async () => {
  process.env.GROQ_API_KEY = 'test-groq-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  let systemPrompt = '';
  let userPrompt = '';
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    systemPrompt = body.messages.find((message) => message.role === 'system')?.content || '';
    userPrompt = body.messages.find((message) => message.role === 'user')?.content || '';
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"treinos":[]}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await gerarTreinoSaude({
    peso: 70,
    altura: 170,
    idade: 30,
    sexo: 'Outro',
    nivel: 'intermediário',
    diasDisponiveis: ['segunda-feira', 'quarta-feira', 'sexta-feira'],
    disponibilidadePorDia: {
      'segunda-feira': ['18:00'],
      'quarta-feira': ['19:00'],
      'sexta-feira': ['18:00'],
    },
    duracaoTreino: 75,
    treinoBase: 'abc-3-dias',
  });

  assert.match(systemPrompt, /dias da semana distintos/i);
  assert.match(systemPrompt, /horário disponível para aquele dia/i);
  assert.match(systemPrompt, /duração pedida/i);
  assert.match(userPrompt, /ABC de três sessões/);
  assert.match(userPrompt, /"nivel":"intermediário"/);
  assert.match(userPrompt, /"diasDisponiveis":\["segunda-feira","quarta-feira","sexta-feira"\]/);
  assert.match(userPrompt, /"disponibilidadePorDia":\{"segunda-feira":\["18:00"\],"quarta-feira":\["19:00"\],"sexta-feira":\["18:00"\]\}/);
  assert.match(userPrompt, /"duracaoMinutos":75/);
});

it('uses the previous workout as the primary split and preserves its muscle groups', async () => {
  process.env.GROQ_API_KEY = 'test-groq-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  let systemPrompt = '';
  let userPrompt = '';
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    systemPrompt = body.messages.find((message) => message.role === 'system')?.content || '';
    userPrompt = body.messages.find((message) => message.role === 'user')?.content || '';
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"treinos":[]}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await gerarTreinoSaude({
    peso: 70,
    altura: 170,
    idade: 30,
    sexo: 'Outro',
    nivel: 'intermediário',
    diasDisponiveis: ['segunda-feira', 'terça-feira', 'quinta-feira', 'sexta-feira'],
    disponibilidadePorDia: {
      'segunda-feira': ['18:00'],
      'terça-feira': ['18:00'],
      'quinta-feira': ['19:00'],
      'sexta-feira': ['19:00'],
    },
    duracaoTreino: 60,
    treinoBase: 'abcd-4-dias',
    treinoAntigo: [
      { diaSemana: 'segunda-feira', nomeTreino: 'Peito + Costas + Abdômen', exercicios: ['Supino', 'Remada'] },
      { diaSemana: 'terça-feira', nomeTreino: 'Ombro + Braços', exercicios: ['Desenvolvimento', 'Rosca'] },
    ],
  });

  assert.match(systemPrompt, /Preserve EXATAMENTE o agrupamento/i);
  assert.match(systemPrompt, /não mova músculos entre sessões/i);
  assert.match(userPrompt, /"treinoAntigo":\[\{"diaSemana":"segunda-feira","nomeTreino":"Peito \+ Costas \+ Abdômen"/);
  assert.match(userPrompt, /"regraHistorico":"Manter exatamente os grupos musculares/);
});
