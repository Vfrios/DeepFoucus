import { useEffect, useMemo, useState } from 'react';
import { Task, Tipo, useTasks } from '../hooks/useTasks';
import { useCalendar } from '../hooks/useCalendar';
import { useGoogleCalendars } from '../hooks/useGoogleCalendars';
import { useDevice } from '../device/useDevice';
import { getCalendarTasks, getEventColor } from './calendarUtils';

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
    ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
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
  return (
    <section className={`cal-day${destaque ? ' today' : ''}`}>
      <header className="cal-day-head">
        <h2>{titulo}</h2>
        <span className="cal-day-sub">{subtitulo}</span>
      </header>

      {itens.length === 0 ? (
        <p className="cal-empty">
          {destaque ? 'Nada marcado para hoje.' : 'Nada marcado para amanhã.'}
        </p>
      ) : (
        <ul className="cal-list">
          {itens.map((t) => (
            <li key={t._id} className={`cal-item${t.feito ? ' done' : ''}`}>
              <span
                className="type-bar"
                style={{ background: getEventColor(t) }}
                aria-hidden
              />
              <div className="cal-item-body">
                <div className="cal-item-top">
                  <span className="cal-item-time">{faixa(t)}</span>
                  <span
                    className="type-tag"
                    style={{
                      color: getEventColor(t),
                      borderColor: getEventColor(t),
                    }}
                  >
                    {LABEL_TIPO[t.tipo]}
                  </span>
                </div>
                <strong className="cal-item-title">{t.titulo}</strong>
                {t.descricao && <p className="cal-item-desc">{t.descricao}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PageCalendar() {
  const { view } = useDevice();
  const { tasks, error, generateFromIA } = useTasks();
  const { calendars, selectedIds } = useGoogleCalendars();
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
      {view === 'web' && <Clock />}

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
        <button className="btn" type="submit" disabled={gerando || !prompt.trim()}>
          {gerando ? 'Gerando…' : '✨ Criar'}
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
