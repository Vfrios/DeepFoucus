import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { authUrl, checkState, saveCode, isConnected, getProfile, getProfileFromCode } from '../lib/google';
import { safeEqual } from '../middleware/auth';
import { jwtAuth } from '../middleware/jwtAuth';
import { roleForEmail } from '../lib/roles';

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

// Login público; o callback autoriza apenas os e-mails configurados para os perfis.
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

// O login verifica a identidade sem substituir as credenciais Google do aplicativo.
r.get('/google/callback', async (req, res) => {
  try {
    const flow = checkState(String(req.query.state || ''));
    if (!flow) throw new Error('state inválido ou expirado');

    if (flow === 'login' && !(await getProfile()).email) {
      throw new Error('A conta Google do aplicativo ainda não foi configurada.');
    }

    const code = String(req.query.code || '');
    const profile = flow === 'login'
      ? await getProfileFromCode(code)
      : await saveCode(code, undefined, process.env.EMAIL_VITOR ? [process.env.EMAIL_VITOR] : []);
    const role = roleForEmail(profile.email);
    if (!role) throw new Error('google_account_not_allowed');

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET não configurado.');

    const token = jwt.sign(
      { email: profile.email, name: profile.name, picture: profile.picture, role },
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
