import { Router } from 'express';
import { authUrl, checkState, saveCode, isConnected, getProfile } from '../lib/google';
import { requireAuth, safeEqual } from '../middleware/auth';

const r = Router();

// Passo 1 (fluxo feito UMA vez, no navegador): /api/auth/google?token=<API_TOKEN>
r.get('/google', (req, res) => {
  const t = String(req.query.token || '');
  if (!process.env.API_TOKEN || !safeEqual(t, process.env.API_TOKEN)) {
    res.status(401).send('Token inválido. Use /api/auth/google?token=SEU_API_TOKEN');
    return;
  }
  res.redirect(authUrl());
});

// Passo 2: o Google volta aqui com ?code=... ; validamos o state, guardamos
// o refresh_token e também nome/email/avatar do perfil.
r.get('/google/callback', async (req, res) => {
  try {
    if (!checkState(String(req.query.state || ''))) throw new Error('state inválido ou expirado');
    await saveCode(String(req.query.code || ''));
    res.redirect((process.env.FRONTEND_URL || '/') + '?google=ok');
  } catch (e: any) {
    res.status(400).send('Falha na autorização: ' + (e?.message || 'erro'));
  }
});

r.get('/status', requireAuth, async (_req, res) => {
  try {
    res.json({ connected: await isConnected() });
  } catch {
    res.status(500).json({ error: 'db_error' });
  }
});

// GET /api/auth/me -> { email, name, picture }
r.get('/me', requireAuth, async (_req, res) => {
  try {
    const profile = await getProfile();
    res.json(profile);
  } catch {
    res.status(500).json({ error: 'db_error' });
  }
});

export default r;
