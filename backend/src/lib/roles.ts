export type Role = 'owner' | 'finance' | 'guest';

export function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'finance' || value === 'guest';
}

export function roleForEmail(email: string | null | undefined): Role | null {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return null;

  if (matchesConfiguredEmail(normalizedEmail, process.env.EMAIL_VITOR)) return 'owner';
  if (matchesConfiguredEmail(normalizedEmail, process.env.EMAIL_SOPHIA)) return 'finance';
  if (matchesConfiguredEmail(normalizedEmail, process.env.EMAIL_MAE)) return 'guest';
  return null;
}

export function isPrimaryOwnerEmail(email: string, configuredEmail = process.env.EMAIL_VITOR): boolean {
  const normalizedConfiguredEmail = configuredEmail?.trim().toLowerCase();
  return Boolean(normalizedConfiguredEmail) && email.trim().toLowerCase() === normalizedConfiguredEmail;
}

function matchesConfiguredEmail(email: string, configuredEmail: string | undefined): boolean {
  const normalizedConfiguredEmail = configuredEmail?.trim().toLowerCase();
  return Boolean(normalizedConfiguredEmail) && email === normalizedConfiguredEmail;
}
