import { it } from 'node:test';
import assert from 'node:assert/strict';
import { runMaestroAgent, MAESTRO_PROMPT } from '../backend/src/agents/maestroAgent';
import { runTutorAgent, TUTOR_PROMPT } from '../backend/src/agents/tutorAgent';
import { createAgentServices } from '../backend/src/services/agentTools';
it('Maestro uses the model decision to move a workout and writes a decision log', async () => {
  const inserted: any[] = [], calls: any[] = [];
  const db = { collection: (name: string) => ({ insertOne: async (entry: any) => { inserted.push({ collection: name, ...entry }); } }) };
  const log = async (entry: any) => { await db.collection('agent_logs').insertOne(entry); };
  const services = createAgentServices('owner@test');
  services.moveWorkout = async (id, date) => { calls.push([id,date]); return { id, start: date, end: date }; };
  let turn = 0;
  const result = await runMaestroAgent('owner@test', { log, complete: async () => (turn++ === 0 ? { role: 'assistant', content: 'Prova confirmada; liberar preparação.', tool_calls: [{ id: 'move', type: 'function', function: { name: 'moveWorkout', arguments: '{"id":"123","newDate":"2026-11-13T10:00:00-03:00"}' } }] } : { role: 'assistant', content: '{"action":"finish"}' }) as any }, services);
  assert.equal(result.status, 'finished'); assert.equal(calls.length, 1);
  assert.ok(inserted.some(e => e.collection === 'agent_logs' && e.action === 'moveWorkout'));
});
it('Tutor exposes study tools but no workout mutation and includes PUC context', async () => {
  await runTutorAgent('owner@test', { log: async () => {}, complete: async (_, tools) => {
    const names = tools.map((t: any) => t.function.name);
    assert.ok(names.includes('createStudyTask')); assert.ok(!names.includes('moveWorkout'));
    return { role: 'assistant', content: '{"action":"finish"}' } as any;
  } });
  for (const prompt of [MAESTRO_PROMPT, TUTOR_PROMPT]) { assert.match(prompt, /17:10–20:40/); assert.match(prompt, /só mova treino se houver prova/); }
});
