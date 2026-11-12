import { acquireLock, releaseLock } from './locks';
import { runMaestroAgent } from './maestroAgent';
import { runTutorAgent } from './tutorAgent';
import { agentLog } from './log';
import { getDb } from '../lib/mongo';

export async function runScheduledAgent(name: 'maestro' | 'tutor') {
  let lock: Awaited<ReturnType<typeof acquireLock>> = null;
  let status = 'failed';
  try {
    const email = (process.env.HEALTH_API_EMAIL || process.env.EMAIL_VITOR || '').trim().toLowerCase();
    if (!email) throw Error('HEALTH_API_EMAIL ou EMAIL_VITOR obrigatório');
    const auth = await (await getDb()).collection<any>('auth').findOne({ _id: 'google' });
    if (auth?.email?.toLowerCase() !== email) throw Error('Conta Google não corresponde ao proprietário do agente');
    lock = await acquireLock(name, email);
    if (!lock) return;
    const result = await (name === 'maestro' ? runMaestroAgent : runTutorAgent)(email);
    status = result.status;
  } catch (error) { await agentLog({ agent: name, action: 'scheduled_error', error: String(error) }); }
  finally { if (lock) await releaseLock(lock, status); }
}
