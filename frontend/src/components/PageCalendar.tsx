import { useEffect, useState } from 'react';
import { CalEvent, useCalendar } from '../hooks/useCalendar';
import { useDevice } from '../device/useDevice';

// allDay vem como "YYYY-MM-DD" (interpretar como data local, não UTC)
const parse = (e: CalEvent) =>
  e.allDay ? new Date(+e.start.slice(0, 4), +e.start.slice(5, 7) - 1, +e.start.slice(8, 10)) : new Date(e.start);
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clock">
      <div className="clock-time">{hhmm(now)}</div>
      <div className="clock-date">{now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div>
  );
}

export default function PageCalendar() {
  const { view } = useDevice();
  const { events, error, loading } = useCalendar(7);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) {
    const k = dayKey(parse(e));
    byDay.set(k, [...(byDay.get(k) || []), e]);
  }
  const label = (d: Date, i: number) =>
    i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <div className={`page cal ${view === 'web' ? 'cal-web' : ''}`}>
      {view === 'web' && <Clock />}
      {error.includes('google_not_connected') && (
        <p className="notice">Google Calendar ainda não foi autorizado. Peça ao administrador para configurar a integração.</p>
      )}
      {error && !error.includes('google_not_connected') && <p className="notice">Não foi possível atualizar o calendário.</p>}
      {loading && !events.length && !error && <p className="muted">Carregando…</p>}
      <div className="cal-days">
        {days.map((d, i) => {
          const list = byDay.get(dayKey(d)) || [];
          return (
            <section key={i} className={`day${i === 0 ? ' today' : ''}`}>
              <h2>{label(d, i)}</h2>
              {list.length === 0 && <p className="muted">{i === 0 ? 'Nada marcado para hoje.' : 'Sem eventos'}</p>}
              <ul>
                {list.map((e) => (
                  <li key={e.id} style={{ borderLeftColor: e.color }}>
                    <span className="ev-time">{e.allDay ? 'Dia todo' : hhmm(parse(e))}</span>
                    <span className="ev-body">
                      <strong>{e.title}</strong>
                      {e.location && <em>{e.location}</em>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
