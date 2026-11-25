import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDevicePairingCode,
  hashDevicePairingCode,
  normalizeDevicePairingCode,
} from '../backend/src/lib/devicePairing';
import { requirePrimaryOwnerEmail } from '../backend/src/middleware/requirePrimaryOwnerEmail';
import type { Request, Response } from 'express';

test('creates high-entropy pairing codes and normalizes display separators', () => {
  const code = createDevicePairingCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/);
  assert.equal(normalizeDevicePairingCode(`${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`), code);
  assert.equal(normalizeDevicePairingCode('invalid'), null);
});

test('hashes pairing codes consistently without storing the raw value', () => {
  const code = 'ABCDEFGH2345';
  assert.equal(hashDevicePairingCode(code), hashDevicePairingCode(code));
  assert.notEqual(hashDevicePairingCode(code), code);
});

test('rejects a non-primary owner with 403 when starting device pairing', () => {
  const previousEmail = process.env.EMAIL_VITOR;
  process.env.EMAIL_VITOR = 'vitorfrios074@gmail.com';
  let statusCode = 200;
  let responseBody: unknown;
  let nextCalled = false;
  const req = {
    user: {
      email: 'another-owner@example.com',
      name: 'Other owner',
      picture: null,
      role: 'owner' as const,
    },
  } as Request;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    },
  } as unknown as Response;

  try {
    requirePrimaryOwnerEmail(req, res, () => { nextCalled = true; });
  } finally {
    if (previousEmail === undefined) delete process.env.EMAIL_VITOR;
    else process.env.EMAIL_VITOR = previousEmail;
  }

  assert.equal(statusCode, 403);
  assert.deepEqual(responseBody, { error: 'primary_owner_required' });
  assert.equal(nextCalled, false);
});
