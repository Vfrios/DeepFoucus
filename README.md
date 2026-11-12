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

Coleções e índices são criados automaticamente quando usados. Além de `tasks`, `auth` e
`subscriptions`, a área Saúde usa `profile`, `workouts`, `workout_logs`, `water_logs` e `diets`.

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

Push é disparado em: tarefa criada, tarefa concluída, evento começando em até 15 min (job de 60 s)
e lembretes de hidratação, refeições e treinos. Enquanto o app está aberto, o frontend verifica os lembretes a cada 5 minutos e acorda o backend quando necessário. Não são enviados lembretes entre 22h e 08h.
Ative as notificações em cada dispositivo/navegador; a assinatura de cada um é salva no servidor, e o app restaura o estado ao ser reaberto. A permissão concedida pelo navegador não é compartilhada entre dispositivos.

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

> No plano free o serviço hiberna após inatividade. Com o app aberto, a verificação periódica do frontend acorda o serviço; com o app fechado, lembretes totalmente autônomos ainda exigem um plano sem hibernação ou um ping externo.

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

> **Aviso:** para receber notificações reais no iPhone, o app deve estar instalado na Tela de Início (iOS 16.4+) e o usuário deve ter clicado em **Ativar notificações** no menu de Ajustes.

## 8. Configurando o iPhone (Atalhos)

O iPhone atua como controle remoto rápido do LOSAI usando o app **Atalhos (Shortcuts)** da Apple.
Todas as chamadas usam respostas JSON leves e autenticação direta via cabeçalho HTTP:
- **Cabeçalho:** `x-api-token`
- **Valor:** Seu `API_TOKEN` privado configurado no Render / `.env`.

---

### 1. Registrar Água Rápido
Crie o atalho **“LOSAI - Beber Água”**:
1. Adicione a ação **Obter Conteúdo do URL**.
2. **URL:** `https://deepfoucus.onrender.com/api/health/water/quick-add` (ou `http://localhost:3001/api/health/water/quick-add` em dev)
3. **Método:** `POST`
4. **Cabeçalhos:**
   - `x-api-token` : `SEU_API_TOKEN`
5. **Corpo da Solicitação:** `JSON`
   - `ml` (Número) : `250` (ou use um menu para escolher 250, 500, etc.)
6. Exemplo de JSON enviado:
```json
{
  "ml": 250
}
```
7. Resposta retornada:
```json
{
  "sucesso": true,
  "mensagem": "Água registrada",
  "totalHoje": 1200,
  "meta": 2500
}
```
8. Adicione a ação **Mostrar Notificação** ou **Falar Texto** usando `mensagem` ou `totalHoje`.

---

### 2. Check-in de Refeição
Crie o atalho **“LOSAI - Registrar Refeição”**:
1. Adicione a ação **Obter Conteúdo do URL**.
2. **URL:** `https://deepfoucus.onrender.com/api/health/meals/log`
3. **Método:** `POST`
4. **Cabeçalhos:**
   - `x-api-token` : `SEU_API_TOKEN`
5. **Corpo da Solicitação:** `JSON`
   - `tipoRefeicao` (Texto) : `Almoço` (pode usar ação anterior **Escolher do Menu**: Café da manhã, Lanche, Almoço, Pré-treino, Janta)
6. Exemplo de JSON enviado:
```json
{
  "tipoRefeicao": "Almoço"
}
```
7. Resposta retornada:
```json
{
  "sucesso": true,
  "mensagem": "Refeição registrada",
  "caloriasConsumidas": 700
}
```

---

### 3. Comandos Livres de IA (Universal)
Crie o atalho **“LOSAI - Comando”**:
1. Adicione a ação **Obter Conteúdo do URL**.
2. **URL:** `https://deepfoucus.onrender.com/api/ai/command`
3. **Método:** `POST`
4. **Cabeçalhos:**
   - `x-api-token` : `SEU_API_TOKEN`
5. **Corpo da Solicitação:** `JSON`
   - `comando` (Texto ou Ditado) : `Adicione leite na lista`
   - `contexto` (Texto) : `atalho_ios`
6. Exemplo de JSON enviado:
```json
{
  "comando": "Adicione leite na lista",
  "contexto": "atalho_ios"
}
```
7. Resposta retornada:
```json
{
  "resposta": "Adicionei Leite à lista de compras."
}
```
8. Use a ação **Falar Texto** ou **Exibir Resultado** com a chave `resposta`.

---

### 4. Briefing Matinal ("Bom Dia")
Crie o atalho **“LOSAI - Bom Dia”** (pode ser ativado automaticamente ao desligar o alarme matinal):
1. Adicione a ação **Obter Conteúdo do URL**.
2. **URL:** `https://deepfoucus.onrender.com/api/ai/briefing`
3. **Método:** `GET`
4. **Cabeçalhos:**
   - `x-api-token` : `SEU_API_TOKEN`
5. Não requer corpo.
6. Resposta retornada:
```json
{
  "texto": "Bom dia, Vitor! Você tem 2 compromissos e treino de A - Peito hoje. Sua meta de água é 2.5L. Tenha um ótimo dia!"
}
```
7. Adicione a ação **Falar Texto** com a chave `texto` da resposta para que a Siri leia o resumo do seu dia assim que acordar.

---

### 5. Atalho do iPhone: Iniciar Treino
1. Adicione a ação **Obter Conteúdo do URL**.
2. **URL:** `https://deepfoucus.onrender.com/api/health/workout/start`
3. **Método:** `POST`
4. **Cabeçalhos:** `x-api-token: SEU_API_TOKEN`
5. **Corpo:** JSON com `peso` (N?mero), por exemplo `{ "peso": 75.5 }`. Se n?o tiver uma medi??o, envie `{}`.
6. A resposta contém `{"sucesso":true,"mensagem":"Treino iniciado"}` e os dados da sessão em `workoutSession`.

---

### 6. Atalho do iPhone: Adicionar Compra
1. Adicione a ação **Obter Conteúdo do URL**.
2. **URL:** `https://deepfoucus.onrender.com/api/shopping/add`
3. **Método:** `POST`
4. **Cabeçalhos:** `x-api-token: SEU_API_TOKEN`
5. **Corpo da Solicitação:** `JSON`
```json
{
  "item": "Leite"
}
```
6. A resposta contém `{"sucesso":true,"mensagem":"Item adicionado"}`.

---

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

## 10. Saúde

A página **Saúde** reúne perfil, treino e hidratação, nutrição e dashboard. O perfil e os registros
são privados por conta autenticada. Salvar e gerar rotina solicita à IA uma dieta e um treino; os
treinos são agendados no próximo dia correspondente do Google Calendar quando a conta Google está
conectada. A meta diária de água é calculada como `peso × 35 ml`, e os lembretes push verificam o
consumo registrado no servidor.

Configure pelo menos uma chave de IA (`GROQ_API_KEY`, `GEMINI_API_KEY` ou `OPENROUTER_API_KEY`),
as chaves VAPID e a autorização Google Calendar para usar todas as integrações. Os endpoints em
`/api/health/*` exigem uma sessão JWT com perfil `owner`.

### Atalho do iPhone: registrar refeição

A rota `POST /api/health/meals/log` aceita JWT ou o cabeçalho `x-api-token`. Ela procura a refeição
no plano de dieta atual, soma calorias e macros ao total do dia e registra o horário. Registrar a
mesma refeição duas vezes no mesmo dia não duplica o total.

No app **Atalhos**, crie o atalho **“LOSAI - Registrar Refeição”**:

1. Adicione a ação **Obter Conteúdo do URL**.
2. URL: `https://deepfoucus.onrender.com/api/health/meals/log`
3. Método: `POST`
4. Cabeçalho: `x-api-token` = `SEU_TOKEN` (o `API_TOKEN` privado do Render).
5. Corpo da requisição: **JSON**, com o campo `tipoRefeicao` (texto):

```json
{ "tipoRefeicao": "Almoço" }
```

O valor deve ser o nome da refeição como aparece no plano (ex.: `Café da manhã`, `Lanche`, `Almoço`,
`Pré-treino`, `Janta`); maiúsculas e acentos são ignorados. Se o nome não existir no plano, a
resposta é `404`. Para escolher a refeição ao executar, adicione antes **Escolher do Menu** e passe o
resultado como `tipoRefeicao`. A resposta traz `consumed` e `goal` (calorias e macros do dia).

`GET /api/health/meals/today` retorna o consumido de hoje contra a meta diária.

Da mesma forma, `POST /api/health/generate-diet` e `/generate-workout` aceitam `x-api-token` e
`skip_preview=true` para gerar e salvar direto, sem o modal de revisão.

## Debug e Testes

Na aba **Academia & Água**, o modo de gerenciamento mostra a grade semanal e permite editar as
fichas. O modo foco é ativado automaticamente até 15 minutos antes do próximo horário de treino.
Para testar a interface manualmente, abra o console do navegador (F12) e digite:

```javascript
window.forceFocusMode(true);  // Ativa o modo foco
window.forceFocusMode(false); // Volta para o gerenciamento
```

O valor forçado permanece até a próxima chamada ao comando ou até finalizar o treino.

## Notas

- Autenticação: as rotas protegidas do app exigem `Authorization: Bearer <JWT>`. O `API_TOKEN` inicia a autorização do proprietário em `/api/auth/google?token=...` e autentica o webhook de Atalhos via `x-api-token`.
- Fotos/tabelas: edite `frontend/src/content.ts`. Novas páginas: `frontend/src/config.ts`.
- Atualizações do app: o SW usa rede primeiro para a navegação; se algo ficar preso, aumente `CACHE` em `src/sw.ts`.

### Ciclo de métricas e relatório semanal

A rotina silenciosa do backend verifica diariamente registros de água com mais de 15 dias e reinicia o histórico de água por usuário. O perfil, o peso e os registros de treino permanecem salvos; por isso, a última carga registrada de cada exercício segue como carga inicial do próximo ciclo. Configure `OPENWEATHER_API_KEY` para incluir clima real no briefing.

`GET /api/health/weekly-report` gera feedback com peso, dias de treino e hidratação dos últimos sete dias. No domingo após 21h (horário de Brasília), o servidor também grava o relatório em `weekly_reports`.
