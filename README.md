# Wall Dashboard

PWA única (React + Vite) servida por um backend Express, com **duas experiências**:

- **MobileShell** (celular): vertical, swipe + dots, calendário do dia e tarefas.
- **WebShell** (desktop / tablet na parede): tela cheia, pager com dots e **modo LOCK** 24/7.

Mesmo backend, mesmo MongoDB, mesmo Google Calendar.

## Estrutura

frontend/  React + Vite + TS (Embla, CSS puro, sw.ts)
backend/   Express + TS (API + serve frontend/dist em produção)
render.yaml

Rotas extras além do esboço original: `backend/src/routes/googleAuth.ts` (OAuth), `frontend/src/content.ts` (fotos/tabelas), `frontend/src/lib/push.ts`, `components/PushButton.tsx`.

## 1. Setup local

```bash
npm install
cp .env     # preencha os valores (seções abaixo)
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
3. Configure `MONGODB_URI`, `JWT_SECRET`, `EMAIL_VITOR`, `EMAIL_SOPHIA`, `EMAIL_MAE` e pelo menos uma chave entre `GROQ_API_KEY`, `GEMINI_API_KEY` e `OPENROUTER_API_KEY`. As três variáveis de e-mail autorizam, respectivamente, os perfis `owner`, `finance` e `guest`. As variáveis do Google (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `FRONTEND_URL`) e VAPID (`VAPID_*`) só são necessárias se for usar essas integrações. `API_TOKEN` e `JWT_SECRET` são gerados automaticamente pelo Blueprint (veja em *Environment*); `MONGODB_DB` usa `wall_dashboard` por padrão.
4. Após o 1º deploy você terá `https://SEU-APP.onrender.com`. Defina:
   - `GOOGLE_REDIRECT_URI=https://SEU-APP.onrender.com/api/auth/google/callback`
   - `FRONTEND_URL=https://SEU-APP.onrender.com`
5. No Google Cloud, adicione essa mesma URL em *Authorized redirect URIs*.
6. Autorize a conta proprietária em `https://SEU-APP.onrender.com/api/auth/google?token=SEU_API_TOKEN`, substituindo pelo `API_TOKEN` visível em *Environment*. Repita essa autorização quando os escopos solicitados pelo app mudarem. A tela pública de login emite sessões somente para os endereços configurados em `EMAIL_VITOR`, `EMAIL_SOPHIA` e `EMAIL_MAE`; esse login não substitui as credenciais Google do calendário.
7. Depois do deploy, confirme que as políticas públicas estão acessíveis em `/privacy.html` e `/terms.html`; informe esses endereços na configuração de publicação do Google.

Build: `npm install --include=dev && npm run build` · Start: `node backend/dist/index.js`. O Express serve `/api/*` e o `frontend/dist`.

> No plano free o serviço hiberna após inatividade; o job de lembretes só roda com o serviço acordado. Para lembretes confiáveis use um plano pago ou um ping externo em `/healthz`.

## 6. Dispositivos e modos

| Como abrir | Resultado |
| --- | --- |
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

## 8. Atalhos do iPhone (LOSAI)

No app **Atalhos**, crie o atalho **“LOSAI - Comando”**:

1. Adicione a ação **“Obter Conteúdo do URL”** e use `https://deepfoucus.onrender.com/api/ai/command`.
2. Em **Método**, selecione `POST`; em **Corpo da Solicitação**, selecione `JSON`.
3. Envie `comando` (o texto ou ditado do usuário) e `contexto` (opcional).
4. Em **Cabeçalhos**, adicione `x-api-token` com o valor de `API_TOKEN` configurado no Render. Mantenha esse token privado.
5. Execute o atalho e use o campo `resposta` da resposta JSON para falar ou exibir o resultado.

Exemplo de corpo:

```json
{
  "comando": "Adicione creme de leite à lista de compras",
  "contexto": ""
}
```

O endpoint identifica comandos de compra, criação de tarefa, consulta da agenda e lembrete de água. As rotas da lista de compras usadas pelo app continuam protegidas pela sessão do usuário.

## 9. Dashboard financeiro

A tela **Finanças** no modo parede mostra os gastos do mês atual, totais por responsável e categoria, e atualiza em tempo real. Os valores ficam ocultos até tocar em **Mostrar Valores**. **Exportar Excel** baixa todos os lançamentos com uma tabela de despesas e totais por responsável.

Para registrar um gasto com Atalhos, use **Obter Conteúdo do URL** com `POST` para `https://deepfoucus.onrender.com/api/finance/add`, corpo JSON e cabeçalho `x-api-token` com o `API_TOKEN` privado do Render:

```json
{
  "data": "2026-11-10T13:30:00-03:00",
  "valor": "50.00",
  "estabelecimento": "Posto Shell",
  "local": "Av. Raja Gabaglia",
  "responsavel": "Vitor",
  "categoria": "Gasolina",
  "origem": "iOS"
}
```

Quando `categoria` estiver vazia ou for `Outros`, o backend tenta inferi-la com a IA configurada. A listagem, exclusão e exportação financeira exigem JWT com perfil `owner` ou `finance`. O `POST /api/finance/add` aceita esses mesmos perfis ou o `API_TOKEN` usado pela integração existente com Atalhos.

## Notas

- Autenticação: as rotas protegidas do app exigem `Authorization: Bearer <JWT>`. O `API_TOKEN` inicia a autorização do proprietário em `/api/auth/google?token=...` e autentica o webhook de Atalhos via `x-api-token`.
- Fotos/tabelas: edite `frontend/src/content.ts`. Novas páginas: `frontend/src/config.ts`.
- Atualizações do app: o SW usa rede primeiro para a navegação; se algo ficar preso, aumente `CACHE` em `src/sw.ts`.
