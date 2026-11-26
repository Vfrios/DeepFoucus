import './lib/env'; // PRECISA ser o primeiro import
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import { deviceMiddleware } from './middleware/device';
import { jwtAuth } from './middleware/jwtAuth';
import { requireRole } from './middleware/requireRole';
import { attachWebSocketServer } from './lib/realtime';
import deviceRoute from './routes/device';
import googleAuthRoute from './routes/googleAuth';
import calendarRoute from './routes/calendar';
import tasksRoute from './routes/tasks';
import statsRoute from './routes/stats';
import pushRoute, { initVapid, startReminderJob } from './routes/push';
import notesRoute from './routes/notes';
import shoppingRoute from './routes/shopping';
import aiRoute from './routes/ai';
import financeRoute from './routes/finance';
import healthRoute, { startWorkoutSessionJob, rotateWaterMetrics } from './routes/health';
import dailyPlansRoute from './routes/dailyPlans';
import pucRoute from './routes/puc';
import { syncAgora } from './lib/canvasSync';
import { startPucAgentWorker } from './lib/pucAgentRunner';
import { startBriefingPushScheduler } from './lib/briefingService';
import { getDb } from './lib/mongo';
import cron from 'node-cron';
import { runScheduledAgent } from './agents/scheduler';
import { agentLog } from './agents/log';

const app = express();
const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3001;

app.set('trust proxy', 1);
app.use(cors({ origin: process.env.FRONTEND_URL || true }));
// A foto da nota/lista (JPEG reduzido) e entregas Markdown precisam de limites maiores que 100kb
app.use('/api/shopping/receipt-scan', express.json({ limit: '4mb' }));
app.use('/api/puc/assistant', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(deviceMiddleware);

app.get('/healthz', (_req, res) => {
  console.log('healthz', new Date().toISOString());
  res.status(200).send('ok');
});

// Públicas
app.use('/api/device', deviceRoute);
app.use('/api/auth', googleAuthRoute);

// Protegidas por Bearer
app.use('/api/calendar', jwtAuth, requireRole(['owner']), calendarRoute);
app.use('/api/tasks', jwtAuth, requireRole(['owner']), tasksRoute);
app.use('/api/daily-plans', jwtAuth, requireRole(['owner']), dailyPlansRoute);
app.use('/api/stats', jwtAuth, statsRoute);
app.use('/api/push', jwtAuth, pushRoute);
app.use('/api/health', healthRoute);
app.use('/api/notes', jwtAuth, requireRole(['owner']), notesRoute);
// /add tambem aceita x-api-token para os Atalhos do iOS; as demais rotas exigem JWT.
app.use('/api/shopping', shoppingRoute);
app.use('/api/ai', aiRoute);
app.use('/api/finance', financeRoute);
app.use('/api/puc', pucRoute);
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
try {
  cron.schedule('0 6 * * *', () => runScheduledAgent('maestro'), { timezone: 'America/Sao_Paulo', noOverlap: true });
  cron.schedule('5 6 * * *', () => runScheduledAgent('tutor'), { timezone: 'America/Sao_Paulo', noOverlap: true });
} catch (error) { void agentLog({ action: 'cron_setup_error', error: String(error) }); }
startReminderJob();
const runWorkoutSessionJob = () => {
  startWorkoutSessionJob().catch((error) => {
    console.error('[health] workout session job failed:', error instanceof Error ? error.message : String(error));
  });
};
runWorkoutSessionJob();
setInterval(runWorkoutSessionJob, 5 * 60 * 1000);
const runMetricRotation = () => rotateWaterMetrics();
runMetricRotation();
setInterval(runMetricRotation, 24 * 60 * 60 * 1000);
const runCanvasSync = (mode: 'light' | 'full') => {
  getDb()
    .then((db) => syncAgora(db, mode))
    .catch((error) => {
      console.error(`[puc] sync (${mode}) failed:`, error instanceof Error ? error.message : String(error));
    });
};
// Não roda no boot: aguarda 60s e só dispara sync leve se o último sync tiver mais de 20 min
setTimeout(() => {
  getDb()
    .then(async (db) => {
      const last = await db
        .collection('canvas_sync_log')
        .find()
        .sort({ started_at: -1 })
        .limit(1)
        .next();
      const lastAt = last?.started_at ? new Date(last.started_at).getTime() : 0;
      if (!last || Date.now() - lastAt > 20 * 60 * 1000) {
        await syncAgora(db, 'light');
      }
    })
    .catch((error) => {
      console.error('[puc] delayed startup sync check failed:', error instanceof Error ? error.message : String(error));
    });
}, 60_000);
// Sync leve a cada 20 min
setInterval(() => runCanvasSync('light'), 20 * 60 * 1000);
// Worker assíncrono do Agente PUC (processa fila puc_jobs sem bloquear requisições HTTP)
startPucAgentWorker(getDb);
// Push único da manhã do Briefing (quando horário fixo estiver configurado)
startBriefingPushScheduler();
// Sync completo 1x por dia (03:30 America/Sao_Paulo) e sync leve da manhã (05:50 America/Sao_Paulo)
try {
  cron.schedule('30 3 * * *', () => runCanvasSync('full'), { timezone: 'America/Sao_Paulo', noOverlap: true });
  cron.schedule('50 5 * * *', () => runCanvasSync('light'), { timezone: 'America/Sao_Paulo', noOverlap: true });
} catch (error) {
  console.error('[puc] sync cron setup failed:', error instanceof Error ? error.message : String(error));
}
const server = createServer(app);
attachWebSocketServer(server);
server.listen(PORT, () => console.log(`Wall Dashboard na porta ${PORT} (${PROD ? 'produção' : 'dev'})`));
