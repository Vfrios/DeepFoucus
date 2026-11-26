import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeliverableGithubPaths,
  decryptGithubToken,
  encryptGithubToken,
  MAX_GITHUB_FILE_BYTES,
  publishDeliverableToGithub,
  sanitizeGithubRelativePath,
  sanitizeGithubSegment,
  testGithubConnection,
} from '../backend/src/lib/pucGithub';

function makeJsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('1. Montagem do caminho/estrutura e mensagem de commit para entregas com e sem código', () => {
  const withCode = buildDeliverableGithubPaths({
    semester: '2026/2',
    courseAcronym: 'ihc',
    assignmentName: 'Trabalho Prático: Protótipo & Código',
    version: 2,
    codeFiles: [
      { path: 'src/index.ts', language: 'ts', content: 'console.log("ok");' },
      { path: 'README.md', language: 'md', content: '# README' },
    ],
  });

  assert.equal(withCode.folderPath, '2026-2/IHC/Trabalho-Pratico-Prototipo-Codigo');
  assert.equal(withCode.pdfPath, '2026-2/IHC/Trabalho-Pratico-Prototipo-Codigo/entrega-v2.pdf');
  assert.equal(withCode.mdPath, '2026-2/IHC/Trabalho-Pratico-Prototipo-Codigo/entrega-v2.md');
  assert.equal(withCode.zipPath, '2026-2/IHC/Trabalho-Pratico-Prototipo-Codigo/codigo-v2.zip');
  assert.deepEqual(
    withCode.codeFilePaths.map((c) => c.path),
    [
      '2026-2/IHC/Trabalho-Pratico-Prototipo-Codigo/codigo-v2/src/index.ts',
      '2026-2/IHC/Trabalho-Pratico-Prototipo-Codigo/codigo-v2/README.md',
    ]
  );
  assert.equal(withCode.commitMessage, '[IHC] Trabalho Prático: Protótipo & Código - v2 (pronta)');

  const textOnly = buildDeliverableGithubPaths({
    semester: '2026/2',
    courseAcronym: 'ESII',
    assignmentName: 'Resenha Artigo 1',
    version: 1,
  });
  assert.equal(textOnly.zipPath, null);
  assert.equal(textOnly.codeFilePaths.length, 0);
  assert.equal(textOnly.commitMessage, '[ESII] Resenha Artigo 1 - v1 (pronta)');
});

test('2. Sanitização de nomes bloqueia path traversal (..), barras e caracteres inválidos', () => {
  assert.equal(sanitizeGithubSegment('../segredo/..\\teste?:*<>|', 'fallback'), 'segredo-teste');
  assert.equal(sanitizeGithubSegment('..', 'fallback'), 'fallback');
  assert.equal(sanitizeGithubSegment('Relatório Final (v1) #2?.pdf', 'doc', true), 'Relatorio-Final-v1-2.pdf');

  const rel = sanitizeGithubRelativePath('../../etc/passwd\\..\\src//App*.tsx');
  assert.ok(!rel.includes('..'));
  assert.ok(!rel.startsWith('/'));
  assert.equal(rel, 'etc/passwd/src/App.tsx');
});

test('3. Recusa de repositório público e aprovação de repositório privado gravável', async () => {
  const publicFetch: typeof fetch = async () =>
    makeJsonResponse(200, {
      private: false,
      default_branch: 'main',
      html_url: 'https://github.com/user/public-repo',
      permissions: { push: true, admin: true },
    });

  await assert.rejects(
    () =>
      testGithubConnection(
        { token: 'github_pat_fake', owner: 'user', repo: 'public-repo', branch: 'main' },
        { fetchImpl: publicFetch }
      ),
    /público recusado/i
  );

  const privateFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/repos/user/private-repo')) {
      return makeJsonResponse(200, {
        private: true,
        default_branch: 'main',
        html_url: 'https://github.com/user/private-repo',
        permissions: { push: true, admin: false },
      });
    }
    return makeJsonResponse(200, { object: { sha: 'abc1234' } });
  };

  const ok = await testGithubConnection(
    { token: 'github_pat_fake', owner: 'user', repo: 'private-repo', branch: 'main' },
    { fetchImpl: privateFetch }
  );
  assert.equal(ok.isPrivate, true);
  assert.equal(ok.permissions.push, true);
});

test('4. Retry automático em conflito de SHA (422) reutilizando blobs e recusa acima de 50 MB', async () => {
  let blobCalls = 0;
  let patchCalls = 0;
  let headCalls = 0;

  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || 'GET';

    if (method === 'GET' && url.endsWith('/repos/vitor/puc-privado')) {
      return makeJsonResponse(200, { private: true });
    }
    if (method === 'POST' && url.endsWith('/git/blobs')) {
      blobCalls += 1;
      return makeJsonResponse(201, { sha: `blob-sha-${blobCalls}` });
    }
    if (method === 'GET' && url.includes('/git/ref/heads/main')) {
      headCalls += 1;
      return makeJsonResponse(200, { object: { sha: `head-sha-${headCalls}` } });
    }
    if (method === 'GET' && url.includes('/git/commits/')) {
      return makeJsonResponse(200, { tree: { sha: `tree-base-${headCalls}` } });
    }
    if (method === 'POST' && url.endsWith('/git/trees')) {
      return makeJsonResponse(201, { sha: `tree-new-${headCalls}` });
    }
    if (method === 'POST' && url.endsWith('/git/commits')) {
      return makeJsonResponse(201, { sha: `commit-new-${headCalls}` });
    }
    if (method === 'PATCH' && url.includes('/git/refs/heads/main')) {
      patchCalls += 1;
      if (patchCalls === 1) {
        return makeJsonResponse(422, { message: 'Update is not a fast forward' });
      }
      return makeJsonResponse(200, { object: { sha: `commit-new-${headCalls}` } });
    }
    return makeJsonResponse(404, { message: `unexpected ${method} ${url}` });
  };

  const res = await publishDeliverableToGithub(
    {
      token: 'github_pat_fake',
      owner: 'vitor',
      repo: 'puc-privado',
      branch: 'main',
      folderPath: '2026-2/IHC/Trabalho-1',
      commitMessage: '[IHC] Trabalho 1 - v1 (pronta)',
      files: [
        { path: '2026-2/IHC/Trabalho-1/entrega-v1.pdf', content: Buffer.from('%PDF-1.4 test') },
        { path: '2026-2/IHC/Trabalho-1/entrega-v1.md', content: Buffer.from('# Entrega 1') },
      ],
    },
    { fetchImpl: mockFetch, sleepFn: async () => undefined }
  );

  assert.equal(res.retriesUsed, 1);
  assert.equal(res.commitSha, 'commit-new-2');
  assert.equal(blobCalls, 2, 'blobs devem ser criados apenas 1x e reutilizados no retry');
  assert.equal(patchCalls, 2);

  // Recusa de arquivo acima de 50 MB sem fazer chamada de rede
  await assert.rejects(
    () =>
      publishDeliverableToGithub(
        {
          token: 'github_pat_fake',
          owner: 'vitor',
          repo: 'puc-privado',
          branch: 'main',
          folderPath: '2026-2/IHC/Grande',
          commitMessage: '[IHC] Grande - v1 (pronta)',
          files: [{ path: 'grande.zip', content: Buffer.alloc(MAX_GITHUB_FILE_BYTES + 1) }],
        },
        {
          fetchImpl: async () => {
            throw new Error('não deveria chamar fetch para arquivo > 50 MB');
          },
        }
      ),
    /excede o limite de 50 MB/i
  );
});

test('5. Criptografia AES-256-GCM do token GitHub: roundtrip e rejeição de adulteração', () => {
  const prevKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  try {
    const raw = 'github_pat_11ABCDE_exemploSeguroDeTokenFineGrained123456';
    const enc = encryptGithubToken(raw);
    assert.notEqual(enc.ciphertext, raw);
    assert.equal(enc.iv.length, 24);
    assert.equal(enc.tag.length, 32);
    assert.equal(decryptGithubToken(enc), raw);

    // Adulteração da auth tag deve falhar
    const tampered = { ...enc, tag: enc.tag.slice(0, -2) + (enc.tag.endsWith('ff') ? '00' : 'ff') };
    assert.throws(() => decryptGithubToken(tampered));
  } finally {
    if (prevKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = prevKey;
  }
});
