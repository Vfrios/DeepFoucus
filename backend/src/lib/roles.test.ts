import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roleForEmail } from './roles';

test('maps only configured Google accounts to their roles', () => {
  const previous = {
    vitor: process.env.EMAIL_VITOR,
    sophia: process.env.EMAIL_SOPHIA,
    mae: process.env.EMAIL_MAE,
  };
  process.env.EMAIL_VITOR = 'vitor@example.com';
  process.env.EMAIL_SOPHIA = 'sophia@example.com';
  process.env.EMAIL_MAE = 'mae@example.com';

  try {
    assert.equal(roleForEmail('VITOR@example.com'), 'owner');
    assert.equal(roleForEmail('sophia@example.com'), 'finance');
    assert.equal(roleForEmail('mae@example.com'), 'guest');
    assert.equal(roleForEmail('unknown@example.com'), null);
    assert.equal(roleForEmail(undefined), null);
  } finally {
    if (previous.vitor === undefined) delete process.env.EMAIL_VITOR;
    else process.env.EMAIL_VITOR = previous.vitor;
    if (previous.sophia === undefined) delete process.env.EMAIL_SOPHIA;
    else process.env.EMAIL_SOPHIA = previous.sophia;
    if (previous.mae === undefined) delete process.env.EMAIL_MAE;
    else process.env.EMAIL_MAE = previous.mae;
  }
});
