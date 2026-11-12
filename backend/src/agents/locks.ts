import { randomUUID } from 'crypto';
import { getDb } from '../lib/mongo';
import { dayKey } from '../services/agentTools';
import { agentLog } from './log';

export interface AgentLock { _id: string; token: string }
export function createLockService(db = getDb, log = agentLog) {
  const acquireLock = async (agent: string, email: string, now = new Date()): Promise<AgentLock | null> => {
    try {
      const collection = (await db()).collection<any>('agent_locks');
      await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      const lock = { _id: `${agent}:${email}:${dayKey(now)}`, token: randomUUID() };
      await collection.insertOne({ ...lock, agent, email, status: 'running', startedAt: now, expiresAt: new Date(+now + 7 * 86400000) });
      return lock;
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) { await log({ agent, action: 'skipped', reason: 'Execução diária já adquirida' }); return null; }
      await log({ agent, action: 'lock_error', error: String(error) });
      return null; // No database, no permission to execute.
    }
  };
  const releaseLock = async (lock: AgentLock, status: string) => {
    try {
      await (await db()).collection<any>('agent_locks').updateOne({ ...lock, status: 'running' }, { $set: { status, finishedAt: new Date() } });
    } catch (error) { await log({ action: 'release_lock_error', lock: lock._id, error: String(error) }); }
  };
  return { acquireLock, releaseLock };
}
export const { acquireLock, releaseLock } = createLockService();
