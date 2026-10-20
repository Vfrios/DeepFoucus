import './lib/env'; // PRECISA ser o primeiro import
import express from 'express';
import cors from 'cors';
import path from 'path';
import { deviceMiddleware } from './middleware/device';
import { requireAuth } from './middleware/auth';
import deviceRoute from './routes/device';
import googleAuthRoute from './routes/googleAuth';
import calendarRoute from './routes/calendar';
import tasksRoute from './routes/tasks';
import statsRoute from './routes/stats';
import pushRoute, { initVapid, startReminderJob } from './routes/push';

const app = express();
const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3001;

app.set('trust proxy', 1);
app.use(cors({ origin: process.env.FRONTEND_URL || true }));
app.use(express.json({ limit: '100kb' }));
app.use(deviceMiddleware);

app.get('/healthz', (_req, res) => res.send('ok'));

// Públicas
app.use('/api/device', deviceRoute);
app.use('/api/auth', googleAuthRoute);

// Protegidas por Bearer
app.use('/api/calendar', requireAuth, calendarRoute);
app.use('/api/tasks', requireAuth, tasksRoute);
app.use('/api/stats', requireAuth, statsRoute);
app.use('/api/push', requireAuth, pushRoute);
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// Em produção o Express também serve o build do Vite
if (PROD) {
  const dist = path.resolve(__dirname, '../../frontend/dist');
  app.use(
    express.static(dist, {
      setHeaders: (res, p) => {
        if (p.endsWith('sw.js') || p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

initVapid();
startReminderJob();
app.listen(PORT, () => console.log(`Wall Dashboard na porta ${PORT} (${PROD ? 'produção' : 'dev'})`));
