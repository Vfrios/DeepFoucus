import { Router } from 'express';
import { listEvents, CalEvent } from '../lib/google';

const r = Router();
const cache = new Map<string, { at: number; data: CalEvent[] }>(); // cache curto: protege a cota do Google

// GET /api/calendar/events?days=7&from=<ISO do início do dia local>
r.get('/events', async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days || '7'), 10) || 7, 1), 31);
  let from = new Date(String(req.query.from || ''));
  if (isNaN(from.getTime())) {
    from = new Date();
    from.setUTCHours(0, 0, 0, 0);
  }
  const key = `${from.toISOString()}|${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) {
    res.json(hit.data);
    return;
  }
  try {
    const data = await listEvents(from, days);
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 20) cache.delete(cache.keys().next().value as string);
    res.json(data);
  } catch (e: any) {
    if (e?.message === 'google_not_connected') res.status(409).json({ error: 'google_not_connected' });
    else res.status(502).json({ error: 'google_error' });
  }
});

export default r;
