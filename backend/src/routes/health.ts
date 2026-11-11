import { Router } from 'express';
import { getDb } from '../lib/mongo';
import { gerarDietaSaude, gerarTreinoSaude, importarDadosSaude } from '../lib/ai';
import { createCalendarEvent, isConnected } from '../lib/google';

const r = Router();
const TIME_ZONE = 'America/Sao_Paulo';
const DAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const DAY_INDEX = new Map(DAYS.map((day, index) => [day, index]));
const WORKOUT_SPLIT_DAYS: Record<string, number> = {
  'abc-3-dias': 3,
  'abcd-4-dias': 4,
  'full-body-2-dias': 2,
};

type Profile = {
  peso: number;
  altura: number;
  sexo: string;
  idade: number;
  metaPeso: number;
  disponibilidadeDias: string[];
  disponibilidadeTreino: string[];
  disponibilidadePorDia: Record<string, string[]>;
  duracaoTreino: number;
  alimentosPreferidos: string[];
  preferenciasComida: string[];
  alimentosQueNaoGosta: string[];
  restricoes: string[];
  objetivo: 'emagrecer' | 'ganhar_massa' | 'manter';
  treinoBase: string;
  nivelTreino: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dateKey(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE }).format(date);
}

function saoPauloDayStart(key = dateKey(new Date())): Date {
  return new Date(`${key}T00:00:00.000-03:00`);
}

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00.000-03:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function dayName(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, weekday: 'long' })
    .format(date).toLocaleLowerCase('pt-BR');
}

function normalizeDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const aliases: Record<string, string> = {
    domingo: DAYS[0],
    segunda: DAYS[1],
    'segunda-feira': DAYS[1],
    terca: DAYS[2],
    'terca-feira': DAYS[2],
    quarta: DAYS[3],
    'quarta-feira': DAYS[3],
    quinta: DAYS[4],
    'quinta-feira': DAYS[4],
    sexta: DAYS[5],
    'sexta-feira': DAYS[5],
    sabado: DAYS[6],
  };
  return aliases[normalized] || null;
}

function stringList(value: unknown, limit: number, itemLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.length > itemLength) return null;
    result.push(item.trim());
  }
  return [...new Set(result)];
}

function validClock(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateProfile(value: unknown): { profile?: Profile; error?: string } {
  const body = record(value);
  const numeric = ['peso', 'altura', 'idade', 'metaPeso'] as const;
  if (numeric.some((key) => typeof body[key] !== 'number' || !Number.isFinite(body[key]))) {
    return { error: 'peso, altura, idade e metaPeso devem ser números válidos' };
  }
  const peso = body.peso as number;
  const altura = body.altura as number;
  const idade = body.idade as number;
  const metaPeso = body.metaPeso as number;
  const duracaoTreino = body.duracaoTreino;
  if (peso < 20 || peso > 400 || altura < 80 || altura > 250 || idade < 13 || idade > 120 || metaPeso < 20 || metaPeso > 400) {
    return { error: 'valores do perfil fora do intervalo permitido' };
  }
  if (typeof duracaoTreino !== 'number' || !Number.isInteger(duracaoTreino) || duracaoTreino < 15 || duracaoTreino > 240) {
    return { error: 'duracaoTreino deve ser um número entre 15 e 240 minutos' };
  }
  if (typeof body.sexo !== 'string' || !['Feminino', 'Masculino', 'Outro', 'Prefiro não informar'].includes(body.sexo)) {
    return { error: 'sexo inválido' };
  }
  const legacyDays = stringList(body.disponibilidadeDias ?? [], 7, 20);
  const legacyTimes = stringList(body.disponibilidadeTreino ?? [], 24, 5);
  const availabilityInput = body.disponibilidadePorDia;
  const disponibilidadePorDia: Record<string, string[]> = {};
  if (availabilityInput !== undefined && (!availabilityInput || typeof availabilityInput !== 'object' || Array.isArray(availabilityInput))) {
    return { error: 'disponibilidadePorDia inválida' };
  }
  if (availabilityInput !== undefined) {
    for (const [day, value] of Object.entries(record(availabilityInput))) {
      const times = stringList(value, 24, 5);
      if (!DAYS.includes(day) || !times || times.some((time) => !validClock(time))) {
        return { error: 'disponibilidade por dia inválida' };
      }
      if (times.length) disponibilidadePorDia[day] = times.sort();
    }
  } else if (legacyDays && legacyTimes) {
    for (const day of legacyDays) disponibilidadePorDia[day] = legacyTimes;
  }
  const disponibilidadeDias = DAYS.filter((day) => (disponibilidadePorDia[day] || []).length > 0);
  const disponibilidadeTreino = [...new Set(Object.values(disponibilidadePorDia).flat())].sort();
  const alimentosPreferidos = stringList(body.alimentosPreferidos ?? body.preferenciasComida ?? [], 40, 80);
  const alimentosQueNaoGosta = stringList(body.alimentosQueNaoGosta ?? [], 40, 80);
  const restricoes = stringList(body.restricoes ?? [], 40, 80);
  const objetivo = body.objetivo ?? 'manter';
  if (
    !legacyDays ||
    !legacyTimes ||
    !alimentosPreferidos ||
    !alimentosQueNaoGosta ||
    !restricoes ||
    !['emagrecer', 'ganhar_massa', 'manter'].includes(String(objetivo))
  ) {
    return { error: 'disponibilidade ou preferências alimentares inválidas' };
  }
  const treinoBase = typeof body.treinoBase === 'string' ? body.treinoBase.trim() : '';
  if (treinoBase.length > 80) return { error: 'treinoBase excede o limite permitido' };
  const nivelTreino = typeof body.nivelTreino === 'string' ? body.nivelTreino : 'iniciante';
  if (!['iniciante', 'intermediário', 'avançado'].includes(nivelTreino)) {
    return { error: 'nível de treino inválido' };
  }

  return {
    profile: {
      peso,
      altura,
      sexo: body.sexo,
      idade,
      metaPeso,
      disponibilidadeDias,
      disponibilidadeTreino,
      disponibilidadePorDia,
      duracaoTreino,
      alimentosPreferidos,
      preferenciasComida: alimentosPreferidos,
      alimentosQueNaoGosta,
      restricoes,
      objetivo: objetivo as Profile['objetivo'],
      treinoBase,
      nivelTreino,
    },
  };
}

function normalizeDiet(value: unknown) {
  const meals = record(value).refeicoes;
  if (!Array.isArray(meals) || meals.length !== 5) throw new Error('json_invalido');
  const normalized = meals.map((value) => {
    const meal = record(value);
    const nome = typeof meal.nome === 'string' ? meal.nome.trim().slice(0, 80) : '';
    const alimentos = Array.isArray(meal.alimentos)
      ? meal.alimentos.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 20)
      : typeof meal.alimentos === 'string' ? [meal.alimentos.trim()] : [];
    const calories = Number(meal.calorias);
    const macros = record(meal.macros);
    const proteina = Number(macros.proteina ?? meal.proteina);
    const carboidratos = Number(macros.carboidratos ?? meal.carboidratos ?? meal.carboidrato);
    const gordura = Number(macros.gordura ?? meal.gordura);
    if (
      !nome ||
      !alimentos.length ||
      ![calories, proteina, carboidratos, gordura].every((number) => Number.isFinite(number) && number >= 0)
    ) {
      throw new Error('json_invalido');
    }
    return { nome, alimentos, calorias: calories, macros: { proteina, carboidratos, gordura } };
  });
  return normalized;
}

function normalizeWorkout(value: unknown) {
  const workouts = record(value).treinos;
  if (!Array.isArray(workouts) || workouts.length < 1 || workouts.length > 7) throw new Error('json_invalido');
  const normalized = workouts.map((value) => {
    const workout = record(value);
    const diaSemana = normalizeDay(workout.diaSemana);
    const nomeTreino = typeof workout.nomeTreino === 'string' ? workout.nomeTreino.trim().slice(0, 100) : '';
    if (!diaSemana || !nomeTreino || !Array.isArray(workout.exercicios) || !workout.exercicios.length || workout.exercicios.length > 30) {
      throw new Error('json_invalido');
    }
    const exercicios = workout.exercicios.map((value) => {
      const exercise = record(value);
      const nome = typeof exercise.nome === 'string' ? exercise.nome.trim().slice(0, 100) : '';
      const series = Number(exercise.series);
      const repeticoes = typeof exercise.repeticoes === 'string' || typeof exercise.repeticoes === 'number'
        ? String(exercise.repeticoes).trim().slice(0, 30)
        : '';
      const descanso = typeof exercise.descanso === 'string' || typeof exercise.descanso === 'number'
        ? String(exercise.descanso).trim().slice(0, 30)
        : '';
      if (!nome || !Number.isInteger(series) || series < 1 || series > 20 || !repeticoes || !descanso) {
        throw new Error('json_invalido');
      }
      return { nome, series, repeticoes, descanso };
    });
    return { diaSemana, nomeTreino, exercicios };
  });
  if (new Set(normalized.map((workout) => workout.diaSemana)).size !== normalized.length) {
    throw new Error('json_invalido');
  }
  return normalized;
}

function eventDate(day: string, time: string): string {
  const today = dateKey(new Date());
  const currentDay = DAY_INDEX.get(dayName(new Date())) ?? 0;
  const targetDay = DAY_INDEX.get(day) ?? 0;
  let offset = (targetDay - currentDay + 7) % 7;
  const localTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  if (offset === 0 && time <= localTime) offset = 7;
  return `${addDays(today, offset)}T${time}:00-03:00`;
}

async function sumWater(email: string, start: Date, end: Date): Promise<number> {
  const db = await getDb();
  const result = await db.collection('water_logs').aggregate<{ total: number }>([
    { $match: { email, data: { $gte: start, $lt: end } } },
    { $group: { _id: null, total: { $sum: '$ml' } } },
  ]).toArray();
  return Math.max(0, result[0]?.total || 0);
}

function dailyWaterGoal(profile: { peso?: number } | null): number {
  return typeof profile?.peso === 'number' ? Math.round(profile.peso * 35) : 0;
}

const LEGACY_HEALTH_TEXT = 'SEGUNDA – Peito + Costas + Abdômen (Pesado) Supino inclinado, Supino máquina, Pulley costas, Remada baixa, Elevação de pernas, Prancha. TERÇA – Ombro + Braços Desenvolvimento, Elevação lateral, Rosca Scott, Rosca martelo polia, Tríceps corda, Tríceps francês, Rosca inversa. QUARTA – Pernas Completas Leg press, Cadeira extensora, Mesa flexora, Stiff, Panturrilha em pé, Panturrilha sentado, Abdominal máquina. QUINTA – Peito + Costas + Trapézio Crucifixo polia, Voador, Supino inclinado, Pull down, Remada baixa, Voador invertido, Encolhimento. SEXTA – Ombro + Braços (Volume) Desenvolvimento, Elevação lateral, Voador invertido, Rosca direta polia, Rosca martelo polia, Tríceps barra W, Tríceps corda, Flexão de punho. SÁBADO – Manutenção e Recuperação Mobilidade, Alongamentos, Caminhada, Prancha. DIETA: 07:00 Café da manhã (pão francês, ovo, queijo, presunto, laranja). 09:30 Lanche (leite integral, whey, hipercalórico, pasta de amendoim). 12:00 Almoço (arroz, feijão, carne/frango). 15:00 Lanche (pão, ovos mexidos, laranja). 16:15 Pré-treino (pré-treino, bananas, pão com geleia). 18:30 Pós-treino (pães, frango/carne, laranja). 20:40 Lanche Faculdade (banana + amendoim). 22:50 Jantar (arroz, feijão, carne/frango). 23:10 Ceia (iogurte ou laranja ou banana ou leite).';
const DEFAULT_TRAINING_DAYS = DAYS.slice(1, 7);

async function ensureHealthProfile(email: string): Promise<Profile & Record<string, unknown>> {
  const collection = (await getDb()).collection<Profile & Record<string, unknown>>('profile');
  const existing = await collection.findOne({ email });
  if (existing) {
    const defaults: Record<string, unknown> = {};
    const savedAvailability = record(existing.disponibilidadePorDia);
    const oldDays = Array.isArray(existing.disponibilidadeDias)
      ? existing.disponibilidadeDias.filter((day): day is string => typeof day === 'string' && DAYS.includes(day))
      : Object.keys(savedAvailability).filter((day) => DAYS.includes(day) && Array.isArray(savedAvailability[day]) && (savedAvailability[day] as unknown[]).length > 0);
    const availableDays = oldDays.length ? oldDays : DEFAULT_TRAINING_DAYS;
    const oldTimes = Array.isArray(existing.disponibilidadeTreino)
      ? existing.disponibilidadeTreino.filter((time): time is string => typeof time === 'string' && validClock(time))
      : ['18:00'];
    if (!existing.disponibilidadePorDia || typeof existing.disponibilidadePorDia !== 'object') {
      defaults.disponibilidadePorDia = Object.fromEntries(availableDays.map((day) => [day, oldTimes]));
    }
    if (!Array.isArray(existing.disponibilidadeDias)) defaults.disponibilidadeDias = availableDays;
    if (!Array.isArray(existing.disponibilidadeTreino)) defaults.disponibilidadeTreino = oldTimes;
    if (typeof existing.duracaoTreino !== 'number') defaults.duracaoTreino = 60;
    if (!Array.isArray(existing.alimentosPreferidos)) defaults.alimentosPreferidos = existing.preferenciasComida || [];
    if (!Array.isArray(existing.alimentosQueNaoGosta)) defaults.alimentosQueNaoGosta = [];
    if (!Array.isArray(existing.restricoes)) defaults.restricoes = [];
    if (Object.keys(defaults).length) {
      await collection.updateOne({ email }, { $set: defaults });
      return { ...existing, ...defaults };
    }
    return existing;
  }

  const imported = await importarDadosSaude(LEGACY_HEALTH_TEXT);
  const now = new Date();
  const initialProfile: Profile & Record<string, unknown> = {
    peso: 70,
    altura: 170,
    sexo: 'Prefiro não informar',
    idade: 30,
    metaPeso: 70,
    disponibilidadeDias: DEFAULT_TRAINING_DAYS,
    disponibilidadeTreino: ['18:00'],
    disponibilidadePorDia: Object.fromEntries(DEFAULT_TRAINING_DAYS.map((day) => [day, ['18:00']])),
    duracaoTreino: 60,
    alimentosPreferidos: imported.alimentosPreferidos,
    preferenciasComida: imported.alimentosPreferidos,
    alimentosQueNaoGosta: imported.alimentosQueNaoGosta,
    restricoes: imported.restricoes,
    objetivo: 'manter',
    treinoBase: imported.treinoBase || 'abc-3-dias',
    nivelTreino: 'iniciante',
    email,
    criadoEm: now,
    atualizadoEm: now,
  };
  await collection.updateOne({ email }, { $setOnInsert: initialProfile }, { upsert: true });
  const created = await collection.findOne({ email });
  if (!created) throw new Error('health_profile_creation_failed');
  return created;
}

r.get('/overview', async (req, res, next) => {
  try {
    const email = req.user!.email;
    const db = await getDb();
    const profile = await ensureHealthProfile(email);
    const [workouts, diets, workoutLogs] = await Promise.all([
      db.collection('workouts').find({ email }).sort({ diaSemana: 1 }).toArray(),
      db.collection('diets').find({ email }).sort({ geradoEm: -1 }).limit(1).toArray(),
      db.collection('workout_logs').find({
        email,
        data: { $gte: saoPauloDayStart(addDays(dateKey(new Date()), -29)) },
      }).sort({ data: 1 }).toArray(),
    ]);
    const today = dateKey(new Date());
    const todayStart = saoPauloDayStart(today);
    const todayEnd = saoPauloDayStart(addDays(today, 1));
    const waterToday = await sumWater(email, todayStart, todayEnd);

    const waterLogs = await db.collection('water_logs').find({
      email,
      data: { $gte: saoPauloDayStart(addDays(today, -6)), $lt: todayEnd },
    }).toArray();
    const waterByDay = new Map<string, number>();
    for (let offset = -6; offset <= 0; offset++) waterByDay.set(addDays(today, offset), 0);
    for (const log of waterLogs) {
      const key = dateKey(new Date(log.data));
      waterByDay.set(key, (waterByDay.get(key) || 0) + Number(log.ml || 0));
    }

    const workoutByDay = new Map<string, { total: number; count: number }>();
    for (const log of workoutLogs) {
      const key = dateKey(new Date(log.data));
      const current = workoutByDay.get(key) || { total: 0, count: 0 };
      current.total += Number(log.carga || 0);
      current.count += 1;
      workoutByDay.set(key, current);
    }

    const profileRecord = profile as Record<string, unknown> & {
      pesoHistorico?: Array<{ data: Date; peso: number }>;
    };
    const weightHistory = Array.isArray(profileRecord.pesoHistorico)
      ? profileRecord.pesoHistorico.map((entry: { data: Date; peso: number }) => ({
        data: new Date(entry.data).toISOString(),
        valor: entry.peso,
      }))
      : [];
    const todayWorkout = workouts.find((workout) => workout.diaSemana === dayName(new Date())) || null;
    res.json({
      profile: profileRecord,
      workouts,
      todayWorkout,
      diet: diets[0] || null,
      waterToday,
      waterGoalMl: dailyWaterGoal(profile),
      waterHistory: [...waterByDay.entries()].map(([data, valor]) => ({ data, valor: Math.max(0, valor) })),
      weightHistory,
      workoutHistory: [...workoutByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([data, values]) => ({
        data,
        valor: values.count ? values.total / values.count : 0,
      })),
    });
  } catch (error) {
    next(error);
  }
});

r.post('/import-data', async (req, res) => {
  const textoAntigo = req.body?.textoAntigo;
  if (typeof textoAntigo !== 'string' || !textoAntigo.trim() || textoAntigo.length > 12000) {
    res.status(400).json({ error: 'textoAntigo deve conter entre 1 e 12000 caracteres' });
    return;
  }
  try {
    res.json(await importarDadosSaude(textoAntigo.trim()));
  } catch (error) {
    console.error('[health] profile import failed:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'health_import_failed' });
  }
});

r.put('/profile', async (req, res) => {
  const email = req.user!.email;
  const db = await getDb();
  const collection = db.collection('profile');
  const existing = await collection.findOne({ email });
  const body = record(req.body);
  const validated = validateProfile({
    ...body,
    disponibilidadeDias: body.disponibilidadeDias ?? existing?.disponibilidadeDias ?? DEFAULT_TRAINING_DAYS,
    disponibilidadeTreino: body.disponibilidadeTreino ?? existing?.disponibilidadeTreino ?? ['18:00'],
    disponibilidadePorDia: body.disponibilidadePorDia ?? existing?.disponibilidadePorDia,
    duracaoTreino: body.duracaoTreino ?? existing?.duracaoTreino ?? 60,
  });
  if (!validated.profile) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const now = new Date();
  const update: Record<string, unknown> = {
    $set: { ...validated.profile, email, atualizadoEm: now },
    $setOnInsert: { criadoEm: now },
  };
  if (!existing || existing.peso !== validated.profile.peso) {
    update.$push = { pesoHistorico: { data: now, peso: validated.profile.peso } };
  }
  await collection.updateOne({ email }, update, { upsert: true });
  res.json({ ok: true, profile: { ...validated.profile, email } });
});

r.post('/generate-diet', async (req, res) => {
  const email = req.user!.email;
  const db = await getDb();
  const profile = await db.collection('profile').findOne({ email }) as (Profile & { email: string }) | null;
  if (!profile) {
    res.status(409).json({ error: 'profile_required' });
    return;
  }

  const preferencias = req.body?.preferencias === undefined
    ? profile.alimentosPreferidos || profile.preferenciasComida || []
    : stringList(req.body.preferencias, 40, 80);
  const alimentosQueNaoGosta = profile.alimentosQueNaoGosta || [];
  const restricoesSolicitadas = req.body?.restricoes === undefined
    ? []
    : stringList(req.body.restricoes, 40, 80);
  if (!preferencias || !restricoesSolicitadas) {
    res.status(400).json({ error: 'preferencias ou restricoes inválidas' });
    return;
  }
  const restricoesDieta = [...new Set([...alimentosQueNaoGosta, ...(profile.restricoes || []), ...restricoesSolicitadas])];
  const goal = profile.objetivo === 'emagrecer'
    ? 'emagrecimento'
    : profile.objetivo === 'ganhar_massa'
      ? 'ganho de massa muscular'
      : 'manutenção do peso';

  try {
    const generated = await gerarDietaSaude({
      peso: profile.peso,
      altura: profile.altura,
      objetivo: goal,
      preferencias,
      restricoes: restricoesDieta,
    });
    const refeicoes = normalizeDiet(generated);
    const diet = { email, refeicoes, objetivo: goal, geradoEm: new Date() };
    await db.collection('diets').insertOne(diet);
    res.status(201).json(diet);
  } catch (error) {
    console.error('[health] diet generation failed:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'diet_generation_failed' });
  }
});

r.post('/generate-workout', async (req, res) => {
  const email = req.user!.email;
  const db = await getDb();
  const savedProfile = await db.collection('profile').findOne({ email }) as (Partial<Profile> & { email: string }) | null;
  if (!savedProfile) {
    res.status(409).json({ error: 'profile_required' });
    return;
  }
  const profile: Profile & { email: string } = {
    ...savedProfile,
    disponibilidadeDias: savedProfile.disponibilidadeDias || [],
    disponibilidadeTreino: savedProfile.disponibilidadeTreino || [],
    disponibilidadePorDia: savedProfile.disponibilidadePorDia || Object.fromEntries(
      (savedProfile.disponibilidadeDias || []).map((day) => [day, savedProfile.disponibilidadeTreino || []])
    ),
    duracaoTreino: savedProfile.duracaoTreino || 60,
  } as Profile & { email: string };
  if (!profile.disponibilidadeTreino?.length || !profile.disponibilidadeDias?.length) {
    res.status(400).json({ error: 'availability_required' });
    return;
  }
  const treinoBase = typeof req.body?.treinoBase === 'string'
    ? req.body.treinoBase.trim().slice(0, 80)
    : profile.treinoBase || '';
  if (WORKOUT_SPLIT_DAYS[treinoBase] > profile.disponibilidadeDias.length) {
    res.status(400).json({ error: 'availability_insufficient' });
    return;
  }
  let workouts: ReturnType<typeof normalizeWorkout>;
  try {
    const generated = await gerarTreinoSaude({
      peso: profile.peso,
      altura: profile.altura,
      idade: profile.idade,
      sexo: profile.sexo,
      nivel: profile.nivelTreino || 'iniciante',
      diasDisponiveis: profile.disponibilidadeDias,
      disponibilidadePorDia: profile.disponibilidadePorDia,
      duracaoTreino: profile.duracaoTreino,
      treinoBase: treinoBase || 'abc-3-dias',
    });
    workouts = normalizeWorkout(generated);
    const expectedDays = WORKOUT_SPLIT_DAYS[treinoBase];
    if (expectedDays && workouts.length !== expectedDays) throw new Error('json_invalido');
    if (workouts.some((workout) =>
      !profile.disponibilidadeDias.includes(workout.diaSemana) ||
      !profile.disponibilidadePorDia[workout.diaSemana]?.length
    )) {
      throw new Error('json_invalido');
    }
  } catch (error) {
    console.error('[health] workout generation failed:', error instanceof Error ? error.message : String(error));
    res.status(502).json({ error: 'workout_generation_failed' });
    return;
  }

  const now = new Date();
  await db.collection('workouts').deleteMany({ email });
  const docs = workouts.map((workout) => ({ ...workout, email, treinoBase, duracaoTreino: profile.duracaoTreino, geradoEm: now }));
  const inserted = await db.collection('workouts').insertMany(docs);

  let calendarConnected = false;
  let calendarCreated = 0;
  let calendarFailed = 0;
  try {
    calendarConnected = await isConnected();
    if (calendarConnected) {
      for (let index = 0; index < workouts.length; index++) {
        const workout = workouts[index];
        const time = profile.disponibilidadePorDia[workout.diaSemana][0];
        const inicio = eventDate(workout.diaSemana, time);
        const fim = new Date(new Date(inicio).getTime() + profile.duracaoTreino * 60 * 1000).toISOString();
        const eventId = await createCalendarEvent({
          titulo: `Treino de ${workout.nomeTreino}`,
          descricao: workout.exercicios.map((exercise) =>
            `${exercise.nome}: ${exercise.series} séries, ${exercise.repeticoes} repetições, descanso ${exercise.descanso}`
          ).join('\n'),
          inicio,
          fim,
          calendarId: 'primary',
        });
        if (eventId) {
          calendarCreated++;
          await db.collection('workouts').updateOne(
            { _id: inserted.insertedIds[index] },
            { $set: { calendarEventId: eventId, agendadoPara: new Date(inicio) } }
          );
        } else {
          calendarFailed++;
        }
      }
    }
  } catch (error) {
    console.error('[health] calendar integration failed:', error instanceof Error ? error.message : String(error));
    calendarFailed += workouts.length - calendarCreated;
  }

  res.status(201).json({
    workouts,
    calendar: { connected: calendarConnected, created: calendarCreated, failed: calendarFailed },
  });
});

r.post('/water', async (req, res) => {
  const ml = req.body?.ml;
  if (ml !== 200 && ml !== -200 && ml !== 250 && ml !== 500) {
    res.status(400).json({ error: 'ml deve ser 200, -200, 250 ou 500' });
    return;
  }
  const email = req.user!.email;
  const now = new Date();
  const start = saoPauloDayStart();
  const end = saoPauloDayStart(addDays(dateKey(now), 1));
  const total = await sumWater(email, start, end);
  if (ml < 0 && total < Math.abs(ml)) {
    res.status(409).json({ error: 'water_intake_already_zero', waterToday: total });
    return;
  }
  const db = await getDb();
  if (ml < 0) {
    const latestIntake = await db.collection('water_logs')
      .find({ email, data: { $gte: start, $lt: end }, ml: 200 })
      .sort({ data: -1 })
      .limit(1)
      .toArray();
    if (!latestIntake[0]) {
      res.status(409).json({ error: 'water_intake_cannot_be_reversed', waterToday: total });
      return;
    }
    await db.collection('water_logs').deleteOne({ _id: latestIntake[0]._id });
  } else {
    await db.collection('water_logs').insertOne({ email, data: now, ml });
  }
  res.status(201).json({ waterToday: Math.max(0, total + ml) });
});

r.get('/water', async (req, res) => {
  const email = req.user!.email;
  const db = await getDb();
  const profile = await db.collection('profile').findOne({ email }) as { peso?: number } | null;
  const today = dateKey(new Date());
  const total = await sumWater(email, saoPauloDayStart(today), saoPauloDayStart(addDays(today, 1)));
  res.json({ waterToday: total, waterGoalMl: dailyWaterGoal(profile) });
});

r.post('/workout-logs', async (req, res) => {
  const logs = req.body?.logs;
  if (!Array.isArray(logs) || logs.length < 1 || logs.length > 30) {
    res.status(400).json({ error: 'logs inválidos' });
    return;
  }
  const normalized = [];
  for (const value of logs) {
    const log = record(value);
    const exercicio = typeof log.exercicio === 'string' ? log.exercicio.trim().slice(0, 100) : '';
    const carga = Number(log.carga);
    const series = Number(log.series);
    const repeticoes = Number(log.repeticoes);
    if (
      !exercicio ||
      !Number.isFinite(carga) || carga < 0 || carga > 1000 ||
      !Number.isInteger(series) || series < 1 || series > 30 ||
      !Number.isInteger(repeticoes) || repeticoes < 1 || repeticoes > 100
    ) {
      res.status(400).json({ error: 'registro de treino inválido' });
      return;
    }
    normalized.push({ email: req.user!.email, data: new Date(), exercicio, carga, series, repeticoes });
  }
  const db = await getDb();
  await db.collection('workout_logs').insertMany(normalized);
  res.status(201).json({ saved: normalized.length });
});

export default r;
