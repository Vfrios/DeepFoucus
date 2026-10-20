Contexto do projeto:
- O app "Wall Dashboard" possui um sistema de páginas navegáveis horizontalmente usando `embla-carousel-react` (arquivo `frontend/src/components/Pager.tsx` e hook `frontend/src/hooks/usePager.ts`).
- O indicador atual (Dots.tsx) mostra apenas a posição horizontal (1D).
- A configuração das páginas está em `frontend/src/config.ts` (um array linear).

Objetivo:
Transformar a navegação para um **Grid 2D (Matriz)**. O usuário poderá arrastar para a esquerda/direita (mudar de coluna) e para cima/baixo (mudar de linha). O pager deve ter comportamento de **Loop Infinito** ao chegar no fim das linhas e colunas.

### ETAPA 1: Atualizar a Configuração de Páginas
1. Em `frontend/src/config.ts`, alterar o array `pages` para incluir uma propriedade `row` (número da linha, ex: 1 ou 2).
   - Linha 1: Calendário, Tarefas, Progresso (Fase 2), Fotos.
   - Linha 2: Calendário Mensal (novo componente placeholder), Tabelas, e novos espaços (podem ser placeholders vazios por enquanto).
   - Exemplo: `{ id: 'calendar', title: 'Calendário', component: PageCalendar, mobile: true, row: 1 }`.

### ETAPA 2: Criar o Pager 2D (Matriz)
1. No `Pager.tsx`, em vez de usar um único `useEmblaCarousel` (horizontal), precisamos de uma estrutura CSS Grid.
   - O container principal deve ser um `grid` com `grid-template-columns: repeat(N, 100vw)` e `grid-template-rows: repeat(M, 100vh)`.
   - O scroll deve ser gerenciado via `scroll-snap-type: both mandatory` (no CSS) para permitir o "snap" tanto na horizontal quanto na vertical (isso é nativo do navegador e funciona muito bem).
   - *Alternativa com Embla:* Se preferir continuar com o Embla, crie dois EmblaCarousels aninhados (um vertical envolvendo um horizontal), mas o CSS Scroll Snap nativo é mais leve e mais fácil de implementar rolagem infinita.

### ETAPA 3: Indicador de Posição (Dots 2D)
1. Atualizar o `Dots.tsx` para mostrar uma grade de bolinhas (ex: 2 linhas de 4 bolinhas).
2. A bolinha da página atual deve ficar destacada (cor --accent).
3. O usuário deve poder clicar numa bolinha para pular direto para aquela tela (ex: clicar na bolinha da linha 2, coluna 3).

### ETAPA 4: Rolagem Infinita
1. Se o usuário estiver na última página da linha 1 e deslizar para a direita, ele deve voltar para a primeira página da linha 1.
2. Se estiver na primeira página e deslizar para a esquerda, vai para a última.
3. O mesmo comportamento para as linhas (vertical).

### ETAPA 5: Novos Componentes
1. Criar um placeholder `frontend/src/components/PageMonthCalendar.tsx` (Apenas um título "Calendário Mensal" e um grid de dias para preencher a linha 2).
2. Criar placeholders (ex: "Finanças", "Hábitos") se precisar preencher os buracos na matriz.

### Regras Gerais:
- Manter o Modo LOCK (travar a tela) funcionando. Se travar numa tela, o usuário não consegue nem rolar para os lados, nem para cima/baixo.
- Manter o visual dark e os estilos atuais.
- O código do CSS deve ser preferencialmente `scroll-snap` nativo para garantir 60fps em tablets antigos.
