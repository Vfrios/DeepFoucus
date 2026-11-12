import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createLockService } from '../backend/src/agents/locks';
it('atomic daily lock survives release, races and date rollover in Sao Paulo', async () => {
  const docs = new Map<string, any>();
  const collection = {
    createIndex: async (_: any, options: any) => assert.equal(options.expireAfterSeconds, 0),
    insertOne: async (doc: any) => { if (docs.has(doc._id)) throw { code: 11000 }; docs.set(doc._id, doc); },
    updateOne: async (filter: any, update: any) => { const doc = docs.get(filter._id); if (doc?.token === filter.token && doc.status === filter.status) Object.assign(doc, update.$set); },
  };
  const locks = createLockService(async () => ({ collection: () => collection }) as any, async () => {});
  const date = new Date('2026-11-13T01:00:00Z');
  const results = await Promise.all([locks.acquireLock('maestro','a',date), locks.acquireLock('maestro','a',date)]);
  assert.equal(results.filter(Boolean).length,1);
  const lock = results.find(Boolean)!;
  assert.match(lock._id, /2026-11-12$/);
  await locks.releaseLock(lock,'finished');
  assert.equal(await locks.acquireLock('maestro','a',date), null);
  assert.ok(await locks.acquireLock('tutor','a',date));
  assert.ok(await locks.acquireLock('maestro','a',new Date('2026-11-13T09:00:00Z')));
});
it('MongoDB outage prevents execution and is logged', async () => {
  const logs: any[] = [];
  const locks = createLockService(async () => { throw Error('offline'); }, async entry => { logs.push(entry); });
  assert.equal(await locks.acquireLock('maestro','a'),null);
  await locks.releaseLock({ _id: 'a', token: 'b' }, 'failed');
  assert.deepEqual(logs.map(e => e.action), ['lock_error','release_lock_error']);
});
