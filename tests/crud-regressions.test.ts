import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import { ensureCalendarEvent, type CalendarTask } from '../backend/src/lib/google';
import { normalizeItems, removeDailyPlanItem } from '../backend/src/routes/dailyPlans';
import { buildExpensePatch } from '../backend/src/routes/finance';

test('reuses a workout event with the same title and day without creating another event', async () => {
  const task: CalendarTask = {
    titulo: 'Treino de Peito e Tríceps',
    inicio: '2026-11-13T18:00:00-03:00',
    fim: '2026-11-13T19:00:00-03:00',
  };
  let createCalls = 0;

  const result = await ensureCalendarEvent(task, {
    find: async () => 'existing-google-event',
    create: async () => {
      createCalls += 1;
      return 'new-google-event';
    },
  });

  assert.deepEqual(result, { eventId: 'existing-google-event', created: false });
  assert.equal(createCalls, 0);
});

test('creates and removes an item from a daily plan', () => {
  const items = normalizeItems([{ texto: 'Estudar cálculo', prioridade: 'urgente_hoje' }]);
  assert.ok(items);
  assert.equal(items.length, 1);
  assert.equal(items[0].texto, 'Estudar cálculo');
  assert.ok(items[0]._id instanceof ObjectId);

  const remaining = removeDailyPlanItem(items, items[0]._id);
  assert.deepEqual(remaining, []);
});

test('builds the validated update used by PATCH /finance/:id', () => {
  const result = buildExpensePatch({ valor: '89,90', categoria: 'Mercado' });
  assert.ok(result.set);
  assert.deepEqual(result.set, { valor: 89.9, categoria: 'Mercado' });
});

