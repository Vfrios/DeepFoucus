import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDevicePairingCode,
  hashDevicePairingCode,
  normalizeDevicePairingCode,
} from '../backend/src/lib/devicePairing';

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
