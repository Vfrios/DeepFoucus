import { Router } from 'express';
const r = Router();
// Público: só devolve o que o próprio navegador já enviou nos headers.
r.get('/', (req, res) => res.json(req.device));
export default r;
