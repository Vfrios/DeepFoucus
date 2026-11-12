import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { createAgentServices, pucIntervals } from '../backend/src/services/agentTools';
const now = () => new Date('2026-11-12T09:00:00Z');
it('only upcoming exams are returned, not past exams or classes', async () => {
  const rows = [{ tipo: 'prova', data: '2026-11-13' }, { tipo: 'prova', data: '2026-11-01' }, { tipo: 'aula', data: '2026-11-13' }, { tipo: 'prova', data: '2026-12-01' }, { tipo: 'prova', data: '2026-11-12T08:00:00Z' }];
  const services = createAgentServices('owner@test', { now, events: async () => [], log: async () => {}, db: async () => ({ collection: () => ({ find: () => ({ toArray: async () => rows }) }) }) as any });
  assert.deepEqual(await services.getUpcomingExams(), [rows[0]]);
});
it('free slots exclude PUC classes, calendar events and local tasks', async () => {
  const services = createAgentServices('owner@test', { now, log: async () => {}, events: async () => [{ id: '1', calendarId: 'p', title: 'busy', start: '2026-11-12T08:00:00-03:00', end: '2026-11-12T10:00:00-03:00' }], db: async () => ({ collection: () => ({ find: () => ({ toArray: async () => [{ inicio: '2026-11-12T11:00:00-03:00', fim: '2026-11-12T12:00:00-03:00' }] }) }) }) as any });
  const slots = await services.findFreeSlots('2026-11-12');
  assert.ok(slots.length);
  for (const s of slots) for (const p of pucIntervals('2026-11-12')) assert.ok(Date.parse(s.end) <= Date.parse(p.start) || Date.parse(s.start) >= Date.parse(p.end));
  assert.ok(!slots.some(s => s.start === '2026-11-12T11:00:00.000Z' || s.start === '2026-11-12T14:00:00.000Z'));
});
it('calendar failure is logged and does not yield free slots', async () => {
  const logs: unknown[] = [];
  const services = createAgentServices('owner@test', { now, log: async e => { logs.push(e); }, events: async () => { throw Error('offline'); }, db: async () => ({ collection: () => ({ find: () => ({ toArray: async () => [] }) }) }) as any });
  await assert.rejects(services.findFreeSlots('2026-11-12'), /offline/);
  assert.equal(logs.length, 1);
  await assert.rejects(services.moveWorkout('012345678901234567890123', '2026-11-13T10:00:00-03:00'), /Sem prova/);
});
it('workout move updates Google and Mongo, preserving the recurring plan and rejecting replay', async () => {
  const id = new ObjectId();
  const workout = { _id: id, email: 'owner@test', calendarEventId: 'event', agendadoPara: new Date('2026-11-13T12:00:00Z') };
  const patches: any[] = [], updates: any[] = [], logs: any[] = [];
  const services = createAgentServices('owner@test', {
    now, events: async () => [], log: async e => { logs.push(e); },
    db: async () => ({ collection: (name: string) => ({
      find: () => ({ toArray: async () => name === 'puc_events' ? [{ tipo: 'prova', data: '2026-11-14' }] : [] }),
      findOne: async () => workout,
      updateOne: async (filter: any, update: any) => { updates.push({ filter, update }); },
    }) }) as any,
    calendar: async () => ({ events: {
      get: async () => ({ data: { etag: 'v1', start: { dateTime: '2026-11-13T12:00:00Z' }, end: { dateTime: '2026-11-13T13:00:00Z' } } }),
      patch: async (request: any) => { patches.push(request); },
    } }) as any,
  });
  await services.moveWorkout(String(id), '2026-11-13T15:00:00Z');
  assert.equal(patches.length, 1); assert.equal(updates.length, 1);
  assert.equal(updates[0].update.$set.diaSemana, undefined);
  assert.deepEqual(updates[0].update.$set.agentOriginalDate, workout.agendadoPara);
  await assert.rejects(services.moveWorkout(String(id), '2026-11-13T16:00:00Z'), /Limite/);
  assert.equal(patches.length, 1); assert.equal(logs.length, 1);
});
