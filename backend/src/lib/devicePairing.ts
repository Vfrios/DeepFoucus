import { createHash, randomInt } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const DEVICE_PAIRING_CODE_LENGTH = 12;

export function createDevicePairingCode(): string {
  return Array.from({ length: DEVICE_PAIRING_CODE_LENGTH }, () =>
    CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  ).join('');
}

export function normalizeDevicePairingCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== DEVICE_PAIRING_CODE_LENGTH) return null;
  return [...code].every((character) => CODE_ALPHABET.includes(character)) ? code : null;
}

export function hashDevicePairingCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
