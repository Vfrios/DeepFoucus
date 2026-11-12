import { useEffect, useMemo, useState } from 'react';
import { Task, Tipo, useTasks } from '../hooks/useTasks';
import { useCalendar } from '../hooks/useCalendar';
import { useGoogleCalendars } from '../hooks/useGoogleCalendars';
import { useDevice } from '../device/useDevice';
import { getCalendarTasks, getEventColor } from './calendarUtils';
import PageMonthCalendar from './PageMonthCalendar';
import PageWeekCalendar from './PageWeekCalendar';
import { api } from '../lib/api';
import { WATER_INTAKE_EVENT } from '../lib/water';

type CalendarMode = 'current' | 'week' | 'month';

// ---------- utilitários de data ----------

/**
 * Chave YYYY-MM-DD no fuso LOCAL do navegador.
 * Usamos componentes da data (não toISOString) para evitar o bug de item
 * da meia-noite cair no dia anterior em UTC-3.
 */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const hhmm = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : '--:--';

/** "14:00 – 15:00" ou "Sem horário" se inicio for null. */
const faixa = (t: Task) => {
  if (t.allDay) return 'Dia inteiro';
  if (!t.inicio) return 'Sem horário';
  const ini = hhmm(t.inicio);
  const fim = t.fim ? hhmm(t.fim) : null;
  return fim ? `${ini} – ${fim}` : ini;
};

const LABEL_TIPO: Record<Tipo, string> = {
  evento: 'Evento',
  estudo: 'Estudo',
  tarefa: 'Tarefa',
};

// ---------- componente ----------

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clock">
      <div className="clock-time">{hhmm(now.toISOString())}</div>
      <div className="clock-date">
        {now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
    </div>
  );
}

/** Um bloco "Hoje" ou "Amanhã" com a lista de itens do dia. */
function DayBlock({
  titulo,
  subtitulo,
  itens,
  destaque,
}: {
  titulo: string;
  subtitulo: string;
  itens: Task[];
  destaque: boolean;
}) {
  const allDayItems = itens.filter((task) => task.allDay);
  const positionedItems = itens.flatMap((task) => {
    if (!task.inicio || task.allDay) return [];
    const start = new Date(task.inicio);
    if (Number.isNaN(start.getTime())) return [];
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const parsedEnd = task.fim ? new Date(task.fim) : null;
    const endMinutes = parsedEnd && !Number.isNaN(parsedEnd.getTime()) &&
      dayKey(parsedEnd) === dayKey(start)
      ? parsedEnd.getHours() * 60 + parsedEnd.getMinutes()
      : parsedEnd && !Number.isNaN(parsedEnd.getTime()) && parsedEnd > start
        ? 24 * 60
        : startMinutes + 30;
    return [{
      task,
      top: Math.min(startMinutes / 2, 686),
      height: Math.max(34, Math.min((endMinutes - startMinutes) / 2, 720 - startMinutes / 2)),
    }];
  });

  return (
    <section className={`cal-day${destaque ? ' today' : ''}`}>
      <header className="cal-day-head">
        <h2>{titulo}</h2>
        <span className="cal-day-sub">{subtitulo}</span>
      </header>

      {itens.length === 0 && (
        <p className="cal-empty">
          {destaque ? 'Nada marcado para hoje.' : 'Nada marcado para amanhã.'}
        </p>
      )}
      <div className={`cal-allday-slot${allDayItems.length ? ' has-events' : ''}`} aria-label="Eventos de dia inteiro">
        <span className="cal-allday-label">Dia inteiro</span>
        <div className="cal-allday-events">
          {allDayItems.map((task) => (
            <article
              key={task._id}
              className={`cal-allday-event${task.feito ? ' done' : ''}`}
              title={task.titulo}
              style={{ borderLeftColor: getEventColor(task) }}
            >
              <strong>{task.titulo}</strong>
              <span>{LABEL_TIPO[task.tipo]}</span>
            </article>
          ))}
        </div>
      </div>
      <div className="cal-timeline" role="list" aria-label={`Agenda ${titulo.toLowerCase()}`}>
        <div className="cal-timeline-canvas">
          {Array.from({ length: 24 }, (_, hour) => (
            <span className="cal-hour-label" key={hour} style={{ top: `${hour * 30}px` }}>
              {String(hour).padStart(2, '0')}:00
            </span>
          ))}
          {positionedItems.map(({ task, top, height }) => (
            <article
              key={task._id}
              className={`cal-timeline-event${task.feito ? ' done' : ''}`}
              role="listitem"
              aria-label={`${faixa(task)} — ${task.titulo}`}
              style={{ top: `${top}px`, height: `${height}px`, borderLeftColor: getEventColor(task) }}
            >
              <span className="cal-timeline-event-time">{faixa(task)}</span>
              <strong>{task.titulo}</strong>
              <span className="cal-timeline-event-type">{LABEL_TIPO[task.tipo]}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function PageCalendar() {
  const [mode, setMode] = useState<CalendarMode>('current');

  return (
    <div className={`calendar-subviews calendar-subviews-${mode}`}>
      <nav className="calendar-mode-switch" role="tablist" aria-label="Visualização do calendário">
        {([
          ['current', 'Atual'],
          ['week', 'Semanal'],
          ['month', 'Mensal'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="calendar-mode-content" key={mode}>
        {mode === 'week' ? (
          <PageWeekCalendar onBack={() => setMode('current')} />
        ) : mode === 'month' ? (
          <PageMonthCalendar onBack={() => setMode('current')} />
        ) : (
          <CurrentCalendarView />
        )}
      </div>
    </div>
  );
}

function CurrentCalendarView() {
  const { view } = useDevice();
  const { tasks, error, generateFromIA } = useTasks();
  const { calendars, selectedIds } = useGoogleCalendars();
  const [water, setWater] = useState({ intake: 0, goal: 0 });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await api<{ waterToday: number; waterGoalMl: number }>('/health/water');
        if (active) setWater({ intake: data.waterToday, goal: data.waterGoalMl });
      } catch (cause) {
        console.error('Não foi possível carregar o resumo de hidratação.', cause);
      }
    };
    const refreshOnWaterUpdate = () => { void refresh(); };
    void refresh();
    window.addEventListener(WATER_INTAKE_EVENT, refreshOnWaterUpdate);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.removeEventListener(WATER_INTAKE_EVENT, refreshOnWaterUpdate);
      window.clearInterval(timer);
    };
  }, []);
  const [rangeStart] = useState(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  });
  const { events: googleEvents, error: calendarError } = useCalendar(rangeStart, 2);
  const visibleTasks = useMemo(
    () => getCalendarTasks(tasks, googleEvents, calendars)
      .filter((task) => selectedIds.includes(task.calendarId || 'primary')),
    [tasks, googleEvents, calendars, selectedIds]
  );

  // ---- input da IA inline ----
  const [prompt, setPrompt] = useState('');
  const [gerando, setGerando] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: 'ok' | 'err'; msg: string } | null>(null);

  const enviar = async () => {
    const texto = prompt.trim();
    if (!texto || gerando) return;
    setGerando(true);
    setFeedback(null);
    try {
      const { inseridas } = await generateFromIA(texto);
      setPrompt('');
      setFeedback({
        tipo: 'ok',
        msg:
          inseridas === 0
            ? 'A IA não encontrou nada agendável nesse texto.'
            : `${inseridas} item(ns) adicionado(s).`,
      });
    } catch (e: any) {
      setFeedback({
        tipo: 'err',
        msg: 'Falha ao gerar: ' + (e?.message || 'erro desconhecido'),
      });
    } finally {
      setGerando(false);
    }
  };

  // ---- filtragem Hoje / Amanhã ----
  const { hoje, amanha, hojeLabel, amanhaLabel } = useMemo(() => {
    const agora = new Date();
    const dHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const dAmanha = new Date(dHoje);
    dAmanha.setDate(dHoje.getDate() + 1);
    const kHoje = dayKey(dHoje);
    const kAmanha = dayKey(dAmanha);

    const doDia = (k: string) =>
      visibleTasks
        .filter((t) => t.inicio && dayKey(new Date(t.inicio)) === k)
        .sort((a, b) => {
          const ta = a.inicio ? new Date(a.inicio).getTime() : 0;
          const tb = b.inicio ? new Date(b.inicio).getTime() : 0;
          return ta - tb;
        });

    const labelDia = (d: Date) =>
      d.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      });

    return {
      hoje: doDia(kHoje),
      amanha: doDia(kAmanha),
      hojeLabel: labelDia(dHoje),
      amanhaLabel: labelDia(dAmanha),
    };
  }, [visibleTasks]);

  const vazio = hoje.length === 0 && amanha.length === 0;

  return (
    <div className={`page cal-focus${view === 'web' ? ' cal-focus-web' : ''}`}>
      <header className="cal-current-toolbar">
        <div className="cal-current-status">
          {view === 'web' && <Clock />}
          <div className="cal-water-status" aria-label={`${water.intake} de ${water.goal} ml de água hoje`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="M7 3h10l-1 17H8L7 3Z" />
              <path d="M8 13h8" />
            </svg>
            <span>{(water.intake / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} / {(water.goal / 1000).toLocaleString('pt-BR')} L</span>
          </div>
        </div>
      </header>

      {/* ---- IA inline ---- */}
      <form
        className="ai-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='Ex.: "Reunião amanhã às 14h com a equipe"'
          disabled={gerando}
          maxLength={500}
          aria-label="Descreva o item para a IA"
        />
        <button className="btn calendar-create-button" type="submit" disabled={gerando || !prompt.trim()}>
          {!gerando && (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
          {gerando ? 'Gerando…' : 'Criar'}
        </button>
      </form>
      {feedback && (
        <p className={`ai-feedback ${feedback.tipo}`} role="status">
          {feedback.msg}
        </p>
      )}
      {error && <p className="notice">{error}</p>}
      {calendarError && <p className="notice">Não foi possível carregar eventos do Google Calendar.</p>}

      {/* ---- Blocos Hoje / Amanhã ---- */}
      <div className="cal-focus-grid">
        <DayBlock
          titulo="Hoje"
          subtitulo={hojeLabel}
          itens={hoje}
          destaque
        />
        <DayBlock
          titulo="Amanhã"
          subtitulo={amanhaLabel}
          itens={amanha}
          destaque={false}
        />
      </div>

      {/* ---- Card vazio ---- */}
      {vazio && !gerando && (
        <div className="cal-empty-card">
          <strong>Seu dia está livre.</strong>
          <p>
            Use o campo acima para criar algo em linguagem natural, ou abra a aba{' '}
            <em>Tarefas</em> para o CRUD completo.
          </p>
        </div>
      )}
    </div>
  );
}
