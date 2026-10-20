import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { authUrl, checkState, saveCode, isConnected, getProfile } from '../lib/google';
import { safeEqual } from '../middleware/auth';
import { jwtAuth } from '../middleware/jwtAuth';

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

// Login público restrito à conta Google autorizada no bootstrap do app.
r.get('/login', async (_req, res) => {
  try {
    const profile = await getProfile();
    if (!profile.email) {
      res.status(503).send('O proprietário ainda precisa configurar o acesso Google do aplicativo.');
      return;
    }
    res.redirect(authUrl('login'));
  } catch {
    res.status(500).send('Não foi possível iniciar o login Google.');
  }
});

// O callback valida o fluxo, verifica a conta autorizada e emite o JWT da sessão.
r.get('/google/callback', async (req, res) => {
  try {
    const flow = checkState(String(req.query.state || ''));
    if (!flow) throw new Error('state inválido ou expirado');

    const authorizedProfile = flow === 'login' ? await getProfile() : null;
    if (flow === 'login' && !authorizedProfile?.email) {
      throw new Error('A conta Google do aplicativo ainda não foi configurada.');
    }

    const profile = await saveCode(
      String(req.query.code || ''),
      authorizedProfile?.email || undefined
    );
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET não configurado.');

    const token = jwt.sign(
      { email: profile.email, name: profile.name, picture: profile.picture },
      secret,
      { algorithm: 'HS256', expiresIn: '30d', subject: profile.email || undefined }
    );
    const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const destination = new URL(frontendUrl);
    destination.search = '';
    destination.hash = '';
    destination.searchParams.set('login', 'success');
    destination.searchParams.set('jwt', token);
    res.redirect(destination.toString());
  } catch (error) {
    console.error('[auth] falha no login Google:', error);
    const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const destination = new URL(frontendUrl);
    destination.search = '?login=error';
    destination.hash = '';
    res.redirect(destination.toString());
  }
});

r.get('/status', jwtAuth, async (_req, res) => {
  try {
    res.json({ connected: await isConnected() });
  } catch {
    res.status(500).json({ error: 'db_error' });
  }
});

// GET /api/auth/me -> { email, name, picture }
r.get('/me', jwtAuth, async (_req, res) => {
  try {
    const profile = await getProfile();
    res.json(profile);
  } catch {
    res.status(500).json({ error: 'db_error' });
  }
});

export default r;
