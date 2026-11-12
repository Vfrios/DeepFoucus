import { it } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, complete } from '../backend/src/agents/core';

const finish = { role: 'assistant', content: '{"action":"finish"}' } as any;
const call = (name: string) => ({ role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name, arguments: '{}' } }] }) as any;
it('agent executes tool and stops on finish', async () => {
  let count = 0;
  const responses = [call('read'), finish];
  const result = await runAgent('', '', [{ name: 'read', description: '', parameters: {}, execute: async () => { count++; return 42; } }], { log: async () => {}, complete: async () => responses.shift() });
  assert.equal(count, 1); assert.equal(result.status, 'finished');
});
it('unknown tool returns exact error and allows recovery', async () => {
  let turn = 0;
  await runAgent('', '', [], { log: async () => {}, complete: async messages => {
    if (turn++ === 0) return call('fake');
    assert.equal(messages.at(-1)?.content, '{"error":"Ferramenta não encontrada"}'); return finish;
  } });
});
it('agent aborts at five turns and contains AI and logging failures', async () => {
  const result = await runAgent('', '', [], { log: async () => {}, complete: async () => call('fake') });
  assert.deepEqual(result, { status: 'aborted', iterations: 5 });
  assert.equal((await runAgent('', '', [], { log: async () => { throw Error('db'); }, complete: async () => { throw Error('ai'); } })).status, 'failed');
});
it('production transport sends OpenAI tool schemas and feeds tool results back to the model', async () => {
  const fetch = globalThis.fetch, key = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test';
  const requests: any[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return new Response(JSON.stringify({ choices: [{ message: requests.length === 1 ? call('read') : finish }] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    await runAgent('', '', [{ name: 'read', description: 'Read data', parameters: { type: 'object', properties: {} }, execute: async () => ({ value: 42 }) }], { complete, log: async () => {} });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].tools[0].type, 'function');
    assert.equal(requests[1].messages.at(-1).content, '{"value":42}');
  } finally { globalThis.fetch = fetch; if (key === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = key; }
});
