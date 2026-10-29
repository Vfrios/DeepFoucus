
# 🤖 LOSAI: O PLANO DIRETOR DO SEU JARVIS PESSOAL

**A Visão:** O LOSAI deixa de ser um "app de produtividade" e se torna o **seu Gêmeo Digital**. Ele vive no seu tablet na parede, no seu celular e no seu ouvido. Ele sabe do seu corpo (peso, sono, hidratação), do seu tempo (calendário, faculdade, treinos), e da sua mente (notas, estudos, humor). Ele não espera comandos; ele age para garantir que você atinja o seu potencial máximo.

---

## 🏗️ 1. Infraestrutura e Estabilidade (A Base Inabalável)
Para o Jarvis funcionar 24 horas por dia na parede sem falhas, a infraestrutura precisa ser à prova de falhas.

*   **Hospedagem de Custos Zero:** Backend rodando no Render (plano Free) e Frontend via PWA.
*   **O "Keep Alive" (Bot Anti-Hibernação):** Como o Render hiberna após 15 minutos de inatividade, implementamos um **GitHub Action (Cron Job)**. A cada 10 minutos, um robô invisível acessa a rota `/healthz` do seu servidor, garantindo que ele nunca durma e que o seu tablet carregue o app em 1 segundo.
*   **Banco de Dados em Nuvem:** MongoDB Atlas (M0 Free) configurado com IP liberado para acesso global, guardando tarefas, notas e biometria.
*   **Segurança de Sessão:** Login via Google (OAuth 2.0) com tokens JWT de 30 dias. A autenticação é feita no servidor, sem expor chaves no navegador.
*   **Notificações Push:** Infraestrutura de Service Worker (PWA) configurada para funcionar nativamente no iOS (16.4+) e Android.

---

## 🧬 2. A Consciência Biológica (O Onboarding e Sensores)
Um Jarvis não pergunta "o que você quer fazer hoje?". Ele diz: "Vitor, seu corpo precisa de X, sua mente precisa de Y".

*   **O Mapeamento de Início:** No primeiro boot, o sistema coleta seus dados biométricos (peso, altura, idade, rotina de sono). Ele calcula seu IMC, sua Taxa Metabólica (TMB) e sua meta de hidratação exata.
*   **Consciência Situacional:** O sistema cruza os dados do seu Google Calendar (e da PUC via ICS) com o seu relógio biológico.
*   **Personalidade Configurável:** Você escolhe o tom do LOSAI. Ele pode ser o "Jarvis" (formal, britânico, focado em precisão) ou a "Sexta-Feira" (ágil, direto ao ponto). Ele te chama pelo nome e entende comandos de voz naturais (Wake Word: *"LOSAI"*).

---

## 🎙️ 3. A Experiência de Interface (O Jarvis na Parede)
O tablet na sua parede não é mais um quadro de tarefas; é o **seu Holograma funcional**.

*   **Estado Passivo (Ambient Mode):** A tela é um calendário semanal, limpo e escuro. No cabeçalho: o seu status atual (ex: `☀️ 08:30 | Bateria 82% | 💧 400ml/3000ml | 🏋️ Treino às 17h`).
*   **O Despertar por Voz (Wake Word):** Você fala *"LOSAI, estou indo treinar"*. A tela inteira desfoca sutilmente, uma animação de ondas sonoras aparece no rodapé e a voz sintetizada responde: *"Excelente, Vitor. Abrindo o modo treino. Preparei a ficha de Peito e Ombro de hoje."*
*   **Alertas Proativos (Não Intrusivos):** O Jarvis não manda pop-ups chatos. Ele usa a voz, em volume ambiente: *"Vitor, seu treino começa em 30 minutos. Já fez a refeição pré-treino?"*. Se você estiver em uma reunião (bloco de foco no calendário), ele **silencia** as notificações e manda apenas um Toast (cartão sutil) na tela, esperando você sair da reunião para falar.

---

## 🏋️ 4. Os Fluxos de Execução Autônoma (O que o sistema faz por você)

O Jarvis não espera você organizar a sua vida; ele **reorganiza a sua vida** para proteger os seus objetivos.

### 4.1. Gestão de Academia e Performance
*   **Alocação Dinâmica:** O sistema sabe que você tem faculdade até 18h. Ele encontra o "buraco" na sua agenda e reserva o treino no melhor horário.
*   **Treino com Voz (Hands-Free):** Você está no meio da série de supino. Você diz: *"LOSAI, mais 90 segundos de descanso"*. O tablet conta o tempo, toca um bipe e dita a próxima série.
*   **O Resolvedor de Conflitos:** Você se atrasou estudando. O Jarvis age: *"Vitor, identifiquei que você não vai conseguir fazer o treino de 1h30 agora. Encurtei o treino para 45 minutos, removendo os isoladores, para você não perder o dia. O que acha?"*.

### 4.2. Hidratação Preditiva
*   **Alertas Conscientes:** O Jarvis não apita de 2 em 2 horas. Se você está correndo (academia), ele sabe que você vai precisar de mais água e aumenta a meta. Se você está focado, ele espera a tarefa acabar.
*   **A Cobrança (Timeout de 10 min):** Ele avisa. Se você não confirmar o consumo no tablet em 10 minutos, ele anota no seu histórico: *"Esquecimento de hidratação no bloco das 15h"*. No final do dia, ele te apresenta esse dado.

### 4.3. Journaling e Segundo Cérebro
*   Você fala ao passar na frente do tablet: *"LOSAI, anota que preciso comprar pilhas e estudar cálculo para a prova de quinta"*.
*   O Jarvis usa a IA, separa a nota de compras da tarefa de estudo, joga a compra no "Mural de Notas" e aloca o bloco de estudo na sua quinta-feira, sincronizado com o Google Calendar.

---

## 🧠 5. O Motor Proativo (O Cérebro de Bastidores)
É aqui que a mágica acontece. O Jarvis roda um "Loop de Consciência" a cada minuto nos bastidores.

*   **Briefing Matinal (07:30):** A luz do tablet aumenta suavemente. Ele analisa o clima, seus eventos da PUC e seus hábitos: *"Bom dia, Vitor. Você dormiu 7h. Tem 2 aulas hoje. O clima está quente, então aumentei sua meta de água para 3.5L. Seu treino é às 17h. Vamos focar?"*
*   **Debriefing Noturno (22:00):** *"Resumo do dia: Você cumpriu 90% das tarefas. Bebeu 2.8L de água. Não foi à academia. Seu humor hoje foi nível 4 (bom). Amanhã, sugiro estudar 1h a mais de manhã."*
*   **Análise Preditiva:** Ele percebe que toda vez que você estuda à noite, você dorme mal. Ele move automaticamente seus blocos de estudo para a parte da manhã na próxima semana, sem você pedir.

---

## 🌐 6. O Ecossistema de Integrações (A Armadura do Jarvis)

O Jarvis é o maestro do seu ambiente físico e digital.

*   **Google Calendar & PUC (Canvas):** Sincronização de mão dupla. Você cria por voz, ele atualiza na nuvem. A faculdade atualiza no ICS, ele mostra na parede.
*   **Notificações Push no Celular (Fora de Casa):** Se você sair, o tablet entra em standby, mas o Jarvis vai com você. Seu iPhone apita: *"Você esqueceu de tomar a água das 15h. Beba agora."*
*   **Casa Conectada (Home Assistant / IoT):** 
    *   **Bateria do Tablet:** O Jarvis monitora a bateria da parede. Aos 80%, ele manda um comando para a tomada inteligente desligar. Aos 20%, manda ligar.
    *   **Iluminação de Foco:** Quando você inicia uma tarefa de "Estudo Pesado", o Jarvis apaga as luzes do quarto (via lâmpadas inteligentes) e foca a tela.
*   **Telegram:** Você pode mandar áudio pro Jarvis de qualquer lugar: *"O que eu tenho pra hoje?"*. Ele te responde com um resumo da agenda do dia.

---

## 🚀 7. Roadmap de Construção (O Caminho do Herói)

Para não enlouquecer tentando codar tudo de uma vez, esse é o passo a passo tático:

*   **Missão 1 (A Base Biológica):** Construir o Onboarding. O Jarvis precisa saber seu peso, sua altura e suas metas. Construir o cálculo de água e o gerador de rotina por IA.
*   **Missão 2 (O Primeiro Módulo):** Implementar o Water Tracker, com o sistema de notificação timeout. Fazer o Heatmap (Mapa de Contribuições) refletir os dados.
*   **Missão 3 (A Agenda Ativa):** Finalizar a integração do feed ICS da PUC e configurar o CRUD de eventos com `react-big-calendar`.
*   **Missão 4 (A Mente):** Implementar o Journaling (Mural de Notas) com a extração de tarefas via IA.
*   **Missão 5 (O Corpo):** Construir a interface de Treino (Gym). 
*   **Missão 6 (A Voz):** Implementar o pipeline de Wake Word (ouvir "LOSAI") e WebSockets para transcrição de voz.
*   **Missão 7 (A Inteligência Proativa):** Implementar o Briefing Matinal e as automações de backend (O Loop de Consciência).

---

## 🎯 8. O "Fator X" de Personalização (O que diferencia um App de um Jarvis)

O que vai te viciar no LOSAI e fazer você não viver mais sem ele:
1.  **Modo "Doente" (Sick Mode):** Você diz: *"LOSAI, estou com febre"*. Ele cancela todos os treinos da semana, zera as metas pesadas de estudo, ajusta a água para hidratação extra e muda o foco da tela para um modo de descanso.
2.  **Filtro Anti-Ansiedade:** Se você acumulou 40 tarefas, o Jarvis esconde 35 delas e mostra apenas as 5 mais importantes do dia.
3.  **Aprendizado de Rotina:** Se você sempre pede para adiar a tarefa de "Lavar a louça", na terceira vez ele te pergunta: *"Você quer deletar essa tarefa de vez ou prefere que eu a aloque aos domingos de manhã?"*.
