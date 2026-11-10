# 🤖 PLANO DIRETOR: LOSAI (O SEU JARVIS PESSOAL)

**A Visão:** O LOSAI não é um aplicativo. É um **Sistema Operacional Pessoal e Proativo** que vive na sua parede (Android) e no seu bolso (iOS). Ele cruza dados biológicos, de localização, financeiros e de produtividade para otimizar a sua rotina sem que você precise pedir. A comunicação flui de forma invisível, segura e sem custos de API de terceiros.

---

## 🏗️ 1. Infraestrutura e Estabilidade (A Base Inabalável)

* **Keep Alive (Bot Anti-Hibernação):** Uso de GitHub Actions (Cron Job) pingando a rota `/healthz` do servidor a cada 10 minutos. O sistema nunca dorme no Render (Plano Free).
* **Banco de Dados Híbrido:** MongoDB Atlas (nuvem) para dados estruturados e integração local via Home Assistant (opcional) para automações físicas.
* **Segurança:** Login único via Google (OAuth 2.0), com sessões JWT de 30 dias e rotas de Webhook protegidas por chaves privadas.

---

## 📱 2. Comunicação Universal e Contexto (O Modelo de Dois Dispositivos)

O sistema abandona o uso de WhatsApp/Evolution API (evitando custos de chip e banimentos) e adota a arquitetura **"Dois Dispositivos, Um Cérebro"**. O Android é o *Main Frame* (em casa), e o iOS é o *Terminal Remoto* (na rua).

### 2.1. O "Chatbot" Nativo no iPhone (iOS Shortcuts)

* **Como funciona:** Você usa o app **Atalhos** do iPhone como o seu painel de controle. Um toque no Widget abre um menu nativo (idêntico aos bancos): `[ Finanças ]`, `[ Agenda ]`, `[ Saúde ]`, `[ Lista de Compras ]`.
* **A Execução:** O Atalho faz uma requisição invisível para o backend e exibe a resposta na tela (texto, alerta ou download de arquivo).
* **Vantagem:** Custo zero, sem risco de banimento e integração com a Siri (*"Siri, abrir atalho Fatura Atual"*).

### 2.2. E-mail (O "Gatilho" Financeiro)

* O backend monitora uma caixa de e-mail via IMAP. Você encaminha notas fiscais e o Jarvis extrai os dados (valor, estabelecimento) e lança na planilha automaticamente.

### 2.3. Sincronização de Contexto (State Sync)

* **Android (Parede):** Envia sinal de vida via Fully Kiosk.
* **iOS (Geofencing):** Quando você sai de casa, o iOS avisa o backend. O status muda para `is_home: false`. O Jarvis silencia as notificações de voz no Android e começa a enviar Push Notifications para o seu iPhone.

---

## 💸 3. Finanças Inteligentes (Open Finance + Google Sheets + iOS + Splitwise)

O controle financeiro une a captura automática, a categorização por IA e um sistema visual de **divisão de despesas por responsável** (estilo Splitwise), com geração de relatórios em Excel.

### 3.1. A Estrutura de Dados (As Planilhas)

O arquivo `LOSAI_Financas_2026` é dividido em 3 abas:

* **Aba 1 - `[01] Interacoes_iOS`:** Captura rápida. Colunas: Data/Hora, Estabelecimento, Valor, **Responsável** (Vitor, Sophia, Mãe, Dividido) e Local (GPS).
* **Aba 2 - `[02] Meu_Cartao`:** Consolidado via Open Finance (Pluggy), limpo pela IA.
* **Aba 3 - `[03] Cartao_Dela`:** Consolidado do cartão da sua namorada.

### 3.2. O Motor de IA e a Lógica de Divisão

* A IA categoriza os gastos em 12 categorias fixas (Gasolina, Mercado, iFood, etc.).
* A IA sugere o responsável com base no estabelecimento (ex: Zara = Sophia, Shell = Vitor), mas você pode corrigir no momento do gasto pelo iOS.

### 3.3. A Geração de Relatórios (O Diferencial Splitwise)

No Atalho do iOS **"Central Financeira"**, o backend gera os arquivos:

* **Gastos Gerais do Mês (Excel):** Gera um `.xlsx` com as 3 abas consolidadas. **Diferencial:** A Aba 1 (`[01] Interacoes_iOS`) vem com uma **Tabela Dinâmica (Pivot Table)** configurada, mostrando o resumo de divisões:
  * *Vitor: R$ 1.500,00*
  * *Sophia: R$ 600,00*
  * *Mãe: R$ 500,00*
  * *Total Fatura: R$ 2.600,00*
* **Fatura Atual (Alerta):** Retorna um texto: *"💳 Total: R$ 2.600 (Vitor: R$ 1.500, Sophia: R$ 600, Mãe: R$ 500)"*.
* **Filtro por Responsável:** Um menu no Atalho permite baixar um `.csv` contendo apenas os gastos de uma pessoa específica (ex: só os gastos da Sophia).
* **Meu Cartão / Cartão Dela:** Download das abas 2 e 3 separadamente.

### 3.4. Open Finance (Pluggy) e Privacidade

* **Reconciliação:** Um Cron Job noturno conecta na Pluggy (Open Finance) e cruza os dados da Aba 2 e 3 com o que foi capturado no iOS (Aba 1), garantindo que nada fique de fora.
* **Modo Discreto:** No painel da parede, os valores exatos (R$ 2.600) são ocultados por padrão. O Jarvis mostra apenas os gráficos. Você usa o comando de voz *"Jarvis, mostrar valores"* para revelar.

---

## 📍 4. Geolocalização e Automação de Rotina (Geofencing)

O celular atua como sensor. Através do app Atalhos, ele envia gatilhos silenciosos para o backend.

* **Cerca Virtual (Geofence):** Quando você sai da PUC, o iOS envia suas coordenadas. O backend cruza: `[Gatilho: Saiu da PUC] + [Condição: Quinta-feira, 21h] + [Ação: Avisar namorada]`.
* **Cálculo de ETA:** O backend consulta a API do Google Maps, calcula o trânsito e dispara uma mensagem automática para quem você quiser.
* **Múltiplos Pontos:** Se você passar por pontos específicos no trajeto, o sistema atualiza o status no Home Assistant (ex: acender a luz da sala quando você estiver a 2km de casa).

---

## 🍲 5. Nutrição e Rotina Doméstica (Meal Prep)

O Android é o **Inventário e Chef**; o iOS é o **Scanner**.

* **Lista de Compras Bidirecional:**
  * **iOS → Android:** Você adiciona um item via Widget no iPhone. O backend avisa o Android via WebSocket, e o tablet atualiza a tela no mesmo segundo.
  * **Android → iOS:** Você está no mercado, abre o Atalho "Ver Lista" e o iOS exibe a lista completa na tela. Você marca o que comprou e o Android risca o item na parede.
* **Meal Prep Contextual:** Se você falar "Vou fazer frango ao creme", o Jarvis verifica o inventário. Se faltar algo, ele adiciona à lista e avisa no iPhone.
* **Lembretes de Preparo:** Se o Android detectar que você está em um bloco de foco (Pomodoro), ele espera terminar para avisar: *"Foco encerrado, hora de preparar o almoço."*

---

## 🎙️ 6. Interface e Contexto (Android vs. iOS)

* **No Android (Parede):** O **Holograma Funcional**. Tela sempre ligada, calendário semanal, ficha de treino, status da água e notificações por voz.
* **No iOS (Pessoal):** O **Controle Remoto**. Não tem tela cheia; atua via Widgets e Atalhos. Quando você sai de casa, o Android silencia as notificações e o iOS recebe os alertas no seu bolso.

---

## 🏋️ 7. Consciência Biológica (Saúde, Academia e Sono)

* **Onboarding:** Feito na tela do Android (ou iOS). Você insere peso, altura e metas. A IA gera a rotina semanal e sincroniza com o Google Calendar.
* **Água e Hidratação Preditiva:** No Android, a cada 60 min, o Jarvis avisa por voz. No iOS (rua), você recebe Push. Se não confirmar em 10 min, o sistema marca "falha de hidratação".
* **Academia:** No Android, a tela vira a ficha de treino com cronômetro por voz. No iOS (academia externa), você usa um Atalho "Iniciar Treino" e o iOS controla a música e o timer. Ao chegar em casa, o Android registra o treino no Heatmap.
* **Sick Mode:** Você fala no iOS "Estou doente". O Android escurece, pausa os treinos e exibe uma mensagem de recuperação.

---

## 🧠 8. O Motor Proativo (Briefing, Debriefing e Journaling)

O cérebro roda no backend, mas a comunicação se adapta ao dispositivo.

* **Briefing Matinal (07:30):** Se você está em casa, o Android acende a tela e fala por voz. Se você já saiu, o iPhone recebe um Push com o resumo do dia (aulas, trânsito, água).
* **Debriefing Noturno (22:00):** O Jarvis exibe o resumo do dia (tarefas cumpridas, água). No iOS, se você estiver fora, chega como notificação final.
* **Journaling:** No Android (casa), você digita. No iOS (rua), você usa o botão "Compartilhar" do iPhone para enviar a nota direto para o banco do Jarvis.
* **Sincronização Real:** O backend usa a flag `is_home` (via Geofencing) para decidir se os alertas de voz saem no tablet ou no celular, garantindo que a casa vazia não fique "gritando" notificações.

---

## 🧑‍💻 9. Roadmap de Implementação (O Caminho do Herói)

* **Missão 1 (A Fundação):** Onboarding, cálculo biológico e IA de rotina.
* **Missão 2 (O Foco e Água):** Water Tracker com sistema de timeout e pomodoro integrado.
* **Missão 3 (O Mestre da Agenda):** CRUD de eventos do `react-big-calendar` e integração com o feed da PUC.
* **Missão 4 (O Cofre Financeiro e Splitwise):** Configurar o Google Sheets, a categorização por IA, os Atalhos do iOS (captura e download) e a Tabela Dinâmica de divisões por responsável.
* **Missão 5 (Comunicação Remota):** Criação do menu de Atalhos no iOS (agenda, finanças, saúde) e integração com Geofencing.
* **Missão 6 (A Voz):** Pipeline de transcrição de áudio local na parede (Android).
* **Missão 7 (A Consciência):** Automações via Home Assistant e o motor proativo (Briefing/Debriefing).
