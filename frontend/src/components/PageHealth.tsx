import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { WATER_INTAKE_EVENT } from '../lib/water';
import PushButton from './PushButton';

type HealthProfile = {
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
  alimentosQueNaoGosta: string[];
  restricoes: string[];
  objetivo: 'emagrecer' | 'ganhar_massa' | 'manter';
  treinoBase: string;
  nivelTreino: string;
  caloriasRecomendadas?: number;
  metaCalorias?: number;
};
type Exercise = { nome: string; series: number; repeticoes: string; descanso: string; pesoInicial?: number };
type Workout = { diaSemana: string; nomeTreino: string; exercicios: Exercise[] };
type WorkoutSession = {
  _id: string;
  status: 'pendente' | 'em_andamento' | 'cancelada' | 'concluida';
  scheduledFor: string;
  windowEndsAt: string;
  startedAt?: string;
  workout: Workout;
};
type Meal = {
  _id?: string;
  nome: string;
  horario?: string;
  alimentos: string[];
  calorias: number;
  macros: { proteina: number; carboidratos: number; gordura: number };
};
type MacroTotals = { calorias: number; proteina: number; carbo: number; gordura: number };
type MealsToday = {
  consumed: MacroTotals;
  goal: MacroTotals;
  completed: Array<{ _id: string; tipoRefeicao: string; horario: string }>;
};
type ReviewMeal = Meal & { horario: string };
type ReviewWorkout = Workout & { horario: string };
type Review = {
  kind: 'diet' | 'workout' | 'routine';
  previewId?: string;
  dieta?: ReviewMeal[];
  dietaPreviewId?: string;
  treino?: ReviewWorkout[];
  treinoPreviewId?: string;
  historicoTreino?: string;
  metaCalorias?: number;
};
type DietPreviewResponse = { previewId: string; dieta: ReviewMeal[] };
type WorkoutPreviewResponse = { previewId: string; treino: ReviewWorkout[]; historicoTreino?: string };
type Point = { data: string; valor: number };
type Overview = {
  profile: Partial<HealthProfile> & { preferenciasComida?: string[]; pesoHistorico?: Array<{ data: string; peso: number }> };
  workouts: Workout[];
  todayWorkout: Workout | null;
  workoutSession: WorkoutSession | null;
  diet: { _id?: string; refeicoes: Meal[]; objetivo?: string } | null;
  caloriasRecomendadas: number;
  waterToday: number;
  waterGoalMl: number;
  waterHistory: Point[];
  weightHistory: Point[];
  workoutHistory: Point[];
};
type Tab = 'Perfil' | 'Academia & Água' | 'Nutrição' | 'Dashboard';
type MetricKey = 'peso' | 'agua' | 'treino';
type MetricSeries = { key: MetricKey; label: string; color: string; points: Point[]; unit: string };

declare global {
  interface Window {
    forceFocusMode: (value: boolean) => void;
  }
}

const EMPTY_PROFILE: HealthProfile = {
  peso: 70,
  altura: 170,
  sexo: 'Prefiro não informar',
  idade: 30,
  metaPeso: 70,
  disponibilidadeDias: [],
  disponibilidadeTreino: [],
  disponibilidadePorDia: {},
  duracaoTreino: 60,
  alimentosPreferidos: [],
  alimentosQueNaoGosta: [],
  restricoes: [],
  objetivo: 'manter',
  treinoBase: 'abc-3-dias',
  nivelTreino: 'iniciante',
};
const TABS: Tab[] = ['Perfil', 'Academia & Água', 'Nutrição', 'Dashboard'];
const HOURS = ['07:00', '08:00', '09:00', '12:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
const DAYS = [
  ['segunda-feira', 'Seg'],
  ['terça-feira', 'Ter'],
  ['quarta-feira', 'Qua'],
  ['quinta-feira', 'Qui'],
  ['sexta-feira', 'Sex'],
  ['sábado', 'Sáb'],
  ['domingo', 'Dom'],
] as const;
type FoodListKey = 'alimentosPreferidos' | 'alimentosQueNaoGosta' | 'restricoes';
const FOOD_LISTS: Array<{ key: FoodListKey; label: string; empty: string }> = [
  { key: 'alimentosPreferidos', label: 'Alimentos que você gosta', empty: 'Adicione seus favoritos' },
  { key: 'alimentosQueNaoGosta', label: 'Alimentos que você evita', empty: 'Nenhum alimento evitado' },
  { key: 'restricoes', label: 'Restrições', empty: 'Nenhuma restrição' },
];
const WORKOUT_SPLITS = [
  { value: 'abc-3-dias', label: 'ABC · 3 dias', sessions: 3 },
  { value: 'abcd-4-dias', label: 'ABCD · 4 dias', sessions: 4 },
  { value: 'full-body-2-dias', label: 'Full Body · 2 dias', sessions: 2 },
];
const isValidWorkoutTime = (value: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(value.trim());

function sanitizeTimeInput(raw: string): string {
  const cleaned = raw.replace(/[^\d:]/g, '');
  const colonIndex = cleaned.indexOf(':');
  if (colonIndex === -1) {
    const digits = cleaned.slice(0, 4);
    return digits.length === 4 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
  }
  const before = cleaned.slice(0, colonIndex).replace(/:/g, '').slice(0, 2);
  const after = cleaned.slice(colonIndex + 1).replace(/:/g, '').slice(0, 2);
  return `${before}:${after}`;
}

function formatTimeOnBlur(value: string): string {
  const trimmed = value.trim();
  const colonMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    const formatted = `${colonMatch[1].padStart(2, '0')}:${colonMatch[2].padStart(2, '0')}`;
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(formatted) ? formatted : value;
  }
  if (/^\d{3,4}$/.test(trimmed)) {
    const padded = trimmed.padStart(4, '0');
    const formatted = `${padded.slice(0, 2)}:${padded.slice(2)}`;
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(formatted) ? formatted : value;
  }
  if (/^\d{1,2}$/.test(trimmed) && Number(trimmed) <= 23) {
    return `${trimmed.padStart(2, '0')}:00`;
  }
  return value;
}

function formattedDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
}

function minutesUntilWorkout(profile: HealthProfile, now = new Date()): number | null {
  const day = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' })
    .format(now).toLocaleLowerCase('pt-BR');
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(now);
  const times = profile.disponibilidadePorDia[day] || [];
  const current = now.getTime();
  const next = times
    .filter(isValidWorkoutTime)
    .map((time) => new Date(`${date}T${time}:00-03:00`).getTime())
    .filter((timestamp) => timestamp >= current)
    .sort((a, b) => a - b)[0];
  return next === undefined ? null : Math.ceil((next - current) / 60_000);
}

function TabIcon({ tab }: { tab: Tab }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      {tab === 'Perfil' && <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.1 3.2-5 7-5s6.3 1.9 7 5" /></>}
      {tab === 'Academia & Água' && <><path d="M6 8h12M6 16h12M8 5v6M16 13v6M4 10v4M20 10v4" /></>}
      {tab === 'Nutrição' && <><path d="M12 21c-4.8 0-8-3.4-8-8 0-4.2 3.2-7.5 8-10 4.8 2.5 8 5.8 8 10 0 4.6-3.2 8-8 8Z" /><path d="M12 5c.3 5.4 2.3 9 5 11" /></>}
      {tab === 'Dashboard' && <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /></>}
    </svg>
  );
}

/** Campo de horário em texto, sempre no formato 24 h (HH:MM), independente do idioma do navegador. */
function TimeInput24({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) {
  return (
    <input
      className="review-time"
      type="text"
      inputMode="numeric"
      maxLength={5}
      placeholder="HH:MM"
      value={value}
      aria-label={label}
      aria-invalid={!isValidWorkoutTime(value)}
      onChange={(event) => onChange(sanitizeTimeInput(event.target.value))}
      onBlur={() => {
        const formatted = formatTimeOnBlur(value);
        if (formatted !== value) onChange(formatted);
      }}
    />
  );
}
function MealIcon({ name }: { name: string }) {
  const key = name.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const kind = /cafe|manha|desjejum/.test(key) ? 'sun' : /jantar|ceia|noite/.test(key) ? 'moon' : 'fork';
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      {kind === 'sun' && <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>}
      {kind === 'fork' && <><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10" /></>}
      {kind === 'moon' && <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />}
    </svg>
  );
}

function MacroBar({ label, value, goal, unit, className }: { label: string; value: number; goal: number; unit: string; className: string }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  return (
    <div className="nutrition-macro">
      <div className="nutrition-macro-head"><span>{label}</span><strong>{Math.round(value)} / {Math.round(goal)} {unit}</strong></div>
      <div className="macro-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span className={`macro-fill ${className}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ChoiceChip({
  label,
  selected,
  onClick,
  avoid = false,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  avoid?: boolean;
}) {
  return (
    <button
      type="button"
      className={`health-chip${selected ? ' is-selected' : ''}${avoid && selected ? ' is-avoid' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span>{label}</span>
      {selected && <svg aria-hidden="true" viewBox="0 0 16 16" fill="none"><path d="m3 8 3 3 7-7" /></svg>}
    </button>
  );
}

function MultiLineChart({
  series,
  focus,
}: {
  series: MetricSeries[];
  focus: MetricKey | null;
}) {
  const chart = useMemo(() => {
    const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.data)))].sort();
    if (!dates.length) return [];
    return series.map((item) => {
      const points = item.points.filter((point) => dates.includes(point.data));
      if (!points.length) return { ...item, path: '', area: '', coordinates: [] };
      const values = points.map((point) => point.valor);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const spread = max - min || Math.max(Math.abs(max) * 0.1, 1);
      const coordinates = points.map((point) => ({
        ...point,
        x: dates.length === 1 ? 320 : 38 + dates.indexOf(point.data) * 564 / (dates.length - 1),
        y: 180 - ((point.valor - min) / spread) * 140,
      }));
      const path = coordinates.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
      return {
        ...item,
        path,
        area: `${path} L${coordinates[coordinates.length - 1].x},190 L${coordinates[0].x},190 Z`,
        coordinates,
        latest: points[points.length - 1],
      };
    });
  }, [series]);

  if (!chart.some((item) => item.points.length)) {
    return <p className="health-empty">Os gráficos aparecem assim que houver registros de peso, água e treino.</p>;
  }
  return (
    <div className="health-chart-wrap">
      <svg className="health-chart" viewBox="0 0 640 220" role="img" aria-label="Gráfico de peso, consumo de água e carga média">
        <defs>
          {series.map((item) => (
            <linearGradient key={item.key} id={`health-gradient-${item.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity=".32" />
              <stop offset="100%" stopColor={item.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        <path className="health-chart-grid" d="M38 40H602M38 110H602M38 180H602" />
        {chart.map((item) => item.points.length > 0 && (
          <g
            key={item.key}
            className={focus && focus !== item.key ? 'is-muted' : 'is-focused'}
            style={{ opacity: focus && focus !== item.key ? 0.2 : 1, transition: 'opacity .25s ease' }}
          >
            <path d={item.area} fill={`url(#health-gradient-${item.key})`} />
            <path className="health-chart-line" d={item.path} style={{ stroke: item.color }} />
            {item.coordinates.map((point) => (
              <circle key={`${item.key}-${point.data}`} cx={point.x} cy={point.y} r="4" style={{ fill: item.color }}>
                <title>{`${item.label}, ${formattedDate(point.data)}: ${point.valor} ${item.unit}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function PageHealth() {
  const [tab, setTab] = useState<Tab>('Perfil');
  const [profile, setProfile] = useState<HealthProfile>(EMPTY_PROFILE);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [workoutStartOpen, setWorkoutStartOpen] = useState(false);
  const [workoutWeight, setWorkoutWeight] = useState('');
  const [editingFoodList, setEditingFoodList] = useState<FoodListKey | null>(null);
  const [newFood, setNewFood] = useState('');
  const [newExerciseName, setNewExerciseName] = useState('');
  const [customWorkoutTime, setCustomWorkoutTime] = useState('');
  const [activeScheduleDay, setActiveScheduleDay] = useState<string>(DAYS[0][0]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mealLogs, setMealLogs] = useState<MealsToday | null>(null);
  const [expandedMeals, setExpandedMeals] = useState<string[]>([]);
  const [loggingMeal, setLoggingMeal] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<Review | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [focusMetric, setFocusMetric] = useState<MetricKey | null>(null);
  const [completedExercises, setCompletedExercises] = useState<string[]>([]);
  const [exerciseLogs, setExerciseLogs] = useState<Record<string, { pesoAtual: string; repeticoes: string }>>({});
  const [swapExercise, setSwapExercise] = useState<Exercise | null>(null);
  const [swapSuggestions, setSwapSuggestions] = useState<string[]>([]);
  const [swapBusy, setSwapBusy] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusMinutes, setFocusMinutes] = useState<number | null>(null);
  const [selectedWorkoutDay, setSelectedWorkoutDay] = useState<string>(
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(new Date()).toLocaleLowerCase('pt-BR')
  );
  const [dirtyWorkoutDays, setDirtyWorkoutDays] = useState<string[]>([]);
  const manualFocusMode = useRef<boolean | null>(null);
  const focusDismissedDate = useRef<string | null>(null);
  const lastSavedCalories = useRef<number | null>(null);
  useEffect(() => {
    const updateFocusMode = () => {
      if (manualFocusMode.current !== null) return;
      const minutes = minutesUntilWorkout(profile);
      setFocusMinutes(minutes);
      const activeSession = overview?.workoutSession?.status === 'pendente' || overview?.workoutSession?.status === 'em_andamento';
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      setIsFocusMode(Boolean(
        activeSession || (focusDismissedDate.current !== today && minutes !== null && minutes <= 15)
      ));
    };
    updateFocusMode();
    const timer = window.setInterval(updateFocusMode, 60_000);
    return () => window.clearInterval(timer);
  }, [profile.disponibilidadePorDia, overview?.workoutSession]);

  useEffect(() => {
    window.forceFocusMode = (value: boolean) => {
      manualFocusMode.current = value;
      setIsFocusMode(value);
    };
    return () => {
      delete (window as Partial<Window>).forceFocusMode;
    };
  }, []);

  const applyOverview = (data: Overview) => {
    setOverview(data);
    lastSavedCalories.current = data.profile.metaCalorias ?? null;
    setSelectedWorkoutDay((current) =>
      data.workouts.some((workout) => workout.diaSemana === current)
        ? current
        : data.workouts[0]?.diaSemana || current
    );
    const savedSplit = data.profile.treinoBase;
    const legacyAvailability = data.profile.disponibilidadePorDia || Object.fromEntries(
      (data.profile.disponibilidadeDias || []).map((day) => [day, data.profile.disponibilidadeTreino || []])
    );
    setProfile({
      ...EMPTY_PROFILE,
      ...data.profile,
      disponibilidadePorDia: legacyAvailability,
      disponibilidadeDias: DAYS.map(([day]) => day).filter((day) => (legacyAvailability[day] || []).length > 0),
      disponibilidadeTreino: [...new Set(Object.values(legacyAvailability).flat())],
      duracaoTreino: data.profile.duracaoTreino || EMPTY_PROFILE.duracaoTreino,
      alimentosPreferidos: data.profile.alimentosPreferidos || data.profile.preferenciasComida || [],
      treinoBase: savedSplit || EMPTY_PROFILE.treinoBase,
    });
  };
  const loadOverview = async () => {
    const data = await api<Overview>('/health/overview');
    applyOverview(data);
  };

  useEffect(() => {
    let active = true;
    api<Overview>('/health/overview')
      .then((data) => { if (active) applyOverview(data); })
      .catch((cause: unknown) => {
        if (active) setError(`Não foi possível carregar os dados: ${cause instanceof Error ? cause.message : 'erro desconhecido'}`);
      })
      .finally(() => { if (active) setLoading(false); });
    const refreshTimer = window.setInterval(() => {
      api<Overview>('/health/overview')
        .then((data) => { if (active) setOverview(data); })
        .catch((cause: unknown) => {
          if (active) setError(`Não foi possível atualizar a sessão: ${cause instanceof Error ? cause.message : 'erro desconhecido'}`);
        });
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  const loadMealsToday = async () => {
    setMealLogs(await api<MealsToday>('/health/meals/today'));
  };
  useEffect(() => {
    if (tab !== 'Nutrição') return;
    let active = true;
    api<MealsToday>('/health/meals/today')
      .then((data) => { if (active) setMealLogs(data); })
      .catch(() => { /* O resumo permanece vazio se a consulta falhar. */ });
    return () => { active = false; };
  }, [tab, overview?.diet]);
  const completeMeal = async (meal: Meal) => {
    setError('');
    setLoggingMeal(meal.nome);
    try {
      await api('/health/meals/log', { method: 'POST', body: JSON.stringify({ tipoRefeicao: meal.nome }) });
      await loadMealsToday();
      setMessage(`${meal.nome} registrado!`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a refeição.');
    } finally {
      setLoggingMeal(null);
    }
  };
  const uncompleteMeal = async (meal: Meal) => {
    const log = mealLogs?.completed.find((item) => item.tipoRefeicao === meal.nome);
    if (!log) return;
    setLoggingMeal(meal.nome);
    try { setMealLogs(await api<MealsToday>(`/health/meals/log/${log._id}`, { method: 'DELETE' })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível desmarcar a refeição.'); }
    finally { setLoggingMeal(null); }
  };
  const toggleMealExpanded = (name: string) => {
    setExpandedMeals((items) => items.includes(name) ? items.filter((item) => item !== name) : [...items, name]);
  };
  const updateProfile = <K extends keyof HealthProfile>(key: K, value: HealthProfile[K]) => {
    setProfile((current) => ({ ...current, [key]: value }));
  };
  const persistProfile = async () => {
    const response = await api<{ profile: HealthProfile }>('/health/profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    });
    setProfile(response.profile);
    return response.profile;
  };
  const changeFood = (key: FoodListKey, action: 'add' | 'remove', value: string) => {
    const cleanedValue = value.trim();
    const list = profile[key];
    if (action === 'add' && (!cleanedValue || list.some((item) => item.toLocaleLowerCase('pt-BR') === cleanedValue.toLocaleLowerCase('pt-BR')))) return;
    updateProfile(key, action === 'add'
        ? [...list, cleanedValue]
        : list.filter((item) => item !== value)
    );
  };

  const fetchReview = async (kind: Review['kind']): Promise<Review> => {
    const saved = await persistProfile();
    const [diet, workout] = await Promise.all([
      kind === 'workout' ? null : api<DietPreviewResponse>('/health/generate-diet', {
        method: 'POST',
        body: JSON.stringify({ preferencias: saved.alimentosPreferidos, restricoes: [...saved.alimentosQueNaoGosta, ...saved.restricoes] }),
      }),
      kind === 'diet' ? null : api<WorkoutPreviewResponse>('/health/generate-workout', {
        method: 'POST',
        body: JSON.stringify({ treinoBase: saved.treinoBase }),
      }),
    ]);
    return {
      kind,
      previewId: diet?.previewId || workout?.previewId,
      dieta: diet?.dieta,
      dietaPreviewId: diet?.previewId,
      treino: workout?.treino,
      treinoPreviewId: workout?.previewId,
      historicoTreino: workout?.historicoTreino,
      metaCalorias: diet
        ? overview?.caloriasRecomendadas || saved.caloriasRecomendadas || 2000
        : undefined,
    };
  };
  const startReview = async (kind: Review['kind']) => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      setPreviewData(await fetchReview(kind));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o plano.');
    } finally {
      setBusy(false);
    }
  };
  const generateDiet = async () => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const saved = await persistProfile();
      const diet = await api<DietPreviewResponse>('/health/generate-diet', {
        method: 'POST',
        body: JSON.stringify({ preferencias: saved.alimentosPreferidos, restricoes: [...saved.alimentosQueNaoGosta, ...saved.restricoes] }),
      });
      setPreviewData({
        kind: 'diet',
        previewId: diet.previewId,
        dieta: diet.dieta,
        dietaPreviewId: diet.previewId,
        metaCalorias: overview?.caloriasRecomendadas || saved.caloriasRecomendadas || 2000,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar a dieta.');
    } finally {
      setBusy(false);
    }
  };
  const generateWorkout = () => startReview('workout');
  const saveAndGenerate = () => startReview('routine');
  const redoReview = async () => {
    if (!previewData) return;
    setError('');
    setIsSaving(true);
    try {
      setPreviewData(await fetchReview(previewData.kind));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o plano novamente.');
    } finally {
      setIsSaving(false);
    }
  };
  const updateReviewMeal = (index: number, horario: string) => {
    setPreviewData((current) => current && ({ ...current, dieta: current.dieta?.map((meal, i) => i === index ? { ...meal, horario } : meal) }));
  };
  const updateReviewMealName = (index: number, nome: string) => setPreviewData((current) => current && ({ ...current, dieta: current.dieta?.map((meal, i) => i === index ? { ...meal, nome } : meal) }));
  const updateReviewFood = (mealIndex: number, foodIndex: number, value: string) => setPreviewData((current) => current && ({ ...current, dieta: current.dieta?.map((meal, i) => i === mealIndex ? { ...meal, alimentos: meal.alimentos.map((food, j) => j === foodIndex ? value : food) } : meal) }));
  const removeReviewMeal = (index: number) => setPreviewData((current) => current && ({ ...current, dieta: current.dieta?.filter((_, i) => i !== index) }));
  const updateReviewWorkout = (index: number, horario: string) => {
    setPreviewData((current) => current && ({ ...current, treino: current.treino?.map((item, i) => i === index ? { ...item, horario } : item) }));
  };
  const confirmReview = async () => {
    if (!previewData) return;
    setError('');
    setIsSaving(true);
    try {
      const normalizedDieta = previewData.dieta?.map((meal) => ({ ...meal, horario: formatTimeOnBlur(meal.horario) }));
      const normalizedTreino = previewData.treino?.map((item) => ({ ...item, horario: formatTimeOnBlur(item.horario) }));
      if (normalizedDieta?.length && previewData.metaCalorias) {
        const calorieProfile = await api<{ profile: Partial<HealthProfile> }>('/health/profile', {
          method: 'PATCH',
          body: JSON.stringify({ metaCalorias: previewData.metaCalorias }),
        });
        lastSavedCalories.current = previewData.metaCalorias;
        setProfile((current) => ({ ...current, ...calorieProfile.profile, metaCalorias: previewData.metaCalorias }));
      }
      const result = await api<{ calendar?: { connected: boolean; created: number } }>('/health/confirm-routine', {
        method: 'POST',
        body: JSON.stringify({
          previewId: previewData.previewId || previewData.dietaPreviewId || previewData.treinoPreviewId,
          dieta: normalizedDieta,
          dietaPreviewId: previewData.dietaPreviewId || previewData.previewId,
          treino: normalizedTreino,
          treinoPreviewId: previewData.treinoPreviewId || previewData.previewId,
        }),
      });
      const kind = previewData.kind;
      setPreviewData(null);
      await loadOverview();
      if (kind !== 'workout') {
        await loadMealsToday().catch(() => { /* ignora falha silenciosa */ });
      }
      if (kind !== 'diet') setTab('Academia & Água');
      setMessage(result.calendar?.connected
        ? `Plano salvo. ${result.calendar.created} evento(s) agendado(s) no Google Calendar.`
        : kind === 'diet'
          ? 'Plano alimentar salvo.'
          : 'Plano salvo. Conecte o Google Calendar para agendar os eventos.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o plano.');
    } finally {
      setIsSaving(false);
    }
  };
  const logWater = async (ml: -250 | 250 | 500) => {
    setError('');
    setBusy(true);
    try {
      const result = await api<{ waterToday: number }>('/health/water', {
        method: 'POST',
        body: JSON.stringify({ ml }),
      });
      if (overview) setOverview({ ...overview, waterToday: result.waterToday });
      window.dispatchEvent(new Event(WATER_INTAKE_EVENT));
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a água.');
    } finally {
      setBusy(false);
    }
  };
  const deleteWorkoutDay = async (day: string) => {
    if (!window.confirm(`Apagar o treino de ${day}?`)) return;
    await api(`/health/workouts/${encodeURIComponent(day)}`, { method: 'DELETE' });
    await loadOverview();
  };
  const suggestExerciseSwap = async (exercise: Exercise) => {
    setSwapExercise(exercise);
    setSwapSuggestions([]);
    setSwapBusy(true);
    setError('');
    try {
      const result = await api<{ suggestions: string[] }>('/health/workout/swap-suggestion', {
        method: 'POST',
        body: JSON.stringify({ exercicioAtual: exercise.nome, grupoMuscular: 'mesmo grupo muscular' }),
      });
      setSwapSuggestions(result.suggestions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível sugerir substituições.');
      setSwapExercise(null);
    } finally {
      setSwapBusy(false);
    }
  };
  const applyExerciseSwap = async (suggestion: string) => {
    if (!swapExercise) return;
    setError('');
    setBusy(true);
    try {
      if (overview?.workoutSession?.status === 'em_andamento') {
        const result = await api<{ workoutSession: WorkoutSession }>('/health/workout/swap', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: overview.workoutSession._id,
            exercicioAtual: swapExercise.nome,
            exercicioSubstituto: suggestion,
          }),
        });
        setOverview((current) => current && ({
          ...current,
          workoutSession: result.workoutSession,
          todayWorkout: result.workoutSession.workout,
        }));
      } else {
        const workout = overview?.workouts.find((item) => item.diaSemana === selectedWorkoutDay);
        if (!workout) throw new Error('Treino do dia não encontrado.');
        const updated = {
          ...workout,
          exercicios: workout.exercicios.map((exercise) =>
            exercise.nome === swapExercise.nome ? { ...exercise, nome: suggestion } : exercise
          ),
        };
        const result = await api<{ workout: Workout }>(`/health/workouts/${encodeURIComponent(selectedWorkoutDay)}`, {
          method: 'PUT',
          body: JSON.stringify(updated),
        });
        setOverview((current) => current && ({
          ...current,
          workouts: current.workouts.map((item) => item.diaSemana === selectedWorkoutDay ? result.workout : item),
          todayWorkout: current.todayWorkout?.diaSemana === selectedWorkoutDay ? result.workout : current.todayWorkout,
        }));
      }
      setCompletedExercises((items) => items.filter((name) => name !== swapExercise.nome));
      setExerciseLogs((current) => {
        const next = { ...current };
        delete next[swapExercise.nome];
        return next;
      });
      setSwapExercise(null);
      setMessage('Exercício substituído.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível substituir o exercício.');
    } finally {
      setBusy(false);
    }
  };
  const startWorkoutWithWeight = async () => {
    const peso = Number(workoutWeight);
    if (!Number.isFinite(peso) || peso < 20 || peso > 400) { setError('Informe um peso entre 20 e 400 kg.'); return; }
    setBusy(true); setError('');
    try {
      const result = await api<{ workoutSession: WorkoutSession }>('/health/workout/start', { method: 'POST', body: JSON.stringify({ peso }) });
      setOverview((current) => current && ({ ...current, workoutSession: result.workoutSession, profile: { ...current.profile, peso } }));
      setProfile((current) => ({ ...current, peso }));
      setWorkoutStartOpen(false);
      setMessage('Treino iniciado. Peso registrado.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'N?o foi poss?vel iniciar o treino.'); }
    finally { setBusy(false); }
  };

  const finishWorkout = async () => {
    if (!focusWorkout) {
      manualFocusMode.current = null;
      setIsFocusMode(false);
      return;
    }
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const session = overview?.workoutSession;
      let sessionId = session?.status === 'em_andamento' ? session._id : undefined;
      if (session?.status === 'pendente' && completedExercises.length) {
        const started = await api<{ workoutSession: WorkoutSession }>('/health/workout/start', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        sessionId = started.workoutSession._id;
      }
      if (completedExercises.length) {
        const logs = completedExercises.map((name) => {
          const exercise = focusWorkout.exercicios.find((item) => item.nome === name)!;
          const values = exerciseLogs[name] || {
            pesoAtual: '',
            repeticoes: exercise.repeticoes.match(/\d+/)?.[0] || '',
          };
          return {
            exercicio: name,
            pesoInicial: exercise.pesoInicial || 0,
            pesoAtual: Number(values.pesoAtual),
            series: exercise.series,
            repeticoes: Number(values.repeticoes),
          };
        });
        await api('/health/workout-logs', {
          method: 'POST',
          body: JSON.stringify({ logs, ...(sessionId ? { sessionId } : {}) }),
        });
      } else if (session?.status === 'pendente') {
        await api('/health/workout/cancel', {
          method: 'POST',
          body: JSON.stringify({ sessionId: session._id }),
        });
      }
      if (sessionId) {
        await api('/health/workout/finish', {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        });
      }
      focusDismissedDate.current = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      manualFocusMode.current = null;
      setIsFocusMode(false);
      setCompletedExercises([]);
      setExerciseLogs({});
      await loadOverview();
      setMessage('Treino finalizado.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível finalizar o treino.');
    } finally {
      setBusy(false);
    }
  };
  const toggleCompleted = (name: string) => {
    if (completedExercises.includes(name)) {
      setCompletedExercises((items) => items.filter((item) => item !== name));
      return;
    }

    setCompletedExercises((items) => [...items, name]);
  };
  const updateExerciseLog = (name: string, key: 'pesoAtual' | 'repeticoes', value: string) => {
    setExerciseLogs((current) => ({
      ...current,
      [name]: { pesoAtual: current[name]?.pesoAtual ?? '', repeticoes: current[name]?.repeticoes ?? '', [key]: value },
    }));
  };
  const updateWorkoutPlan = (day: string, update: (workout: Workout) => Workout) => {
    setOverview((current) => {
      if (!current) return current;
      const workouts = current.workouts.map((workout) => workout.diaSemana === day ? update(workout) : workout);
      const changed = workouts.find((workout) => workout.diaSemana === day) || null;
      return {
        ...current,
        workouts,
        todayWorkout: current.todayWorkout?.diaSemana === day ? changed : current.todayWorkout,
      };
    });
    setDirtyWorkoutDays((days) => days.includes(day) ? days : [...days, day]);
  };
  const saveWorkoutPlan = async () => {
    if (!overview || !dirtyWorkoutDays.length) return;
    setError('');
    setBusy(true);
    try {
      const updates = await Promise.all(dirtyWorkoutDays.map(async (day) => {
        const workout = overview.workouts.find((item) => item.diaSemana === day);
        if (!workout) throw new Error(`Treino de ${day} não encontrado.`);
        const result = await api<{ workout: Workout }>(`/health/workouts/${encodeURIComponent(day)}`, {
          method: 'PUT',
          body: JSON.stringify(workout),
        });
        return { day, workout: result.workout };
      }));
      setOverview((current) => current && ({
        ...current,
        workouts: current.workouts.map((item) => updates.find((update) => update.day === item.diaSemana)?.workout || item),
        todayWorkout: current.todayWorkout
          ? updates.find((update) => update.day === current.todayWorkout?.diaSemana)?.workout || current.todayWorkout
          : null,
      }));
      setDirtyWorkoutDays([]);
      setMessage('Treino atualizado.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o treino.');
    } finally {
      setBusy(false);
    }
  };
  const toggleWorkoutTime = (day: string, time: string) => {
    const currentTimes = profile.disponibilidadePorDia[day] || [];
    if (currentTimes.length === 1 && currentTimes[0] === time) {
      updateWorkoutTime(day, []);
      return;
    }
    updateWorkoutTime(day, [time]);
  };
  const updateWorkoutTime = (day: string, updatedTimes: string[]) => {
    const availability = { ...profile.disponibilidadePorDia };
    if (updatedTimes.length) availability[day] = updatedTimes;
    else delete availability[day];
    const days = DAYS.map(([name]) => name).filter((name) => (availability[name] || []).length > 0);
    updateProfile('disponibilidadePorDia', availability);
    updateProfile('disponibilidadeDias', days);
    updateProfile('disponibilidadeTreino', [...new Set(Object.values(availability).flat())].sort());
  };
  const series: MetricSeries[] = [
    { key: 'peso', label: 'Peso', color: '#9db4ff', points: overview?.weightHistory || [], unit: 'kg' },
    { key: 'agua', label: 'Água', color: '#53d6e8', points: overview?.waterHistory || [], unit: 'ml' },
    { key: 'treino', label: 'Carga média', color: '#f0a45b', points: overview?.workoutHistory || [], unit: 'kg' },
  ];
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weeklyWorkoutCount = new Set(
    (overview?.workoutHistory || [])
      .filter((point) => new Date(point.data) >= weekStart)
      .map((point) => point.data.slice(0, 10))
  ).size;
  const weeklyWorkoutGoal = overview?.workouts.length || 0;
  const weeklyWaterMl = (overview?.waterHistory || [])
    .filter((point) => new Date(point.data) >= weekStart)
    .reduce((total, point) => total + point.valor, 0);
  const weeklyWaterGoalMl = (overview?.waterGoalMl || 0) * 7;
  const requiredWorkoutDays = overview?.workouts.length
    ? 1
    : WORKOUT_SPLITS.find((split) => split.value === profile.treinoBase)?.sessions || 1;
  const calorieTarget = profile.metaCalorias || profile.caloriasRecomendadas || overview?.caloriasRecomendadas || 2000;
  const validProfileMeasurements =
    profile.peso >= 20 && profile.peso <= 400 &&
    profile.altura >= 80 && profile.altura <= 250 &&
    profile.idade >= 13 && profile.idade <= 120 &&
    profile.metaPeso >= 20 && profile.metaPeso <= 400 &&
    profile.duracaoTreino >= 15 && profile.duracaoTreino <= 240;
  const activeWorkout = overview?.workoutSession?.status === 'em_andamento'
    ? overview.workoutSession.workout
    : null;
  const workoutSession = overview?.workoutSession;
  const todayWorkout = overview?.todayWorkout;
  const focusWorkout = activeWorkout || (workoutSession?.status === 'pendente' ? workoutSession.workout : todayWorkout);
  const planDirty = dirtyWorkoutDays.length > 0;

  return (
    <main className="page health-page">
      <header className="health-top">
        <div className="health-title"><p className="calendar-eyebrow">BEM-ESTAR</p><h1 className="page-title">Saúde</h1></div>
        <div className="health-tabs" role="tablist" aria-label="Seções de saúde">
          {TABS.map((name) => (
            <button key={name} className="health-tab" type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
              <TabIcon tab={name} /><span>{name}</span>
            </button>
          ))}
        </div>
        <div className="health-profile-summary">{profile.peso ? <span>{profile.peso} kg</span> : null}</div>
      </header>

      {(error || message) && <p className={`health-message${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}</p>}
      {workoutStartOpen && <div className="health-food-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setWorkoutStartOpen(false); }}><section className="health-food-modal" role="dialog" aria-modal="true" aria-labelledby="workout-weight-title"><div className="health-food-modal-heading"><h2 id="workout-weight-title">Qual seu peso hoje?</h2><button type="button" aria-label="Fechar" onClick={() => setWorkoutStartOpen(false)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div><label>Peso (kg)<input type="number" min="20" max="400" step="0.1" value={workoutWeight} onChange={(event) => setWorkoutWeight(event.target.value)} autoFocus /></label><div className="health-actions"><button className="btn ghost" type="button" disabled={busy} onClick={() => setWorkoutStartOpen(false)}>Cancelar</button><button className="btn" type="button" disabled={busy} onClick={startWorkoutWithWeight}>{busy ? 'Iniciando...' : 'Salvar e iniciar'}</button></div></section></div>}

      <div className={`health-tab-body${tab === 'Dashboard' ? ' is-dashboard' : tab === 'Perfil' ? ' is-profile' : tab === 'Academia & Água' ? ' is-gym' : tab === 'Nutrição' ? ' is-diet' : ''}`}>
        {tab === 'Perfil' && (
          <section className="health-profile-panel" role="tabpanel" aria-label="Perfil">
            <div className="health-profile-grid">
              <article className="health-profile-card health-basic-card">
                <h2>Dados básicos</h2>
                <div className="health-basic-fields">
                  {([
                    ['peso', 'Peso', 'kg', 20, 400, 0.1],
                    ['altura', 'Altura', 'cm', 80, 250, 1],
                    ['idade', 'Idade', 'anos', 13, 120, 1],
                  ] as const).map(([field, label, unit, min, max, step]) => (
                    <label className="health-compact-field" key={field}>
                      <span>{label}</span>
                      <span className="health-number-input">
                        <input
                          type="number"
                          min={min}
                          max={max}
                          step={step}
                          value={profile[field] || ''}
                          aria-label={label}
                          onChange={(event) => updateProfile(field, Number(event.target.value))}
                        />
                        <small>{unit}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <label className="health-level-field">Nível de treino
                  <select value={profile.nivelTreino} onChange={(event) => updateProfile('nivelTreino', event.target.value)}>
                    <option value="iniciante">Iniciante</option>
                    <option value="intermediário">Intermediário</option>
                    <option value="avançado">Avançado</option>
                  </select>
                </label>
                <label className="health-level-field">Duração do treino
                  <select value={profile.duracaoTreino} onChange={(event) => updateProfile('duracaoTreino', Number(event.target.value))}>
                    {[30, 45, 60, 75, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}
                  </select>
                </label>
                <label className="health-level-field">Divisão do treino
                  <select value={profile.treinoBase} onChange={(event) => updateProfile('treinoBase', event.target.value)}>
                    {WORKOUT_SPLITS.map((split) => <option key={split.value} value={split.value}>{split.label}</option>)}
                    {!WORKOUT_SPLITS.some((split) => split.value === profile.treinoBase) && profile.treinoBase && <option value={profile.treinoBase}>{profile.treinoBase}</option>}
                  </select>
                </label>
              </article>

              <article className="health-profile-card health-routine-card">
                <h2>Objetivo e rotina</h2>
                <div className="health-objectives" aria-label="Objetivo">
                  {([
                    ['emagrecer', 'Emagrecer'],
                    ['ganhar_massa', 'Ganhar músculo'],
                    ['manter', 'Manter'],
                  ] as const).map(([value, label]) => (
                    <button key={value} className="health-objective" type="button" aria-pressed={profile.objetivo === value} onClick={() => updateProfile('objetivo', value)}>
                      {label}
                    </button>
                  ))}
                </div>
                <fieldset className="health-choice-group">
                  <legend>Dias e horários disponíveis</legend>
                  <p className="health-schedule-hint">Selecione um dia para definir o horário específico daquele treino.</p>
                  <div className="health-day-grid">
                    {DAYS.map(([value, label]) => {
                      const times = profile.disponibilidadePorDia[value] || [];
                      return (
                        <button
                          key={value}
                          className={`health-schedule-day${times.length ? ' is-selected' : ''}`}
                          type="button"
                          aria-expanded={activeScheduleDay === value}
                          aria-label={`${label}${times.length ? `, horários: ${times.join(', ')}` : ', sem horário selecionado'}`}
                          onClick={() => setActiveScheduleDay(value)}
                        >
                          <span>{label}</span>
                          {times.length > 0 && <small>{times.length}</small>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="health-schedule-editor">
                    <span>{DAYS.find(([day]) => day === activeScheduleDay)?.[1]}: escolha os horários</span>
                    <div className="health-time-grid">
                      {HOURS.map((hour) => (
                        <ChoiceChip
                          key={hour}
                          label={hour}
                          selected={(profile.disponibilidadePorDia[activeScheduleDay] || []).includes(hour)}
                          onClick={() => toggleWorkoutTime(activeScheduleDay, hour)}
                        />
                      ))}
                    </div>
                    <form className="health-custom-time" onSubmit={(event) => {
                      event.preventDefault();
                      const formatted = formatTimeOnBlur(customWorkoutTime);
                      if (!isValidWorkoutTime(formatted)) return;
                      setCustomWorkoutTime(formatted);
                      updateWorkoutTime(activeScheduleDay, [formatted]);
                    }}>
                      <label htmlFor="health-custom-workout-time">Outro horário</label>
                      <div>
                        <input
                          id="health-custom-workout-time"
                          type="text"
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="HH:MM"
                          value={customWorkoutTime}
                          onChange={(event) => setCustomWorkoutTime(sanitizeTimeInput(event.target.value))}
                          onBlur={() => setCustomWorkoutTime((current) => formatTimeOnBlur(current))}
                        />
                        <button className="btn ghost" type="submit" disabled={!isValidWorkoutTime(customWorkoutTime)}>Definir</button>
                      </div>
                    </form>
                  </div>
                </fieldset>
              </article>

              <article className="health-profile-card health-food-card">
                <h2>Alimentação</h2>
                {FOOD_LISTS.map(({ key, label, empty }) => (
                  <section className="health-food-group" key={key} aria-label={label}>
                    <div className="health-food-heading">
                      <h3>{label}</h3>
                      <button
                        type="button"
                        className="health-add-food"
                        aria-label={`Editar ${label.toLocaleLowerCase('pt-BR')}`}
                        onClick={() => { setEditingFoodList(key); setNewFood(''); }}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" /></svg>
                      </button>
                    </div>
                    <div className="health-food-chips">
                      {profile[key].length
                        ? profile[key].slice(0, 5).map((food) => <span className="health-food-chip" key={`${key}-${food}`}>{food}</span>)
                        : <span className="health-food-empty">{empty}</span>}
                    </div>
                  </section>
                ))}
              </article>
            </div>
            <div className="health-profile-bottom">
              <button className="btn ghost" type="button" disabled={busy || loading} onClick={async () => { setBusy(true); try { await persistProfile(); setMessage('Perfil salvo.'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o perfil.'); } finally { setBusy(false); } }}>Salvar Perfil</button>
              <button
                className={`btn health-generate-button${busy ? ' is-loading' : ''}`}
                type="button"
                disabled={busy || loading || !validProfileMeasurements || profile.disponibilidadeDias.length < requiredWorkoutDays || !profile.disponibilidadeTreino.length}
                onClick={saveAndGenerate}
              >
                {busy ? <><span className="health-spinner" /> Gerando...</> : 'Gerar Rotina e Dieta'}
              </button>
            </div>
            {editingFoodList && (
              <div className="health-food-modal-backdrop" onMouseDown={(event) => {
                if (event.target === event.currentTarget) setEditingFoodList(null);
              }}>
                <section className="health-food-modal" role="dialog" aria-modal="true" aria-labelledby="health-food-modal-title">
                  <div className="health-food-modal-heading">
                    <h2 id="health-food-modal-title">{FOOD_LISTS.find((item) => item.key === editingFoodList)?.label}</h2>
                    <button type="button" aria-label="Fechar" onClick={() => setEditingFoodList(null)}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" /></svg>
                    </button>
                  </div>
                  <form className="health-food-add-form" onSubmit={(event) => {
                    event.preventDefault();
                    changeFood(editingFoodList, 'add', newFood);
                    setNewFood('');
                  }}>
                    <input autoFocus aria-label="Novo alimento" value={newFood} onChange={(event) => setNewFood(event.target.value)} />
                    <button className="btn" type="submit" disabled={!newFood.trim()}>Adicionar</button>
                  </form>
                  <div className="health-food-modal-list">
                    {profile[editingFoodList].length ? profile[editingFoodList].map((food) => (
                      <span className="health-food-chip" key={food}>
                        {food}
                        <button type="button" aria-label={`Remover ${food}`} onClick={() => changeFood(editingFoodList, 'remove', food)}>
                          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none"><path d="m4 4 8 8M12 4l-8 8" /></svg>
                        </button>
                      </span>
                    )) : <span className="health-food-empty">{FOOD_LISTS.find((item) => item.key === editingFoodList)?.empty}</span>}
                  </div>
                </section>
              </div>
            )}
          </section>
        )}

        {tab === 'Academia & Água' && (
          isFocusMode ? (
            <section className="health-focus-view" role="tabpanel" aria-label="Modo foco do treino">
              <header className="health-focus-header">
                <div><span className="health-focus-eyebrow">MODO FOCO</span><h2>{focusMinutes !== null && focusMinutes > 0 && focusMinutes <= 15 ? `Faltam ${focusMinutes} minutos` : 'Treino Agendado'}</h2></div>
                <div className="health-focus-start"><p>{focusWorkout?.nomeTreino || 'Treino de hoje'}</p>{workoutSession?.status !== 'em_andamento' && focusWorkout && <button className="btn" type="button" onClick={() => { setWorkoutWeight(String(profile.peso || '')); setWorkoutStartOpen(true); }}>Iniciar Treino</button>}</div>
              </header>
              <div className="health-content-grid health-focus-grid">
                <article className="health-panel water-card health-water-card">
                  <div className="health-section-heading"><div><h2>Hidratação</h2><p>Meta: {(overview?.waterGoalMl || 0).toLocaleString('pt-BR')} ml</p></div></div>
                  <div className="health-water-ring-wrap">
                    <svg className="health-water-ring" viewBox="0 0 180 180" role="img" aria-label={`${(overview?.waterToday || 0).toLocaleString('pt-BR')} de ${(overview?.waterGoalMl || 0).toLocaleString('pt-BR')} ml consumidos`}>
                      <circle className="health-water-ring-track" cx="90" cy="90" r="76" />
                      <circle className="health-water-ring-progress" cx="90" cy="90" r="76" strokeDasharray={2 * Math.PI * 76} strokeDashoffset={2 * Math.PI * 76 * (1 - Math.min((overview?.waterToday || 0) / Math.max(overview?.waterGoalMl || 1, 1), 1))} />
                    </svg>
                    <div className="health-water-ring-label"><strong>{(overview?.waterToday || 0).toLocaleString('pt-BR')}</strong><span>de {(overview?.waterGoalMl || 0).toLocaleString('pt-BR')} ml</span></div>
                  </div>
                  <div className="health-actions"><button className="btn ghost" type="button" disabled={busy || (overview?.waterToday || 0) < 250} onClick={() => logWater(-250)}>- 250 ml</button><button className="btn ghost" type="button" disabled={busy} onClick={() => logWater(250)}>+ 250 ml</button><button className="btn" type="button" disabled={busy} onClick={() => logWater(500)}>+ 500 ml</button></div>
                </article>
                <article className="health-panel workout-panel health-focus-workout">
                  <div className="health-section-heading"><div><h2>{focusWorkout?.nomeTreino || 'Treino de hoje'}</h2><p>{focusWorkout?.diaSemana || 'Nenhum treino disponível'}</p></div></div>
                  {focusWorkout ? (
                    <>
                      <div className="health-exercise-list">
                        {focusWorkout.exercicios.map((exercise) => {
                          const values = exerciseLogs[exercise.nome] || { pesoAtual: '', repeticoes: exercise.repeticoes.match(/\d+/)?.[0] || '' };
                          const done = completedExercises.includes(exercise.nome);
                          return <div className={`health-exercise-row${done ? ' is-done' : ''}`} key={exercise.nome}>
                            <div className="health-exercise-title"><strong>{exercise.nome}</strong>
                              <button className="health-done-button" type="button" aria-label={`${done ? 'Desmarcar' : 'Marcar'} ${exercise.nome} como concluído`} aria-pressed={done} disabled={!done && (!values.pesoAtual || !values.repeticoes)} onClick={() => toggleCompleted(exercise.nome)}>
                                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">{done ? <path d="m5 12 4 4L19 6" /> : <circle cx="12" cy="12" r="8" />}</svg>
                              </button>
                            </div>
                            <div className="health-exercise-inputs">
                              <label>Peso Inicial (kg)<input aria-label={`Peso inicial de ${exercise.nome}`} type="number" value={exercise.pesoInicial || 0} readOnly /></label>
                              <label>Peso Atual (kg)<input aria-label={`Peso atual de ${exercise.nome}`} type="number" min="0" step="0.5" value={values.pesoAtual} onChange={(event) => updateExerciseLog(exercise.nome, 'pesoAtual', event.target.value)} /></label>
                              <label>Reps<input aria-label={`Repetições para ${exercise.nome}`} type="number" min="1" value={values.repeticoes} onChange={(event) => updateExerciseLog(exercise.nome, 'repeticoes', event.target.value)} /></label>
                            </div>
                          </div>;
                        })}
                      </div>
                      <button className="btn health-finish-workout" type="button" disabled={busy} onClick={finishWorkout}>Finalizar Treino</button>
                    </>
                  ) : <div className="health-no-workout"><p>Não há treino configurado para hoje.</p><button className="btn ghost" type="button" disabled={busy} onClick={finishWorkout}>Voltar ao gerenciamento</button></div>}
                </article>
              </div>
            </section>
          ) : (
            <section className="health-content-grid" role="tabpanel" aria-label="Gerenciamento semanal de academia e água">
              <article className="health-panel water-card health-water-card">
                <div className="health-section-heading"><div><h2>Hidratação</h2><p>Meta: {(overview?.waterGoalMl || 0).toLocaleString('pt-BR')} ml</p></div></div>
                <div className="health-water-ring-wrap">
                  <svg className="health-water-ring" viewBox="0 0 180 180" role="img" aria-label={`${(overview?.waterToday || 0).toLocaleString('pt-BR')} de ${(overview?.waterGoalMl || 0).toLocaleString('pt-BR')} ml consumidos`}>
                    <circle className="health-water-ring-track" cx="90" cy="90" r="76" />
                    <circle className="health-water-ring-progress" cx="90" cy="90" r="76" strokeDasharray={2 * Math.PI * 76} strokeDashoffset={2 * Math.PI * 76 * (1 - Math.min((overview?.waterToday || 0) / Math.max(overview?.waterGoalMl || 1, 1), 1))} />
                  </svg>
                  <div className="health-water-ring-label"><strong>{(overview?.waterToday || 0).toLocaleString('pt-BR')}</strong><span>de {(overview?.waterGoalMl || 0).toLocaleString('pt-BR')} ml</span></div>
                </div>
                <div className="health-actions"><button className="btn ghost" type="button" disabled={busy || (overview?.waterToday || 0) < 250} onClick={() => logWater(-250)}>- 250 ml</button><button className="btn ghost" type="button" disabled={busy} onClick={() => logWater(250)}>+ 250 ml</button><button className="btn" type="button" disabled={busy} onClick={() => logWater(500)}>+ 500 ml</button></div>
                <div className="health-push"><h3>Lembretes de hidratação</h3><p>Notificações entre 08h e 22h.</p><PushButton /></div>
              </article>
              <article className="health-panel health-management-panel">
                <div className="health-section-heading">
                  <div><h2>Grade Semanal</h2><p>Consulte e edite os treinos gerados.</p></div>
                  <button className="btn ghost" type="button" disabled={busy || !profile.disponibilidadeTreino.length} onClick={generateWorkout}>{busy ? 'Gerando...' : 'Gerar Treino'}</button>
                </div>
                {overview?.workouts.length ? (
                  <>
                    <div className="health-week-grid">
                      {DAYS.map(([day, label]) => {
                        const workout = overview.workouts.find((item) => item.diaSemana === day);
                        const time = profile.disponibilidadePorDia[day]?.[0];
                        return <button key={day} type="button" className={`health-week-day${selectedWorkoutDay === day ? ' is-selected' : ''}`} disabled={!workout} onClick={() => setSelectedWorkoutDay(day)}>
                          <span>{label}</span><strong>{workout?.nomeTreino || 'Descanso'}</strong><small>{workout ? time || 'Horário não definido' : '—'}</small>
                        </button>;
                      })}
                    </div>
                    {overview.workouts.filter((workout) => workout.diaSemana === selectedWorkoutDay).map((workout) => (
                      <section className="health-plan-editor" key={workout.diaSemana} aria-label={`Editar ${workout.diaSemana}`}>
                        <div className="health-section-heading">
                          <div><h3>{workout.nomeTreino}</h3><p>{workout.diaSemana === todayWorkout?.diaSemana ? 'Treino de hoje · informativo' : 'Ficha do dia selecionado'}</p></div><button className="icon-btn" type="button" aria-label={`Apagar treino de ${workout.diaSemana}`} onClick={() => void deleteWorkoutDay(workout.diaSemana)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" /></svg></button>
                          <button className="btn" type="button" disabled={busy || !planDirty} onClick={saveWorkoutPlan}>Salvar alterações</button>
                        </div>
                        {workout.diaSemana === todayWorkout?.diaSemana && <p className="health-today-notice">Este treino pode ser consultado aqui; o modo foco será ativado perto do horário agendado.</p>}
                        <div className="health-plan-exercises">
                          {workout.exercicios.map((exercise, index) => (
                            <div className="health-plan-exercise" key={`${workout.diaSemana}-${index}`}>
                              <label>Exercício<input value={exercise.nome} onChange={(event) => updateWorkoutPlan(workout.diaSemana, (current) => ({ ...current, exercicios: current.exercicios.map((item, itemIndex) => itemIndex === index ? { ...item, nome: event.target.value } : item) }))} /></label>
                              <label>Séries<input type="number" min="1" max="20" value={exercise.series} onChange={(event) => updateWorkoutPlan(workout.diaSemana, (current) => ({ ...current, exercicios: current.exercicios.map((item, itemIndex) => itemIndex === index ? { ...item, series: Number(event.target.value) } : item) }))} /></label>
                              <label>Reps<input value={exercise.repeticoes} onChange={(event) => updateWorkoutPlan(workout.diaSemana, (current) => ({ ...current, exercicios: current.exercicios.map((item, itemIndex) => itemIndex === index ? { ...item, repeticoes: event.target.value } : item) }))} /></label>
                              <div className="health-plan-actions">
                                <button className="health-swap-button" type="button" disabled={busy} onClick={() => suggestExerciseSwap(exercise)}>Trocar com IA</button>
                                <button className="health-remove-exercise" type="button" aria-label={`Remover ${exercise.nome}`} onClick={() => updateWorkoutPlan(workout.diaSemana, (current) => ({ ...current, exercicios: current.exercicios.filter((_, itemIndex) => itemIndex !== index) }))}>Remover</button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <form className="health-add-exercise" onSubmit={(event) => {
                          event.preventDefault();
                          const name = newExerciseName.trim();
                          if (!name) return;
                          updateWorkoutPlan(workout.diaSemana, (current) => ({
                            ...current,
                            exercicios: [...current.exercicios, { nome: name, series: 3, repeticoes: '8-12', descanso: '60s' }],
                          }));
                          setNewExerciseName('');
                        }}>
                          <input aria-label="Novo exercício" placeholder="Adicionar exercício" value={newExerciseName} onChange={(event) => setNewExerciseName(event.target.value)} />
                          <button className="btn ghost" type="submit" disabled={!newExerciseName.trim()}>Adicionar</button>
                        </form>
                      </section>
                    ))}
                  </>
                ) : <div className="health-no-workout"><p>A grade semanal será exibida após gerar um treino.</p><button className="btn" type="button" disabled={busy || !profile.disponibilidadeTreino.length} onClick={generateWorkout}>Gerar Treino</button></div>}
              </article>
            </section>
          )
        )}

        {swapExercise && (
          <div className="health-swap-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !swapBusy) setSwapExercise(null);
          }}>
            <section className="health-swap-modal" role="dialog" aria-modal="true" aria-labelledby="health-swap-title">
              <div className="health-section-heading">
                <div><h2 id="health-swap-title">Trocar {swapExercise.nome}</h2><p>Sugestões de exercícios equivalentes.</p></div>
                <button className="health-swap-close" type="button" aria-label="Fechar" disabled={swapBusy} onClick={() => setSwapExercise(null)}>Fechar</button>
              </div>
              {swapBusy ? <p className="health-empty">Buscando sugestões...</p> : (
                <div className="health-swap-options">
                  {swapSuggestions.map((suggestion) => (
                    <button key={suggestion} className="btn ghost" type="button" disabled={busy} onClick={() => applyExerciseSwap(suggestion)}>{suggestion}</button>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'Nutrição' && (
          <section className="health-panel health-nutrition-panel" role="tabpanel" aria-label="Nutrição">
            <div className="health-section-heading"><div><h2>Plano alimentar</h2><p>{overview?.diet?.objetivo ? `Foco: ${overview.diet.objetivo}` : 'Refeições sugeridas pela IA.'}</p></div><button className="btn" type="button" disabled={busy || !profile.peso} onClick={generateDiet}>{busy ? 'Gerando...' : 'Gerar Nova Dieta'}</button></div>
            {overview?.diet?.refeicoes?.length ? <>
              {(() => {
                const c = mealLogs?.consumed || { calorias: 0, proteina: 0, carbo: 0, gordura: 0 };
                const g = mealLogs?.goal || { calorias: calorieTarget, proteina: 0, carbo: 0, gordura: 0 };
                return (
                  <div className="nutrition-summary">
                    <div className="nutrition-summary-head">
                      <span>Macronutrientes</span>
                      <strong>Consumido: {Math.round(c.calorias)} / {Math.round(calorieTarget)} kcal</strong>
                    </div>
                    <div className="nutrition-macros">
                      <MacroBar label="Proteína" value={c.proteina} goal={g.proteina} unit="g" className="macro-protein" />
                      <MacroBar label="Carbo" value={c.carbo} goal={g.carbo} unit="g" className="macro-carbs" />
                      <MacroBar label="Gordura" value={c.gordura} goal={g.gordura} unit="g" className="macro-fat" />
                    </div>
                  </div>
                );
              })()}
              <div className="meal-list">
                {overview.diet.refeicoes.map((meal) => {
                  const done = mealLogs?.completed?.some((item) => item.tipoRefeicao === meal.nome) || false;
                  const open = expandedMeals.includes(meal.nome);
                  return (
                    <article className={`meal-row${done ? ' is-done' : ''}`} key={meal.nome}>
                      <div className="meal-row-main">
                        <span className="meal-icon"><MealIcon name={meal.nome} /></span>
                        <div className="meal-info">
                          <h3>{meal.nome}</h3>
                          <p>{meal.horario ? `${meal.horario} · ` : ''}P: {meal.macros?.proteina ?? 0}g, C: {meal.macros?.carboidratos ?? 0}g, G: {meal.macros?.gordura ?? 0}g</p>
                        </div>
                        <strong className="meal-kcal">{meal.calorias} kcal</strong>
                        <button
                          className={`meal-check${done ? ' is-done' : ''}`}
                          type="button"
                          disabled={loggingMeal === meal.nome}
                          aria-label={done ? `Desmarcar ${meal.nome}` : `Concluir ${meal.nome}`}
                          title={done ? 'Desmarcar' : 'Concluir'}
                          onClick={() => done ? uncompleteMeal(meal) : completeMeal(meal)}
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d={done ? 'M7 7l10 10M17 7 7 17' : 'm5 12.5 4.5 4.5L19 7.5'} /></svg>
                        </button>
                        <button
                          className={`meal-expand${open ? ' is-open' : ''}`}
                          type="button"
                          aria-expanded={open}
                          aria-label={`Ingredientes de ${meal.nome}`}
                          onClick={() => toggleMealExpanded(meal.nome)}
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m7 10 5 5 5-5" /></svg>
                        </button>
                      </div>
                      {open && <ul className="meal-ingredients">{(meal.alimentos || []).map((food, index) => <li key={`${food}-${index}`}>{food}</li>)}</ul>}
                    </article>
                  );
                })}
              </div>
            </> : <p className="health-empty">Gere sua primeira dieta para visualizar as refeições.</p>}
          </section>
        )}

        {tab === 'Dashboard' && (
          <section className="health-panel health-dashboard-panel" role="tabpanel" aria-label="Dashboard">
            <div className="health-metric-cards">
              {series.map((item) => {
                const last = item.points[item.points.length - 1];
                const value = item.key === 'agua'
                  ? `${((overview?.waterToday || 0) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`
                  : item.key === 'peso'
                    ? `${(last?.valor || profile.peso).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`
                    : `${weeklyWorkoutCount}/${weeklyWorkoutGoal}`;
                const label = item.key === 'peso' ? 'Peso atual' : item.key === 'agua' ? 'Água hoje' : 'Treinos';
                return <article className={`health-metric-card${loading ? ' is-loading' : ''}`} key={item.key} style={{ '--series-color': item.color } as CSSProperties}>
                  <span>{label}</span><strong>{loading ? '' : value}</strong>
                </article>;
              })}
              <article className={`health-metric-card${loading ? ' is-loading' : ''}`} style={{ '--series-color': '#86d7c0' } as CSSProperties}>
                <span>Meta semanal</span>
                <strong>{loading ? '' : `${(weeklyWaterMl / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/${(weeklyWaterGoalMl / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`}</strong>
              </article>
            </div>
            <MultiLineChart series={series} focus={focusMetric} />
            <div className="health-chart-legend">
              {series.map((item) => {
                const active = focusMetric === item.key;
                const last = item.points[item.points.length - 1];
                return <button key={item.key} className={`health-legend-toggle${active ? ' is-focused' : ''}`} type="button" aria-pressed={active} onClick={() => setFocusMetric((current) => current === item.key ? null : item.key)} style={{ '--series-color': item.color } as CSSProperties}>
                  <span className="health-legend-dot" /><span>{item.label}</span>{last && <strong>{last.valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} {item.unit}</strong>}
                </button>;
              })}
            </div>
          </section>
        )}
      </div>
      {previewData && createPortal(
        <div
          className="review-overlay review-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSaving) setPreviewData(null);
          }}
        >
          <div className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <header className="review-header">
              <div>
                <p className="calendar-eyebrow">REVISÃO</p>
                <h2 id="review-title">Sua Rotina Sugerida pela IA</h2>
                <p className="review-sub">Ajuste os horários antes de salvar. Nada é gravado até você confirmar.</p>
              </div>
              <button className="review-close" type="button" aria-label="Fechar sem salvar" disabled={isSaving} onClick={() => setPreviewData(null)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </header>
            <div className="review-body">
              {error && <p className="health-message is-error" role="alert">{error}</p>}
              {previewData.dieta && (
                <section className="review-section" aria-label="Dieta">
                  <h3>Dieta</h3>
                  <div className="review-calorie-target">
                    <div className="calorie-target-heading">
                      <div>
                        <span>Meta diária do plano</span>
                        <strong>{(previewData.metaCalorias || overview?.caloriasRecomendadas || 2000).toLocaleString('pt-BR')} kcal</strong>
                      </div>
                      <small>Recomendado: {(overview?.caloriasRecomendadas || profile.caloriasRecomendadas || 2000).toLocaleString('pt-BR')} kcal</small>
                    </div>
                    <input
                      className="calorie-slider"
                      type="range"
                      min="1000"
                      max="5000"
                      step="50"
                      value={previewData.metaCalorias || overview?.caloriasRecomendadas || 2000}
                      aria-label="Meta diária de calorias do novo plano"
                      aria-valuetext={`${previewData.metaCalorias || overview?.caloriasRecomendadas || 2000} quilocalorias`}
                      style={{ '--calorie-progress': `${(((previewData.metaCalorias || overview?.caloriasRecomendadas || 2000) - 1000) / 4000) * 100}%` } as CSSProperties}
                      onChange={(event) => setPreviewData((current) => current ? { ...current, metaCalorias: Number(event.target.value) } : current)}
                    />
                    <div className="review-calorie-scale"><span>1.000 kcal</span><span>5.000 kcal</span></div>
                  </div>
                  <div className="review-list">
                    {previewData.dieta.map((meal, index) => (
                      <article className="review-row" key={`${meal.nome}-${index}`}>
                        <span className="meal-icon"><MealIcon name={meal.nome} /></span>
                        <div className="review-row-info">
                          <div className="review-row-top">
                            <input className="review-name-input" value={meal.nome} aria-label="Nome da refeição" onChange={(event) => updateReviewMealName(index, event.target.value)} />
                            <TimeInput24 value={meal.horario} label={`Horário de ${meal.nome}`} onChange={(value) => updateReviewMeal(index, value)} />
                            <button className="icon-btn" type="button" aria-label={`Excluir ${meal.nome}`} onClick={() => removeReviewMeal(index)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /></svg></button>
                          </div>
                          <ul>{(meal.alimentos || []).map((food, i) => <li key={i}><input value={food} aria-label={`Alimento ${i + 1} de ${meal.nome}`} onChange={(event) => updateReviewFood(index, i, event.target.value)} /></li>)}</ul>
                          <p className="review-macros">{meal.calorias} kcal · P {meal.macros?.proteina ?? 0}g · C {meal.macros?.carboidratos ?? 0}g · G {meal.macros?.gordura ?? 0}g</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              {previewData.treino && (
                <section className="review-section" aria-label="Treino">
                  <h3>Treino</h3>
                  {previewData.historicoTreino && (
                    <div className="workout-history-card">
                      <strong>Treino baseado no seu histórico</strong>
                      <p>{previewData.historicoTreino}</p>
                    </div>
                  )}
                  <div className="review-list">
                    {previewData.treino.map((item, index) => (
                      <article className="review-row" key={item.diaSemana}>
                        <span className="meal-icon"><TabIcon tab="Academia & Água" /></span>
                        <div className="review-row-info">
                          <div className="review-row-top">
                            <h4>{item.diaSemana}</h4>
                            <TimeInput24 value={item.horario} label={`Horário do treino de ${item.diaSemana}`} onChange={(value) => updateReviewWorkout(index, value)} />
                          </div>
                          <p className="review-macros">{item.nomeTreino}</p>
                          <ul>{(item.exercicios || []).map((exercise, i) => <li key={`${exercise.nome}-${i}`}>{exercise.nome} · {exercise.series}x{exercise.repeticoes}</li>)}</ul>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </div>
            <footer className="review-footer">
              <button className="btn ghost" type="button" disabled={isSaving} onClick={redoReview}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" /></svg>
                {isSaving ? 'Aguarde...' : 'Cancelar e Refazer'}
              </button>
              <button
                className="btn review-save"
                type="button"
                disabled={isSaving || Boolean(previewData.dieta?.some((meal) => !isValidWorkoutTime(meal.horario)) || previewData.treino?.some((item) => !isValidWorkoutTime(item.horario)))}
                onClick={confirmReview}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                {isSaving ? 'Salvando...' : 'Salvar Plano'}
              </button>
            </footer>
          </div>
        </div>,
        document.body
      )}
    </main>
  );
}
