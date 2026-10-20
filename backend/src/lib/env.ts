// Carrega o .env da raiz do monorepo (backend/src|dist -> ../../../.env).
// Em produção (Render) as variáveis já vêm do ambiente e o dotenv não sobrescreve.
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
