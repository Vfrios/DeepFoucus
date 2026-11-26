import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentNotificationPayload,
  buildGroupedAgentSyncPush,
  computeStatementHash,
  detectQuizOrExamSignal,
  evaluateAssignmentEligibility,
  getDefaultAgentConfig,
  MAX_PUSH_BODY_CHARS,
  PucAgentConfig,
  sortCandidatesByDueDate,
} from '../backend/src/lib/pucAgentCore';
import {
  canPublishDeliverable,
  canValidateDeliverable,
  transitionStatusAfterGithubCommit,
  transitionStatusOnEdit,
} from '../backend/src/lib/pucAssistantCore';
import {
  assertDeliverableOnlyFiles,
  assertPendingDeleteOnlyPaths,
  buildDeliverableGithubPaths,
  buildPendingDeliverableGithubPaths,
  publishDeliverableToGithub,
} from '../backend/src/lib/pucGithub';

function makeJsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeEnabledConfig(overrides: Partial<PucAgentConfig> = {}): PucAgentConfig {
  return {
    ...getDefaultAgentConfig(),
    enabled: true,
    paused: false,
    activatedAt: new Date('2026-11-20T00:00:00Z'),
    maxPerSync: 3,
    maxPerDay: 8,
    maxPerWeek: 30,
    overdueToleranceDays: 7,
    ...overrides,
  };
}

const baseCourse = {
  canvas_id: 101,
  name: 'Interação Humano-Computador',
  hidden: false,
  active: true,
  ai_allowed: true,
  has_grades: true,
};

const baseNow = new Date('2026-11-26T12:00:00Z');

const baseAssignment = {
  canvas_id: 5001,
  course_id: 101,
  name: 'Atividade Prática 2',
  description: '<p>Responda as questões 1 a 5 sobre heurísticas de Nielsen.</p>',
  due_at: new Date('2026-12-01T23:59:00Z'),
  points_possible: 10,
  submission_types: ['online_upload'],
  workflow_state: 'unsubmitted',
  created_at: new Date('2026-11-25T10:00:00Z'),
};

test('1. Elegibilidade: ignora quiz por sinal estrutural, mas NÃO descarta "Lista prova 3" (classifica como possível prova)', () => {
  const cfg = makeEnabledConfig();

  // online_quiz
  const q1 = evaluateAssignmentEligibility({
    assignment: { ...baseAssignment, submission_types: ['online_quiz'] },
    course: baseCourse,
    config: cfg,
    now: baseNow,
  });
  assert.equal(q1.outcome, 'ignored');
  assert.equal(q1.reasonCode, 'quiz_or_non_online');
  assert.equal(q1.isPossibleQuiz, false);

  // quiz_id preenchido
  const q2 = detectQuizOrExamSignal({ ...baseAssignment, quiz_id: 999 });
  assert.equal(q2.isHardQuiz, true);
  assert.equal(q2.isPossibleQuiz, false);

  // is_quiz_assignment
  const q3 = detectQuizOrExamSignal({ ...baseAssignment, is_quiz_assignment: true });
  assert.equal(q3.isHardQuiz, true);

  // external_tool com proctoring
  const q4 = detectQuizOrExamSignal({
    ...baseAssignment,
    submission_types: ['external_tool'],
    external_tool_url: 'https://exam.respondus.com/lockdown',
  });
  assert.equal(q4.isHardQuiz, true);

  // locked_for_user sem entrega online
  const q5 = detectQuizOrExamSignal({
    ...baseAssignment,
    locked_for_user: true,
    submission_types: ['on_paper'],
  });
  assert.equal(q5.isHardQuiz, true);

  // tipo none / not_graded
  const q6 = detectQuizOrExamSignal({
    ...baseAssignment,
    submission_types: ['not_graded'],
  });
  assert.equal(q6.isHardQuiz, true);

  // Caso real: "Lista prova 3" com entrega online -> apenas sinal fraco no nome!
  const listaProva3 = evaluateAssignmentEligibility({
    assignment: { ...baseAssignment, name: 'Lista prova 3', submission_types: ['online_upload'] },
    course: baseCourse,
    config: cfg,
    now: baseNow,
  });
  assert.equal(listaProva3.outcome, 'ignored');
  assert.equal(listaProva3.reasonCode, 'possible_quiz');
  assert.equal(listaProva3.isPossibleQuiz, true);
  assert.match(listaProva3.reasonLabel, /possível prova/i);
});

test('2. Elegibilidade: sem prazo, sem pontos, já entregue, vencido há > N dias e override manual', () => {
  const cfg = makeEnabledConfig({ overdueToleranceDays: 7 });

  // Sem prazo
  const noDue = evaluateAssignmentEligibility({
    assignment: { ...baseAssignment, due_at: null },
    course: baseCourse,
    config: cfg,
    now: baseNow,
  });
  assert.equal(noDue.outcome, 'ignored');
  assert.equal(noDue.reasonCode, 'no_due_date');

  // Sem pontos (null ou 0)
  const noPts = evaluateAssignmentEligibility({
    assignment: { ...baseAssignment, points_possible: 0 },
    course: baseCourse,
    config: cfg,
    now: baseNow,
  });
  assert.equal(noPts.outcome, 'ignored');
  assert.equal(noPts.reasonCode, 'no_points');

  // Já entregue no Canvas
  const submitted = evaluateAssignmentEligibility({
    assignment: { ...baseAssignment, workflow_state: 'submitted', submitted_at: new Date('2026-11-25T15:00:00Z') },
    course: baseCourse,
    config: cfg,
    now: baseNow,
  });
  assert.equal(submitted.outcome, 'ignored');
  assert.equal(submitted.reasonCode, 'already_entregue');

  // Override manual de entregue
  const manualSub = evaluateAssignmentEligibility({
    assignment: { ...baseAssignment, manual_submitted_override: true },
    course: baseCourse,
    config: cfg,
    now: baseNow,
  });
  assert.equal(manualSub.outcome, 'ignored');
  assert.equal(manualSub.reasonCode, 'manual_submitted_override');

  // Vencido há mais de 7 dias
  const tooOld = evaluateAssignmentEligibility({
    assignment: { ...baseAssignment, due_at: new Date('2026-11-10T23:59:00Z') },
    course: baseCourse,
    config: cfg,
    now: baseNow,
  });
  assert.equal(tooOld.outcome, 'ignored');
  assert.equal(tooOld.reasonCode, 'overdue_too_old');

  // Vencido há apenas 3 dias (dentro da tolerância de 7 dias) -> elegível!
  const withinTolerance = evaluateAssignmentEligibility({
    assignment: { ...baseAssignment, due_at: new Date('2026-11-23T23:59:00Z') },
    course: baseCourse,
    config: cfg,
    now: baseNow,
  });
  assert.equal(withinTolerance.outcome, 'eligible');
});

test('3. Elegibilidade: idempotência, limites por sync/dia (excedente na fila), gate multi-parte e primeira ativação sem retroativo', () => {
  const cfg = makeEnabledConfig({
    activatedAt: new Date('2026-11-24T00:00:00Z'),
    maxPerSync: 3,
    maxPerDay: 8,
  });

  // Primeira ativação sem retroativo: trabalho criado antes de activatedAt é ignorado
  const retroactive = evaluateAssignmentEligibility({
    assignment: { ...baseAssignment, created_at: new Date('2026-11-20T12:00:00Z') },
    course: baseCourse,
    config: cfg,
    now: baseNow,
  });
  assert.equal(retroactive.outcome, 'ignored');
  assert.equal(retroactive.reasonCode, 'before_activation');

  // Idempotência: já existe entrega ou job ativo
  const dupDeliv = evaluateAssignmentEligibility({
    assignment: baseAssignment,
    course: baseCourse,
    config: cfg,
    now: baseNow,
    hasExistingDeliverable: true,
  });
  assert.equal(dupDeliv.outcome, 'ignored');
  assert.equal(dupDeliv.reasonCode, 'already_generated');

  const dupJob = evaluateAssignmentEligibility({
    assignment: baseAssignment,
    course: baseCourse,
    config: cfg,
    now: baseNow,
    hasActiveJob: true,
  });
  assert.equal(dupJob.outcome, 'ignored');
  assert.equal(dupJob.reasonCode, 'job_in_progress');

  // Gate multi-parte: bloqueado enquanto parte anterior não está corrigida
  const part2Blocked = evaluateAssignmentEligibility({
    assignment: { ...baseAssignment, assignment_kind: 'multi_part', depends_on: 5000 },
    course: baseCourse,
    config: cfg,
    now: baseNow,
    dependsOnAssignment: {
      ...baseAssignment,
      canvas_id: 5000,
      workflow_state: 'submitted',
      submitted_at: new Date('2026-11-24T12:00:00Z'),
    },
  });
  assert.equal(part2Blocked.outcome, 'ignored');
  assert.equal(part2Blocked.reasonCode, 'multipart_gate_blocked');

  // Gate multi-parte liberado quando parte anterior está corrigida
  const part2Unlocked = evaluateAssignmentEligibility({
    assignment: { ...baseAssignment, assignment_kind: 'multi_part', depends_on: 5000 },
    course: baseCourse,
    config: cfg,
    now: baseNow,
    dependsOnAssignment: {
      ...baseAssignment,
      canvas_id: 5000,
      workflow_state: 'graded',
      score: 9.5,
    },
  });
  assert.equal(part2Unlocked.outcome, 'eligible');

  // Limite por sync (3) e por dia (8) -> excedente fica na fila sem perder
  const syncLimit = evaluateAssignmentEligibility({
    assignment: baseAssignment,
    course: baseCourse,
    config: cfg,
    now: baseNow,
    generatedThisSync: 3,
    generatedToday: 3,
  });
  assert.equal(syncLimit.outcome, 'queued');
  assert.equal(syncLimit.reasonCode, 'quota_sync_limit');

  const dayLimit = evaluateAssignmentEligibility({
    assignment: baseAssignment,
    course: baseCourse,
    config: cfg,
    now: baseNow,
    generatedThisSync: 1,
    generatedToday: 8,
  });
  assert.equal(dayLimit.outcome, 'queued');
  assert.equal(dayLimit.reasonCode, 'quota_day_limit');

  // Ordenação da fila prioriza prazo mais próximo
  const sorted = sortCandidatesByDueDate([
    { canvas_id: 1, due_at: new Date('2026-12-10T00:00:00Z') },
    { canvas_id: 2, due_at: new Date('2026-11-28T00:00:00Z') },
    { canvas_id: 3, due_at: new Date('2026-12-01T00:00:00Z') },
  ]);
  assert.deepEqual(
    sorted.map((x) => x.canvas_id),
    [2, 3, 1]
  );

  // Hash de enunciado muda quando texto ou anexo muda
  const h1 = computeStatementHash('<p>Questão 1</p>');
  const h2 = computeStatementHash('<p>Questão 1 e Questão 2</p>');
  assert.notEqual(h1, h2);
});

test('4. Estados e GitHub: gerado em pendentes/, Atualizar GitHub move em 1 commit atômico, falha mantém estado, v<N+1> e bloqueio [PREENCHER]', async () => {
  // 4a. Caminhos em pendentes/
  const pending = buildPendingDeliverableGithubPaths({
    semester: '2026/2',
    courseAcronym: 'IHC',
    assignmentName: 'Lista 1',
    version: 1,
  });
  assert.equal(pending.folderPath, 'pendentes/2026-2/IHC/Lista-1');
  assert.equal(pending.mdPath, 'pendentes/2026-2/IHC/Lista-1/entrega-v1.md');
  assert.equal(pending.pdfPath, 'pendentes/2026-2/IHC/Lista-1/entrega-v1.pdf');
  assert.equal(pending.commitMessage, '[IHC] Lista 1 - gerado (a verificar)');

  assert.doesNotThrow(() =>
    assertDeliverableOnlyFiles(pending.folderPath, [
      { path: pending.mdPath, content: Buffer.from('# Resp') },
    ])
  );
  assert.doesNotThrow(() => assertPendingDeleteOnlyPaths([pending.mdPath, pending.pdfPath!]));
  assert.throws(() => assertPendingDeleteOnlyPaths(['2026-2/IHC/Lista-1/entrega-v1.md']), /segurança/i);

  // 4b. Bloqueio com [PREENCHER] ao tentar marcar verificado
  const blocked = canValidateDeliverable('Resposta 1\n[PREENCHER: nome do grupo]');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.pendingPlaceholders.length, 1);

  const pubBlocked = canPublishDeliverable('validada', 'Resposta [PREENCHER]');
  assert.equal(pubBlocked.allowed, false);

  // 4c. Atualizar GitHub move de pendentes/ para pasta definitiva em 1 único commit atômico
  const finalPaths = buildDeliverableGithubPaths({
    semester: '2026/2',
    courseAcronym: 'IHC',
    assignmentName: 'Lista 1',
    version: 1,
  });

  let createdTrees: any[] = [];
  let createdCommits = 0;
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    if (url.endsWith('/repos/vitor/puc-privado') && method === 'GET') {
      return makeJsonResponse(200, { private: true });
    }
    if (url.endsWith('/git/blobs') && method === 'POST') {
      return makeJsonResponse(201, { sha: `blob_${Math.random().toString(36).slice(2, 8)}` });
    }
    if (url.includes('/git/ref/heads/main') && method === 'GET') {
      return makeJsonResponse(200, { object: { sha: 'head_sha_1' } });
    }
    if (url.endsWith('/git/commits/head_sha_1') && method === 'GET') {
      return makeJsonResponse(200, { tree: { sha: 'base_tree_1' } });
    }
    if (url.endsWith('/git/trees') && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      createdTrees.push(body);
      return makeJsonResponse(201, { sha: 'new_tree_1' });
    }
    if (url.endsWith('/git/commits') && method === 'POST') {
      createdCommits += 1;
      return makeJsonResponse(201, { sha: 'new_commit_sha_1' });
    }
    if (url.includes('/git/refs/heads/main') && method === 'PATCH') {
      return makeJsonResponse(200, { object: { sha: 'new_commit_sha_1' } });
    }
    return makeJsonResponse(404, { message: 'not found' });
  };

  const moved = await publishDeliverableToGithub(
    {
      token: 'ghp_test',
      owner: 'vitor',
      repo: 'puc-privado',
      branch: 'main',
      folderPath: finalPaths.folderPath,
      commitMessage: finalPaths.commitMessage,
      files: [{ path: finalPaths.mdPath, content: Buffer.from('# Entrega verificada', 'utf8') }],
      deletePaths: [pending.mdPath, pending.pdfPath!],
    },
    { fetchImpl: mockFetch, sleepFn: async () => undefined }
  );

  assert.equal(createdCommits, 1, 'Deve criar exatamente 1 commit atômico');
  assert.equal(moved.commitSha, 'new_commit_sha_1');
  assert.deepEqual(moved.deletedPaths, [pending.mdPath, pending.pdfPath!]);
  const treeItems = createdTrees[0].tree as Array<{ path: string; sha: string | null }>;
  assert.ok(treeItems.some((t) => t.path === finalPaths.mdPath && typeof t.sha === 'string'));
  assert.ok(treeItems.some((t) => t.path === pending.mdPath && t.sha === null));
  assert.ok(treeItems.some((t) => t.path === pending.pdfPath && t.sha === null));

  // 4d. Falha de commit mantém o estado anterior ('validada')
  assert.equal(transitionStatusAfterGithubCommit('validada', false), 'validada');
  assert.equal(transitionStatusAfterGithubCommit('validada', true), 'entrega_gerada');

  // 4e. Edição pós-verificado volta para revisada_por_mim e próximo publish gera v<N+1>
  const afterEdit = transitionStatusOnEdit('entrega_gerada', 'v1', 'v2 editada');
  assert.equal(afterEdit, 'revisada_por_mim');
  const v2Paths = buildDeliverableGithubPaths({
    semester: '2026/2',
    courseAcronym: 'IHC',
    assignmentName: 'Lista 1',
    version: 2,
  });
  assert.equal(v2Paths.mdPath, '2026-2/IHC/Lista-1/entrega-v2.md');
  assert.equal(v2Paths.commitMessage, '[IHC] Lista 1 - v2 (validada)');
});

test('5. Notificações Web Push: formato "[SIGLA] ...", tamanho máximo <= 140 chars e agrupamento por sync', () => {
  const n1 = buildAgentNotificationPayload({
    kind: 'novo_trabalho',
    courseAcronym: 'ihc',
    courseId: 101,
    assignmentId: 5001,
    assignmentName: 'Lista 3',
    dueAt: new Date('2026-11-28T23:59:00-03:00'),
    questionsTotal: 25,
    questionsOpen: 3,
    hasCrossword: true,
  });
  assert.equal(n1.title, '[IHC] novo trabalho');
  assert.ok(n1.body.length <= MAX_PUSH_BODY_CHARS);
  assert.match(n1.body, /25 questões/);
  assert.match(n1.body, /28\/11/);
  assert.equal(n1.url, '/?page=puc&courseId=101&assignmentId=5001');

  const n2 = buildAgentNotificationPayload({
    kind: 'a_verificar',
    courseAcronym: 'ESII',
    courseId: 102,
    assignmentId: 5002,
    assignmentName: 'Relatório Arquitetura Muito Longo '.repeat(10),
    dueAt: new Date('2026-12-05T23:59:00-03:00'),
  });
  assert.equal(n2.title, '[ESII] a verificar');
  assert.ok(n2.body.length <= MAX_PUSH_BODY_CHARS);

  const n3 = buildAgentNotificationPayload({
    kind: 'precisa_de_voce',
    courseAcronym: 'AED',
    courseId: 103,
    assignmentId: 5003,
    assignmentName: 'TP1',
    reason: 'Anexo PDF escaneado sem texto extraível',
  });
  assert.equal(n3.title, '[AED] precisa de você');
  assert.ok(n3.body.length <= MAX_PUSH_BODY_CHARS);

  const n4 = buildAgentNotificationPayload({
    kind: 'enunciado_mudou',
    courseAcronym: 'IHC',
    courseId: 101,
    assignmentId: 5001,
    assignmentName: 'Lista 3',
  });
  assert.equal(n4.title, '[IHC] enunciado mudou');
  assert.ok(n4.body.length <= MAX_PUSH_BODY_CHARS);

  // Agrupamento: múltiplos eventos no mesmo sync geram EXATAMENTE 1 push <= 140 chars
  const grouped = buildGroupedAgentSyncPush([
    {
      kind: 'novo_trabalho',
      courseAcronym: 'IHC',
      courseId: 101,
      assignmentId: 5001,
      assignmentName: 'Lista 3',
      dueAt: new Date('2026-11-28T23:59:00-03:00'),
    },
    {
      kind: 'novo_trabalho',
      courseAcronym: 'ESII',
      courseId: 102,
      assignmentId: 5002,
      assignmentName: 'Sprint 2',
      dueAt: new Date('2026-11-29T23:59:00-03:00'),
    },
    {
      kind: 'enunciado_mudou',
      courseAcronym: 'AED',
      courseId: 103,
      assignmentId: 5003,
      assignmentName: 'TP1',
    },
  ]);
  assert.ok(grouped);
  assert.match(grouped!.title, /^\[PUC\] 3 novidades/);
  assert.ok(grouped!.body.length <= MAX_PUSH_BODY_CHARS);
  assert.equal(grouped!.url, '/?page=puc&courseId=101&assignmentId=5001');
});
