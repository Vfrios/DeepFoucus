
# Refact

## Fases

### FASE 1: O Novo Banco e a API Base (IA e Calendário)

```markdown
Contexto:
Estamos refatorando o "Wall Dashboard". Precisamos atualizar o backend para suportar um sistema rico de tarefas/eventos e preparar a Inteligência Artificial para atuar em todas as telas do app.

TAREFAS (Backend):
1. Atualizar o Schema do MongoDB (coleção `tasks`):
   - `titulo`, `descricao`, `tipo` ('tarefa' | 'evento' | 'estudo'), `inicio` (Date), `fim` (Date), `feito` (boolean), `googleEventId` (string).
   - Criar a coleção `notes` (para a Página 5): `{ _id, titulo, conteudo, cor, criadoEm }`.

2. Atualizar o `backend/src/lib/ai.ts` (Motor de IA):
   - A IA deve ser genérica o suficiente para receber um prompt de sistema e um input, e devolver JSON.
   - Manter o sistema de fallback (Groq > Gemini > OpenRouter).
   - Criar duas funções exportáveis:
     a) `gerarTarefasIA(prompt)`: Retorna array de tarefas/eventos com os campos acima.
     b) `gerarInsightIA(dadosEstatisticas)`: Recebe os números do heatmap e retorna um texto curto e motivacional analisando a produtividade do usuário.

3. Atualizar `backend/src/routes/tasks.ts`:
   - CRUD completo com os novos campos.
   - Integração bidirecional com Google Calendar: ao criar/editar/excluir uma tarefa do tipo 'evento', atualizar no Google usando a função `createCalendarEvent`.
```

---

### FASE 2: Página 1 - Calendário Focado (Hoje e Amanhã)

```markdown
Contexto:
No frontend, a Página 1 (PageCalendar.tsx) vai virar o "Centro do Dia". Ela deve mostrar apenas Hoje e Amanhã, e ter IA para criação rápida.

TAREFAS:
1. Layout da Página 1:
   - Dividir a tela em 2 colunas (ou blocos): "Hoje" e "Amanhã".
   - Buscar os dados de `/api/tasks` e filtrar apenas esses dois dias.
   - Exibir os itens com: Horário (ex: 14h - 15h), Título, e uma tag colorida indicando o tipo (Ex: Estudo = Laranja, Evento = Azul).
   - Se estiver vazio, mostrar um card convidando a usar a IA.

2. Integração com IA (Criação Rápida):
   - No topo da página, adicionar um input de linguagem natural: 
     Placeholder: "Ex: Reunião amanhã às 14h com a equipe..."
   - Ao enviar, chamar a IA (rota `/from-roteiro`), que vai criar o evento no banco e no Google Calendar. Atualizar a tela sem recarregar.
```

---

### FASE 3: Página 2 - CRUD Completo (Agenda/Notion)

```markdown
Contexto:
A Página 2 (PageTasks.tsx) será a agenda completa. Queremos visual de calendário, controle de tempo e integração com IA para edição.

TAREFAS:
1. Formulário de Criação/Edição:
   - Modal com: Título, Tipo (select), Início (datetime-local), Fim (datetime-local), Descrição.
   - Botão "Salvar com IA" (opcional): A IA pega a descrição e sugere um título melhor e um tipo.

2. Listagem de Tarefas (Timeline):
   - Agrupar as tarefas por dia (ex: "Hoje", "Amanhã", "Sexta-feira").
   - Mostrar barra colorida lateral indicando o tipo.
   - Botões de editar e excluir.
   - Checkbox para marcar como concluído (e sincronizar com o Google).

3. Área de IA da Página 2:
   - Manter o campo de gerar várias tarefas por texto ("Cole seu roteiro de estudos...").
   - Antes de salvar, mostrar um modal de "Preview" com o que a IA gerou, permitindo editar antes de confirmar.
```

---

### FASE 4: Página 3 - Progresso Inteligente (Insights)

```markdown
Contexto:
A Página 3 (PageStats.tsx) deve deixar de ser apenas um Heatmap e se tornar um painel de BI (Business Intelligence) com insights da IA.

TAREFAS:
1. UI da Página 3:
   - Manter o Heatmap do GitHub no topo.
   - Adicionar 2 cartões de destaque: "Horas Focadas na Semana" e "Meta Semanal (%)".
   - Adicionar um gráfico de barras ou pizza (CSS puro) mostrando a divisão de tempo: % Estudo, % Eventos, % Tarefas.

2. O Diferencial de IA:
   - Abaixo dos gráficos, adicionar um bloco "Análise da IA".
   - O frontend envia os dados do heatmap e dos gráficos para o backend.
   - O backend chama `gerarInsightIA()`, que retorna um parágrafo curto (ex: "Você está indo bem em estudos, mas seus eventos estão consumindo muito tempo. Tente focar em 2h de estudo amanhã.").
   - Exibir esse texto com um ícone de "Robô" ou "Estrela".

3. Backend:
   - Rota `GET /api/stats/insights` que já retorna os gráficos E o texto da IA.
```

---

### FASE 5: Página 4 (Tabelas/Notas) e Página 5 (Fotos)

```markdown
Contexto:
Reformular as últimas páginas. A antiga página de fotos será removida e a de tabelas será transformada em um sistema de notas com IA.

TAREFAS:
1. Remover Página de Fotos:
   - Excluir `PagePhotos.tsx` e remova do `config.ts`.

2. Transformar Tabelas em "Notas & Quadro" (PageNotes.tsx):
   - UI: Um mural estilo Trello (CSS Grid) com cartões coloridos.
   - Criar formulário rápido para adicionar uma nota (título e texto).
   - Integração com IA: Adicionar um botão "Organizar Notas". A IA lê todas as notas e devolve um resumo ou sugere tarefas a partir delas. (Se sugerir tarefas, o usuário pode importar para a Página 2).
   - Backend: Rotas CRUD para `/api/notes` e rota `/api/notes/summarize` usando a IA.
```

---
