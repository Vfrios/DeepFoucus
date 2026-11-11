import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
};
type Exercise = { nome: string; series: number; repeticoes: string; descanso: string };
type Workout = { diaSemana: string; nomeTreino: string; exercicios: Exercise[] };
type Meal = {
  nome: string;
  alimentos: string[];
  calorias: number;
  macros: { proteina: number; carboidratos: number; gordura: number };
};
type Point = { data: string; valor: number };
type Overview = {
  profile: Partial<HealthProfile> & { preferenciasComida?: string[]; pesoHistorico?: Array<{ data: string; peso: number }> };
  workouts: Workout[];
  todayWorkout: Workout | null;
  diet: { refeicoes: Meal[]; objetivo?: string } | null;
  waterToday: number;
  waterGoalMl: number;
  waterHistory: Point[];
  weightHistory: Point[];
  workoutHistory: Point[];
};
type Tab = 'Perfil' | 'Academia & Água' | 'Nutrição' | 'Dashboard';
type MetricKey = 'peso' | 'agua' | 'treino';
type MetricSeries = { key: MetricKey; label: string; color: string; points: Point[]; unit: string };

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
const isValidWorkoutTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

function formattedDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
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
  const [editingFoodList, setEditingFoodList] = useState<FoodListKey | null>(null);
  const [newFood, setNewFood] = useState('');
  const [customWorkoutTime, setCustomWorkoutTime] = useState('');
  const [activeScheduleDay, setActiveScheduleDay] = useState<string>(DAYS[0][0]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [focusMetric, setFocusMetric] = useState<MetricKey | null>(null);
  const [completedExercises, setCompletedExercises] = useState<string[]>([]);
  const [recentlyCompleted, setRecentlyCompleted] = useState<string[]>([]);
  const [exerciseLogs, setExerciseLogs] = useState<Record<string, { carga: string; repeticoes: string }>>({});
  const completionTimers = useRef<Map<string, number>>(new Map());

  useEffect(() => () => {
    completionTimers.current.forEach((timer) => window.clearTimeout(timer));
    completionTimers.current.clear();
  }, []);

  const applyOverview = (data: Overview) => {
    setOverview(data);
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
    return () => { active = false; };
  }, []);

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
  const generateDiet = async () => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await persistProfile();
      const diet = await api<Overview['diet']>('/health/generate-diet', {
        method: 'POST',
        body: JSON.stringify({
          preferencias: profile.alimentosPreferidos,
          restricoes: [...profile.alimentosQueNaoGosta, ...profile.restricoes],
        }),
      });
      if (overview) setOverview({ ...overview, diet });
      setMessage('Plano alimentar gerado.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar a dieta.');
    } finally {
      setBusy(false);
    }
  };
  const generateWorkout = async () => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const savedProfile = await persistProfile();
      const result = await api<{ calendar: { connected: boolean; created: number; failed: number } }>('/health/generate-workout', {
        method: 'POST',
        body: JSON.stringify({ treinoBase: savedProfile.treinoBase }),
      });
      await loadOverview();
      setMessage(result.calendar.connected
        ? `Treino gerado. ${result.calendar.created} sessão(ões) agendada(s) no calendário.`
        : 'Treino gerado. Conecte o Google Calendar para agendar as sessões.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o treino.');
    } finally {
      setBusy(false);
    }
  };
  const saveAndGenerate = async () => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const saved = await persistProfile();
      const [dietResult, workoutResult] = await Promise.all([
        api<Overview['diet']>('/health/generate-diet', {
          method: 'POST',
          body: JSON.stringify({ preferencias: saved.alimentosPreferidos, restricoes: [...saved.alimentosQueNaoGosta, ...saved.restricoes] }),
        }),
        api<{ calendar: { connected: boolean; created: number } }>('/health/generate-workout', {
          method: 'POST',
          body: JSON.stringify({ treinoBase: saved.treinoBase }),
        }),
      ]);
      await loadOverview();
      setTab('Academia & Água');
      setMessage(workoutResult.calendar.connected
        ? `Rotina gerada com dieta e ${workoutResult.calendar.created} sessão(ões) agendada(s).`
        : 'Rotina gerada. Conecte o Google Calendar para agendar os treinos.');
      if (!dietResult) setMessage('Treino gerado. Gere o plano alimentar novamente na aba Nutrição.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gerar a rotina.');
      try { await loadOverview(); } catch { /* Mantém o erro principal visível. */ }
    } finally {
      setBusy(false);
    }
  };
  const logWater = async (ml: 250 | 500) => {
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
  const saveWorkout = async () => {
    if (!overview?.todayWorkout || !completedExercises.length) return;
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const logs = completedExercises.map((name) => {
        const exercise = overview.todayWorkout!.exercicios.find((item) => item.nome === name)!;
        const values = exerciseLogs[name] || {
          carga: '',
          repeticoes: exercise.repeticoes.match(/\d+/)?.[0] || '',
        };
        return {
          exercicio: name,
          carga: Number(values.carga),
          series: exercise.series,
          repeticoes: Number(values.repeticoes),
        };
      });
      await api('/health/workout-logs', { method: 'POST', body: JSON.stringify({ logs }) });
      await loadOverview();
      setMessage('Exercícios concluídos registrados.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o treino.');
    } finally {
      setBusy(false);
    }
  };
  const toggleCompleted = (name: string) => {
    if (completedExercises.includes(name)) {
      const timer = completionTimers.current.get(name);
      if (timer !== undefined) window.clearTimeout(timer);
      completionTimers.current.delete(name);
      setRecentlyCompleted((items) => items.filter((item) => item !== name));
      setCompletedExercises((items) => items.filter((item) => item !== name));
      return;
    }

    setCompletedExercises((items) => [...items, name]);
    setRecentlyCompleted((items) => [...items, name]);
    const timer = window.setTimeout(() => {
      setRecentlyCompleted((items) => items.filter((item) => item !== name));
      completionTimers.current.delete(name);
    }, 2000);
    completionTimers.current.set(name, timer);
  };
  const updateExerciseLog = (name: string, key: 'carga' | 'repeticoes', value: string) => {
    setExerciseLogs((current) => ({
      ...current,
      [name]: { carga: current[name]?.carga ?? '', repeticoes: current[name]?.repeticoes ?? '', [key]: value },
    }));
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
  const requiredWorkoutDays = WORKOUT_SPLITS.find((split) => split.value === profile.treinoBase)?.sessions || 1;
  const validProfileMeasurements =
    profile.peso >= 20 && profile.peso <= 400 &&
    profile.altura >= 80 && profile.altura <= 250 &&
    profile.idade >= 13 && profile.idade <= 120 &&
    profile.metaPeso >= 20 && profile.metaPeso <= 400 &&
    profile.duracaoTreino >= 15 && profile.duracaoTreino <= 240;

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

      <div className="health-tab-body">
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
                      if (!isValidWorkoutTime(customWorkoutTime)) return;
                      updateWorkoutTime(activeScheduleDay, [customWorkoutTime]);
                    }}>
                      <label htmlFor="health-custom-workout-time">Outro horário</label>
                      <div>
                        <input
                          id="health-custom-workout-time"
                          type="text"
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="17:10"
                          value={customWorkoutTime}
                          onChange={(event) => {
                            const digits = event.target.value.replace(/\D/g, '').slice(0, 4);
                            setCustomWorkoutTime(digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits);
                          }}
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
          <section className="health-content-grid" role="tabpanel" aria-label="Academia e água">
            <article className="health-panel water-card">
              <div className="health-section-heading"><div><h2>Hidratação</h2><p>Meta de hoje: {(overview?.waterGoalMl || 0).toLocaleString('pt-BR')} ml</p></div></div>
              <div className="health-water-ring-wrap">
                <svg className="health-water-ring" viewBox="0 0 180 180" role="img" aria-label={`${(overview?.waterToday || 0).toLocaleString('pt-BR')} de ${(overview?.waterGoalMl || 0).toLocaleString('pt-BR')} ml consumidos`}>
                  <circle className="health-water-ring-track" cx="90" cy="90" r="76" />
                  <circle className="health-water-ring-progress" cx="90" cy="90" r="76" strokeDasharray={2 * Math.PI * 76} strokeDashoffset={2 * Math.PI * 76 * (1 - Math.min((overview?.waterToday || 0) / Math.max(overview?.waterGoalMl || 1, 1), 1))} />
                </svg>
                <div className="health-water-ring-label"><strong>{(overview?.waterToday || 0).toLocaleString('pt-BR')}</strong><span>de {(overview?.waterGoalMl || 0).toLocaleString('pt-BR')} ml</span></div>
              </div>
              <div className="health-actions"><button className="btn ghost" type="button" disabled={busy} onClick={() => logWater(250)}>+ 250 ml</button><button className="btn" type="button" disabled={busy} onClick={() => logWater(500)}>+ 500 ml</button></div>
              <div className="health-push"><h3>Lembretes de hidratação</h3><p>Notificações entre 08h e 22h.</p><PushButton /></div>
            </article>
            <article className="health-panel workout-panel">
              <div className="health-section-heading"><div><h2>{overview?.todayWorkout?.nomeTreino || 'Treino de hoje'}</h2><p>{overview?.todayWorkout?.diaSemana || 'Nenhuma sessão para hoje'}</p></div></div>
              {overview?.todayWorkout ? <>
                <div className="health-exercise-list">
                  {overview.todayWorkout.exercicios.map((exercise) => {
                    const values = exerciseLogs[exercise.nome] || { carga: '', repeticoes: exercise.repeticoes.match(/\d+/)?.[0] || '' };
                    const done = completedExercises.includes(exercise.nome);
                    return <div className={`health-exercise-row${done ? ' is-done' : ''}${recentlyCompleted.includes(exercise.nome) ? ' is-celebrating' : ''}`} key={exercise.nome}>
                      <strong>{exercise.nome}</strong>
                      <label><span>kg</span><input aria-label={`Carga para ${exercise.nome}`} type="number" min="0" step="0.5" value={values.carga} onChange={(event) => updateExerciseLog(exercise.nome, 'carga', event.target.value)} /></label>
                      <label><span>reps</span><input aria-label={`Repetições para ${exercise.nome}`} type="number" min="1" value={values.repeticoes} onChange={(event) => updateExerciseLog(exercise.nome, 'repeticoes', event.target.value)} /></label>
                      <button className="health-done-button" type="button" aria-label={`${done ? 'Desmarcar' : 'Marcar'} ${exercise.nome} como concluído`} aria-pressed={done} disabled={!done && (!values.carga || !values.repeticoes)} onClick={() => toggleCompleted(exercise.nome)}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">{done ? <path d="m5 12 4 4L19 6" /> : <circle cx="12" cy="12" r="8" />}</svg>
                      </button>
                    </div>;
                  })}
                </div>
                <button className="btn" type="button" disabled={busy || !completedExercises.length} onClick={saveWorkout}>Salvar concluídos ({completedExercises.length})</button>
              </> : <div className="health-no-workout"><p>Não há treino para hoje.</p><button className="btn ghost" type="button" disabled={busy || !profile.disponibilidadeTreino.length} onClick={generateWorkout}>{busy ? 'Gerando...' : 'Gerar Treino'}</button></div>}
            </article>
          </section>
        )}

        {tab === 'Nutrição' && (
          <section className="health-panel" role="tabpanel" aria-label="Nutrição">
            <div className="health-section-heading"><div><h2>Plano alimentar</h2><p>{overview?.diet?.objetivo ? `Foco: ${overview.diet.objetivo}` : 'Refeições sugeridas pela IA.'}</p></div><button className="btn" type="button" disabled={busy || !profile.peso} onClick={generateDiet}>{busy ? 'Gerando...' : 'Gerar Nova Dieta'}</button></div>
            {overview?.diet?.refeicoes?.length ? <div className="health-meal-grid">
              {overview.diet.refeicoes.map((meal) => {
                const protein = meal.macros.proteina * 4;
                const carbs = meal.macros.carboidratos * 4;
                const fat = meal.macros.gordura * 9;
                const total = protein + carbs + fat || 1;
                return <article className="health-meal" key={meal.nome}>
                  <div className="health-meal-heading"><h3>{meal.nome}</h3><span>{meal.calorias} kcal</span></div>
                  <ul>{meal.alimentos.map((food, index) => <li key={`${food}-${index}`}>{food}</li>)}</ul>
                  <div className="health-macro-bar" role="img" aria-label={`Proteína ${Math.round(protein / total * 100)}%, carboidrato ${Math.round(carbs / total * 100)}%, gordura ${Math.round(fat / total * 100)}%`}>
                    <span className="health-macro-protein" style={{ width: `${protein / total * 100}%` }} />
                    <span className="health-macro-carbs" style={{ width: `${carbs / total * 100}%` }} />
                    <span className="health-macro-fat" style={{ width: `${fat / total * 100}%` }} />
                  </div>
                  <p className="health-macros">P {meal.macros.proteina} g · C {meal.macros.carboidratos} g · G {meal.macros.gordura} g</p>
                </article>;
              })}
            </div> : <p className="health-empty">Gere sua primeira dieta para visualizar as refeições.</p>}
          </section>
        )}

        {tab === 'Dashboard' && (
          <section className="health-panel health-dashboard-panel" role="tabpanel" aria-label="Dashboard">
            <div className="health-section-heading"><div><h2>Progresso</h2><p>Tendência das métricas registradas.</p></div></div>
            <div className="health-metric-cards">
              {series.map((item) => {
                const last = item.points[item.points.length - 1];
                const value = item.key === 'agua'
                  ? `${((overview?.waterToday || 0) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`
                  : item.key === 'peso'
                    ? `${(last?.valor || profile.peso).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`
                    : `${overview?.workouts.length || 0}x/semana`;
                const label = item.key === 'peso' ? 'Peso atual' : item.key === 'agua' ? 'Água hoje' : 'Treinos';
                return <article className={`health-metric-card${loading ? ' is-loading' : ''}`} key={item.key} style={{ '--series-color': item.color } as CSSProperties}>
                  <span>{label}</span><strong>{loading ? '' : value}</strong>
                </article>;
              })}
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
    </main>
  );
}
