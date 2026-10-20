# Wall Dashboard

PWA única (React + Vite) servida por um backend Express, com **duas experiências**:

- **MobileShell** (celular): vertical, swipe + dots, calendário do dia e tarefas.
- **WebShell** (desktop / tablet na parede): tela cheia, pager com dots e **modo LOCK** 24/7.

Mesmo backend, mesmo MongoDB, mesmo Google Calendar.

## Estrutura

```
frontend/  React + Vite + TS (Embla, CSS puro, sw.ts)
backend/   Express + TS (API + serve frontend/dist em produção)
render.yaml
```

Rotas extras além do esboço original: `backend/src/routes/googleAuth.ts` (OAuth), `frontend/src/content.ts` (fotos/tabelas), `frontend/src/lib/push.ts`, `components/PushButton.tsx`.

## 1. Setup local

```bash
npm install
cp .env.example .env     # preencha os valores (seções abaixo)
npm run dev              # API :3001; Vite :5173 inicia após a checagem de saúde da API (proxy /api)
```

Abra `http://localhost:5173` e entre com a conta Google autorizada.

> Service Worker e push só funcionam no build de produção: `npm run build && NODE_ENV=production npm start` e abra `http://localhost:3001`. (Push em dispositivos reais exige HTTPS — use o deploy no Render.)

Na primeira configuração local, inicie o fluxo de autorização administrativa uma vez em
`http://localhost:3001/api/auth/google?token=SEU_API_TOKEN`. Isso registra a conta Google que poderá
entrar no aplicativo. Depois, o botão **Entrar com o Google** usa o fluxo normal de login para essa
mesma conta. Configure
`JWT_SECRET` com um segredo aleatório longo; ele é usado para assinar sessões de 30 dias.

## 2. MongoDB Atlas (M0)

1. Crie conta e um cluster **M0 (free)**.
2. *Database Access* → usuário com senha.
3. *Network Access* → libere `0.0.0.0/0` (o Render free não tem IP fixo).
4. *Connect → Drivers* → copie a string para `MONGODB_URI`.

Coleções criadas automaticamente: `tasks`, `auth`, `subscriptions`.

## 3. Google Cloud (Calendar)

1. [console.cloud.google.com](https://console.cloud.google.com) → novo projeto.
2. *APIs & Services → Library* → ative **Google Calendar API**.
3. *OAuth consent screen* → tipo External, adicione seu e-mail como **Test user** (e/ou publique o app para o refresh token não expirar em 7 dias).
4. *Credentials → Create credentials → OAuth client ID* → **Web application**.
   - Redirect URI local: `http://localhost:3001/api/auth/google/callback`
   - Redirect URI produção: `https://SEU-APP.onrender.com/api/auth/google/callback`
5. Copie Client ID/Secret para `.env`.
6. **Rode o fluxo inicial uma vez**: abra `/api/auth/google?token=SEU_API_TOKEN`, autorize a conta proprietária e o `refresh_token` será salvo na coleção `auth`. Depois, entre pela tela de login do aplicativo. Se os escopos solicitados pelo app mudarem, repita essa autorização para conceder as novas permissões.

O refresh token fica só no servidor; o front nunca o recebe.

## 4. VAPID (push)

```bash
npx web-push generate-vapid-keys
```

Coloque em `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e ajuste `VAPID_SUBJECT=mailto:voce@email.com`.

Push é disparado em: tarefa criada, tarefa concluída e evento começando em até 15 min (job de 60 s no backend).

## 5. Deploy no Render (um único serviço)

1. Suba o projeto para um repositório Git.
2. Render → *New → Blueprint* → selecione o repo (lê `render.yaml`).
3. Configure `MONGODB_URI`, `JWT_SECRET` e pelo menos uma chave entre `GROQ_API_KEY`, `GEMINI_API_KEY` e `OPENROUTER_API_KEY`. As variáveis do Google (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `FRONTEND_URL`) e VAPID (`VAPID_*`) só são necessárias se for usar essas integrações. `API_TOKEN` e `JWT_SECRET` são gerados automaticamente pelo Blueprint (veja em *Environment*); `MONGODB_DB` usa `wall_dashboard` por padrão.
4. Após o 1º deploy você terá `https://SEU-APP.onrender.com`. Defina:
   - `GOOGLE_REDIRECT_URI=https://SEU-APP.onrender.com/api/auth/google/callback`
   - `FRONTEND_URL=https://SEU-APP.onrender.com`
5. No Google Cloud, adicione essa mesma URL em *Authorized redirect URIs*.
6. Autorize a conta proprietária em `https://SEU-APP.onrender.com/api/auth/google?token=SEU_API_TOKEN`, substituindo pelo `API_TOKEN` visível em *Environment*. Repita essa autorização quando os escopos solicitados pelo app mudarem. A tela pública de login só emite uma sessão para essa mesma conta Google.
7. Depois do deploy, confirme que as políticas públicas estão acessíveis em `/privacy.html` e `/terms.html`; informe esses endereços na configuração de publicação do Google.

Build: `npm install --include=dev && npm run build` · Start: `node backend/dist/index.js`. O Express serve `/api/*` e o `frontend/dist`.

> No plano free o serviço hiberna após inatividade; o job de lembretes só roda com o serviço acordado. Para lembretes confiáveis use um plano pago ou um ping externo em `/healthz`.

## 6. Dispositivos e modos

| Como abrir | Resultado |
|---|---|
| Celular | MobileShell |
| Desktop | WebShell |
| Tablet | WebShell + banner único "Usar modo parede (kiosk)?" |

Forçar o modo (persiste em localStorage): `?view=web`, `?view=mobile`. Voltar ao automático: `?view=auto` (ou botão "Automático" em Ajustes).

**Lock (WebShell):** toque no 🔓 (canto inferior direito) para travar na página atual. Travado: sem dots/botões, sem swipe, e o estado sobrevive a recarregar. Toque em **🔒 Destravar** (canto inferior direito) para voltar à navegação.

### Tablet na parede (Android)

Use o **Fully Kiosk Browser**: Start URL `https://SEU-APP.onrender.com/?view=web`, ative *Keep Screen On*, *Fullscreen* e *Auto reload on network reconnect*.

### Adicionar à Tela de Início

- **iOS (Safari):** Compartilhar → *Adicionar à Tela de Início*.
- **Android (Chrome):** menu ⋮ → *Instalar app* / *Adicionar à tela inicial*.

## 7. Push no iOS

- Requer **iOS 16.4+**.
- Precisa instalar a PWA na Tela de Início e **abrir pelo ícone** (no Safari comum não funciona).
- No app instalado: Ajustes → **Ativar notificações** → permitir → **Enviar teste**.

## Notas

- Autenticação: toda a API protegida exige `Authorization: Bearer <JWT>`. O `API_TOKEN` é usado somente para iniciar a autorização inicial do proprietário em `/api/auth/google?token=...`.
- Fotos/tabelas: edite `frontend/src/content.ts`. Novas páginas: `frontend/src/config.ts`.
- Atualizações do app: o SW usa rede primeiro para a navegação; se algo ficar preso, aumente `CACHE` em `src/sw.ts`.
