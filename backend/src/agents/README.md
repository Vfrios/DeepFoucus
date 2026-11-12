# Agentes LOSAI

Maestro roda às 06:00 e Tutor às 06:05 em America/Sao_Paulo. O processo precisa estar ativo nesses horários; o blueprint atual usa Render free. Para execução pontual sem supervisão, use infraestrutura que permaneça ativa. Não há execução retroativa ao iniciar o servidor.

Configuração: MONGODB_URI, HEALTH_API_EMAIL (fallback EMAIL_VITOR), Google OAuth já conectado e pelo menos uma chave GROQ_API_KEY, GEMINI_API_KEY ou OPENROUTER_API_KEY. Push usa as variáveis VAPID existentes. O email deve corresponder ao proprietário da conta Google compartilhada.

`puc_events` ainda não possui importador neste repositório. A leitura aceita `tipo`/`type` com `prova`, `exam` ou `exame`; data em `inicio`/`start`/`data`/`date` como ISO ou Date BSON. Data sem hora representa o dia em São Paulo. Registros com email pertencem ao proprietário; sem email são do calendário PUC compartilhado. Janela de planejamento: hoje e próximos 14 dias. Sem provas confirmadas, não se deve modificar a rotina.

O motor limita a cinco respostas da IA por execução, executa ferramentas em sequência e registra resumos de decisão, ações e erros. Não solicita raciocínio interno detalhado. As tarefas de estudo são locais, visíveis na agenda LOSAI; não são duplicadas no Google. Blocos automáticos têm uma hora, começam em meias horas entre 07:00 e 23:00 e respeitam a PUC, Google e tarefas locais.

Treinos são identificados pela coleção `workouts` e seus campos existentes `calendarEventId` e `agendadoPara`. Somente eventos únicos de uma hora são movidos. O plano semanal permanece; `agentOriginalDate` e `agendadoPara` controlam a exceção no agendador de sessões. Eventos recorrentes e durações diferentes ficam para ajuste manual.

Travas são inseridas atomicamente com chave por agente, proprietário e dia. Liberar significa marcar conclusão, nunca excluir o registro diário. Falhas também consomem a execução do dia para evitar repetir efeitos externos. TTL limpa registros antigos após sete dias. Não se deve apagar uma trava para tentar novamente sem verificar efeitos anteriores.

Nenhum sistema pode garantir ausência total de falhas externas. Se MongoDB estiver indisponível, a execução agendada é bloqueada e o erro vai para o console; gravar em `agent_logs` durante essa indisponibilidade é impossível. Google e MongoDB não compartilham transação: falhas entre reagendamento e persistência exigem conferir o evento e o log antes de intervenção manual. Testes usam dependências simuladas; não modificam serviços reais.

Referência do cron: https://www.nodecron.com/scheduling-options.html
