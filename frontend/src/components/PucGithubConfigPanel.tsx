import { FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatSaoPauloDateTime } from '../lib/canvasHtml';

export interface GithubConfigStatus {
  configured: boolean;
  decryptError?: boolean;
  owner: string;
  repo: string;
  branch: string;
  autoPublish: boolean;
  savedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  expiringSoon: boolean;
  expired: boolean;
  authError: 401 | 403 | null;
}

interface PucGithubConfigPanelProps {
  status: GithubConfigStatus | null;
  onSaved: (next: GithubConfigStatus) => void;
  onClose: () => void;
}

function extractErr(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  try {
    const parsed = JSON.parse(err.message) as { error?: string };
    if (parsed?.error) return parsed.error;
  } catch {
    // ignore
  }
  return err.message || fallback;
}

export default function PucGithubConfigPanel({
  status,
  onSaved,
  onClose,
}: PucGithubConfigPanelProps) {
  const [token, setToken] = useState('');
  const [owner, setOwner] = useState(status?.owner || '');
  const [repo, setRepo] = useState(status?.repo || '');
  const [branch, setBranch] = useState(status?.branch || 'main');
  const [expiresAt, setExpiresAt] = useState(
    status?.expiresAt ? status.expiresAt.slice(0, 10) : ''
  );
  const [autoPublish, setAutoPublish] = useState(Boolean(status?.autoPublish));

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!status) return;
    setOwner(status.owner || '');
    setRepo(status.repo || '');
    setBranch(status.branch || 'main');
    setExpiresAt(status.expiresAt ? status.expiresAt.slice(0, 10) : '');
    setAutoPublish(Boolean(status.autoPublish));
  }, [status]);

  const handleTest = async () => {
    if (testing) return;
    setTesting(true);
    setMessage(null);
    try {
      const res = await api<{
        ok: boolean;
        owner: string;
        repo: string;
        branch: string;
        isPrivate: boolean;
      }>('/puc/assistant/github/test', {
        method: 'POST',
        body: JSON.stringify({
          token: token.trim() || undefined,
          owner: owner.trim(),
          repo: repo.trim(),
          branch: branch.trim() || 'main',
        }),
      });
      setMessage({
        kind: 'ok',
        text: `Conexão validada! Repositório privado ${res.owner}/${res.repo} (${res.branch}) com permissão de escrita.`,
      });
    } catch (err) {
      setMessage({
        kind: 'err',
        text: extractErr(err, 'Falha ao testar conexão com o GitHub.'),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await api<{ ok: boolean; config: GithubConfigStatus }>(
        '/puc/assistant/github/config',
        {
          method: 'POST',
          body: JSON.stringify({
            token: token.trim() || undefined,
            owner: owner.trim(),
            repo: repo.trim(),
            branch: branch.trim() || 'main',
            expiresAt: expiresAt ? `${expiresAt}T23:59:59-03:00` : null,
            autoPublish,
          }),
        }
      );
      setToken('');
      setMessage({
        kind: 'ok',
        text: 'Configuração do GitHub privado salva e criptografada (AES-256-GCM).',
      });
      onSaved(res.config);
    } catch (err) {
      setMessage({
        kind: 'err',
        text: extractErr(err, 'Não foi possível salvar a configuração do GitHub.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="puc-ai-box puc-github-panel" aria-label="Configuração do GitHub Privado">
      <div className="puc-ai-head">
        <div>
          <strong>GitHub Privado · Armazenamento de Entregas</strong>
          <p className="puc-subtitle">
            Guarda PDF, Markdown e código das entregas finais em um repositório privado (sem ocupar espaço no Mongo/Render). Nunca envia materiais de curso nem dados do Canvas.
          </p>
        </div>
        <button type="button" className="puc-hide-btn" onClick={onClose}>
          Fechar
        </button>
      </div>

      {status?.configured && (
        <div
          className={`puc-token-banner tone-${
            status.expired || status.authError || status.decryptError
              ? 'danger'
              : status.expiringSoon
                ? 'warn'
                : 'ok'
          }`}
          role="status"
        >
          {status.decryptError ? (
            <strong>Não foi possível descriptografar o token do GitHub (ENCRYPTION_KEY alterada). Cole um novo token.</strong>
          ) : status.authError ? (
            <strong>
              Token do GitHub retornou HTTP {status.authError}. Gere um novo token fine-grained com permissão Contents (Read and write).
            </strong>
          ) : status.expired ? (
            <strong>Token do GitHub expirado. Cole um novo token abaixo.</strong>
          ) : status.expiringSoon ? (
            <strong>
              Atenção: token do GitHub expira em {Math.max(0, status.daysRemaining ?? 0)} dia(s) · {status.owner}/{status.repo} ({status.branch})
            </strong>
          ) : (
            <span>
              Conectado a <strong>{status.owner}/{status.repo}</strong> (branch <code>{status.branch}</code>)
              {status.savedAt ? ` · salvo em ${formatSaoPauloDateTime(status.savedAt)}` : ''}
              {status.daysRemaining !== null ? ` · expira em ${status.daysRemaining} dia(s)` : ''}
            </span>
          )}
        </div>
      )}

      <form className="puc-github-form" onSubmit={(e) => void handleSave(e)}>
        <div className="puc-github-grid">
          <label>
            <span>Token fine-grained (restrito a 1 repo privado · Contents: Read &amp; write)</span>
            <input
              type="password"
              autoComplete="off"
              placeholder={
                status?.configured
                  ? 'Deixe em branco para manter o token salvo...'
                  : 'github_pat_...'
              }
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <label>
            <span>Owner (usuário ou organização)</span>
            <input
              type="text"
              required
              placeholder="ex.: vitoroliveira"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </label>
          <label>
            <span>Repositório (obrigatório ser PRIVADO)</span>
            <input
              type="text"
              required
              placeholder="ex.: puc-entregas"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            />
          </label>
          <label>
            <span>Branch (padrão: main)</span>
            <input
              type="text"
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </label>
          <label>
            <span>Expiração do token (opcional — aviso com 7 dias)</span>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </label>
        </div>

        <label className="puc-hidden-toggle">
          <input
            type="checkbox"
            checked={autoPublish}
            onChange={(e) => setAutoPublish(e.target.checked)}
          />
          <span>Publicar automaticamente no GitHub ao validar entrega (desligada por padrão)</span>
        </label>

        <div className="puc-header-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={testing || !owner.trim() || !repo.trim()}
            onClick={() => void handleTest()}
          >
            {testing ? 'Testando...' : 'Testar conexão'}
          </button>
          <button
            type="submit"
            className="btn"
            disabled={saving || !owner.trim() || !repo.trim() || (!status?.configured && !token.trim())}
          >
            {saving ? 'Validando e salvando...' : 'Salvar configuração'}
          </button>
        </div>

        {message && (
          <p className={`puc-feedback ${message.kind === 'err' ? 'is-error' : 'is-ok'}`} role="alert">
            {message.text}
          </p>
        )}
      </form>
    </section>
  );
}
