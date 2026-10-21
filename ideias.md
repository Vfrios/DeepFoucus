Contexto:
- O app "Wall Dashboard" usa o `react-big-calendar` na visão Semanal (`PageWeekCalendar.tsx`).
- O calendário renderiza apenas um bloco fixo (08h às 19h) sem scroll.
- Queremos que o calendário mostre as 24 horas, com scroll independente, e que já abra focado no horário atual.
- A linha do tempo atual (Current Time Line) deve ser **sutil e elegante**, no estilo Notion Calendar, sem quebrar o visual dark do app.

TAREFAS:

### 1. Configuração do `react-big-calendar` (PageWeekCalendar.tsx)
- Garantir que o calendário mostre todas as 24 horas:
  - `min={new Date(0, 0, 0, 0, 0, 0)}` (00:00)
  - `max={new Date(0, 0, 0, 23, 59, 59)}` (23:59)
  - `step={30}` e `timeslots={2}` (para linhas de meia em meia hora)
  - Remover qualquer `scrollToTime` que esteja limitando a tela.

### 2. Habilitar o Scroll Vertical (CSS)
- No `styles.css`, sobrescrever as classes do RBC:
  - `.rbc-time-content` deve ter `overflow-y: auto !important;` e `max-height: 100%;`.
  - `.rbc-time-view` deve ter `height: 100%; display: flex; flex-direction: column;`.
  - A coluna de horas (`.rbc-time-gutter`) deve ser fixa (sticky) no topo.
  - **Esconder a barra de rolagem padrão** e estilizar uma fina (6px), cor `var(--line)`, com `border-radius: 3px`.

### 3. Scroll Automático para a Hora Atual (Smart Scroll)
- No `PageWeekCalendar.tsx`, usar `useEffect` com uma `ref` apontando para o `.rbc-time-content`:
  - Ao montar, calcular a hora atual (ex: 14h30).
  - Calcular a posição em pixels baseada na altura dos slots de 30 min.
  - Executar `scrollTo({ top: alturaCalculada, behavior: 'smooth' })` para abrir focado na hora atual.
  - Se estiver em Modo LOCK (Parede), manter a tela sempre focada na hora atual (ou atualizar automaticamente quando o tempo passar).

### 4. Linha do Tempo (Current Time Indicator) SUTIL
- **Não usar vermelho vibrante.** A linha deve ser discreta e elegante.
- Especificação visual:
  - Cor base: `var(--accent)` (verde-água do app) ou `#e67c73` (um vermelho suave / terracota).
  - Espessura: `1px`.
  - A bolinha na ponta da linha deve ser pequena (4px de diâmetro) e ter a mesma cor.
  - A linha não deve brilhar (sem `box-shadow`).
  - O fundo do indicador (se houver) deve ser transparente.
- No CSS, sobrescrever:
  ```css
  .rbc-current-time-indicator {
    background-color: var(--accent); /* ou terracota */
    height: 1px;
    z-index: 5;
  }
  .rbc-current-time-indicator::before {
    content: '';
    display: inline-block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background-color: var(--accent);
    position: absolute;
    left: -2px;
    top: -1.5px;
  }
