import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNextLink } from '../backend/src/lib/canvasApi';
import { decryptCanvasToken, encryptCanvasToken } from '../backend/src/lib/canvasAuth';
import {
  classifyDeliveryStatus,
  generateAutoAliases,
  resolveCoursesByQuery,
} from '../backend/src/lib/canvasUtils';
import {
  makeUniqueZipPath,
  sanitizeFolderPath,
  sanitizeSegment,
  signDownloadToken,
  verifyDownloadToken,
} from '../backend/src/routes/pucDownload';

test('encryptCanvasToken / decryptCanvasToken roundtrip com AES-256-GCM', () => {
  const prevKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  try {
    const secret = '7023~exemploDeTokenCanvasPessoal123456';
    const enc = encryptCanvasToken(secret);
    assert.notEqual(enc.ciphertext, secret);
    assert.equal(enc.iv.length, 24);
    assert.equal(enc.tag.length, 32);
    assert.equal(decryptCanvasToken(enc), secret);
  } finally {
    if (prevKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = prevKey;
  }
});

test('parseNextLink extrai rel="next" do header Link', () => {
  const header =
    '<https://pucminas.instructure.com/api/v1/courses?page=1>; rel="current", ' +
    '<https://pucminas.instructure.com/api/v1/courses?page=2&per_page=100>; rel="next", ' +
    '<https://pucminas.instructure.com/api/v1/courses?page=5>; rel="last"';
  assert.equal(
    parseNextLink(header),
    'https://pucminas.instructure.com/api/v1/courses?page=2&per_page=100'
  );
  assert.equal(parseNextLink('<https://example.com>; rel="prev"'), null);
  assert.equal(parseNextLink(null), null);
});

test('sanitizeSegment e makeUniqueZipPath sanitizam e deduplicam nomes', () => {
  assert.equal(sanitizeSegment('Aula 01: Intro/Resumo?*.pdf', 'arquivo', true), 'Aula 01_ Intro_Resumo__.pdf');

  const longName = `${'a'.repeat(180)}.pdf`;
  const truncated = sanitizeSegment(longName, 'arquivo', true);
  assert.ok(truncated.length <= 150);
  assert.ok(truncated.endsWith('.pdf'));

  assert.equal(sanitizeFolderPath('course/Aula: 1/../Slides'), 'course/Aula_ 1/Slides');

  const used = new Set<string>();
  assert.equal(makeUniqueZipPath(used, 'Curso/_arquivos/Aula 1', 'lista.pdf'), 'Curso/_arquivos/Aula 1/lista.pdf');
  assert.equal(
    makeUniqueZipPath(used, 'Curso/_arquivos/Aula 1', 'lista.pdf'),
    'Curso/_arquivos/Aula 1/lista (2).pdf'
  );
});

test('signDownloadToken / verifyDownloadToken vincula token ao path', () => {
  const prevKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  try {
    const { token } = signDownloadToken('/api/puc/12345/download.zip');
    assert.equal(verifyDownloadToken(token, '/api/puc/12345/download.zip'), true);
    assert.equal(verifyDownloadToken(token, '/api/puc/99999/download.zip'), false);
    assert.equal(verifyDownloadToken(`${token}x`, '/api/puc/12345/download.zip'), false);
  } finally {
    if (prevKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = prevKey;
  }
});

test('classifyDeliveryStatus classifica todos os estados de entrega', () => {
  const now = new Date('2026-11-25T15:00:00Z');
  assert.equal(classifyDeliveryStatus({ excused: true }, now), 'dispensado');
  assert.equal(
    classifyDeliveryStatus({ workflow_state: 'graded', score: 9.5, submission_types: ['online_upload'] }, now),
    'corrigido'
  );
  assert.equal(
    classifyDeliveryStatus({ workflow_state: 'submitted', submitted_at: '2026-11-24T12:00:00Z' }, now),
    'entregue'
  );
  assert.equal(
    classifyDeliveryStatus({ submission_types: ['on_paper'], workflow_state: 'unsubmitted' }, now),
    'sem_entrega_online'
  );
  assert.equal(
    classifyDeliveryStatus({ due_at: '2026-11-20T23:59:00Z', workflow_state: 'unsubmitted', submission_types: ['online_upload'] }, now),
    'atrasado'
  );
  assert.equal(
    classifyDeliveryStatus({ due_at: '2026-12-01T23:59:00Z', workflow_state: 'unsubmitted', submission_types: ['online_upload'] }, now),
    'pendente'
  );
});

test('generateAutoAliases e resolveCoursesByQuery resolvem siglas e duplicados', () => {
  assert.ok(generateAutoAliases('Interação Humano-Computador').includes('IHC'));
  assert.ok(generateAutoAliases('Programação Modular').includes('PM'));
  assert.ok(generateAutoAliases('Algoritmos e Estruturas de Dados II').includes('AED'));

  const courses = [
    { canvas_id: 1, name: 'Interação Humano-Computador', auto_aliases: ['IHC'], aliases: [] },
    { canvas_id: 2, name: 'Programação Modular', auto_aliases: ['PM'], aliases: ['Lab PM'] },
    { canvas_id: 3, name: 'Programação Modular', auto_aliases: ['PM'], aliases: [] },
  ];
  assert.equal(resolveCoursesByQuery(courses, 'ihc').length, 1);
  assert.equal(resolveCoursesByQuery(courses, 'PM').length, 2);
  assert.equal(resolveCoursesByQuery(courses, 'Lab PM')[0].canvas_id, 2);
});
