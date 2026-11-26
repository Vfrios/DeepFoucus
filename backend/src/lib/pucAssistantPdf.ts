import PDFDocument from 'pdfkit';
import { ZipArchive } from 'archiver';
import { formatSaoPauloDateTime } from './canvasUtils';
import { ExtractedCodeFile, extractCodeFilesFromMarkdown } from './pucAssistantCore';

export interface DeliverablePdfInput {
  courseName: string;
  assignmentName: string;
  studentName: string;
  groupMembers?: string[];
  markdown: string;
  generatedAt?: Date;
}

// Margens ABNT aproximadas em pontos (1 cm ≈ 28.3465 pt): sup/esq 3cm (85pt), inf/dir 2cm (57pt)
const ABNT_MARGIN_TOP = 85;
const ABNT_MARGIN_LEFT = 85;
const ABNT_MARGIN_BOTTOM = 57;
const ABNT_MARGIN_RIGHT = 57;

function cleanInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .trim();
}

function buildAuthorList(studentName: string, groupMembers: string[] = []): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  const pushUnique = (name: string) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(trimmed);
  };

  pushUnique(studentName);
  for (const m of groupMembers) pushUnique(m);
  return list.length > 0 ? list : ['Aluno(a) PUC Minas'];
}

/**
 * Gera PDF formatado em padrão ABNT básico 100% em memória (sem gravar em disco — compatível com Render free).
 * Inclui capa com disciplina, trabalho, nome do usuário e integrantes do grupo, data,
 * títulos, listas, referências e blocos de código em fonte monoespaçada.
 */
export async function generateDeliverablePdfBuffer(input: DeliverablePdfInput): Promise<Buffer> {
  const authors = buildAuthorList(input.studentName, input.groupMembers);
  const dateLabel = formatSaoPauloDateTime(input.generatedAt ?? new Date()).split(',')[0] || new Date().toLocaleDateString('pt-BR');

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: ABNT_MARGIN_TOP,
        left: ABNT_MARGIN_LEFT,
        bottom: ABNT_MARGIN_BOTTOM,
        right: ABNT_MARGIN_RIGHT,
      },
      compress: false, // facilita inspeção em testes e mantém geração rápida e determinística
      info: {
        Title: input.assignmentName,
        Author: authors.join(', '),
        Subject: input.courseName,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ---- CAPA (ABNT) ----
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('PONTIFÍCIA UNIVERSIDADE CATÓLICA DE MINAS GERAIS', { align: 'center' });
    doc.moveDown(0.5);
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(input.courseName, { align: 'center' });

    doc.moveDown(4);
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(authors.length > 1 ? 'INTEGRANTES DO GRUPO' : 'AUTOR', { align: 'center' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(11);
    for (const author of authors) {
      doc.text(author, { align: 'center' });
    }

    doc.moveDown(6);
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(input.assignmentName.toUpperCase(), { align: 'center' });

    doc.moveDown(10);
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(`Belo Horizonte`, { align: 'center' });
    doc.text(dateLabel, { align: 'center' });

    // ---- CONTEÚDO PRINCIPAL ----
    doc.addPage();
    const lines = String(input.markdown || '').replace(/\r\n/g, '\n').split('\n');
    let inCodeBlock = false;
    let codeBuffer: string[] = [];

    const flushCodeBlock = () => {
      if (codeBuffer.length === 0) return;
      doc.moveDown(0.3);
      doc.font('Courier').fontSize(9.5);
      for (const codeLine of codeBuffer) {
        doc.text(codeLine || ' ', { indent: 12, lineGap: 2 });
      }
      doc.font('Helvetica').fontSize(11);
      doc.moveDown(0.5);
      codeBuffer = [];
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      if (trimmed.startsWith('```')) {
        if (inCodeBlock) {
          flushCodeBlock();
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(rawLine);
        continue;
      }

      if (!trimmed) {
        doc.moveDown(0.45);
        continue;
      }

      if (/^#{1}\s+/.test(trimmed)) {
        doc.moveDown(0.6);
        doc
          .font('Helvetica-Bold')
          .fontSize(14)
          .text(cleanInlineMarkdown(trimmed.replace(/^#\s+/, '')), { lineGap: 3 });
        doc.moveDown(0.3);
        doc.font('Helvetica').fontSize(11);
        continue;
      }

      if (/^#{2}\s+/.test(trimmed)) {
        doc.moveDown(0.5);
        doc
          .font('Helvetica-Bold')
          .fontSize(12.5)
          .text(cleanInlineMarkdown(trimmed.replace(/^##\s+/, '')), { lineGap: 2.5 });
        doc.moveDown(0.25);
        doc.font('Helvetica').fontSize(11);
        continue;
      }

      if (/^#{3,6}\s+/.test(trimmed)) {
        doc.moveDown(0.35);
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(cleanInlineMarkdown(trimmed.replace(/^#{3,6}\s+/, '')), { lineGap: 2 });
        doc.moveDown(0.15);
        doc.font('Helvetica').fontSize(11);
        continue;
      }

      if (/^[-*+]\s+/.test(trimmed)) {
        doc
          .font('Helvetica')
          .fontSize(11)
          .text(`• ${cleanInlineMarkdown(trimmed.replace(/^[-*+]\s+/, ''))}`, {
            indent: 14,
            align: 'justify',
            lineGap: 3,
          });
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        doc
          .font('Helvetica')
          .fontSize(11)
          .text(cleanInlineMarkdown(trimmed), {
            indent: 14,
            align: 'justify',
            lineGap: 3,
          });
        continue;
      }

      if (/^>\s+/.test(trimmed)) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(10)
          .text(cleanInlineMarkdown(trimmed.replace(/^>\s+/, '')), {
            indent: 28,
            align: 'justify',
            lineGap: 2.5,
          });
        doc.font('Helvetica').fontSize(11);
        continue;
      }

      if (/^---+$/.test(trimmed)) {
        doc.moveDown(0.4);
        continue;
      }

      doc
        .font('Helvetica')
        .fontSize(11)
        .text(cleanInlineMarkdown(trimmed), { align: 'justify', lineGap: 3.5 });
    }

    if (inCodeBlock) {
      flushCodeBlock();
    }

    doc.end();
  });
}

/**
 * Empacota em memória um `.zip` contendo os arquivos de código extraídos da entrega
 * + o `ENTREGA.md` completo (e um `README.md` de aviso caso não exista um explícito).
 */
export async function generateDeliverableCodeZipBuffer(params: {
  assignmentName: string;
  markdown: string;
  explicitFiles?: ExtractedCodeFile[];
}): Promise<Buffer> {
  const files = params.explicitFiles ?? extractCodeFilesFromMarkdown(params.markdown);

  return new Promise<Buffer>((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.append(params.markdown, { name: 'ENTREGA.md' });

    const seen = new Set<string>(['entrega.md']);
    for (const f of files) {
      const key = f.path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      archive.append(f.content, { name: f.path });
    }

    if (!seen.has('readme.md')) {
      archive.append(
        [
          `# ${params.assignmentName}`,
          '',
          '> Aviso: Os arquivos abaixo foram gerados pelo Assistente de Trabalhos PUC e **não foram executados nem testados automaticamente**. Revise e teste localmente antes de enviar no Canvas.',
          '',
          `Arquivos incluídos: ${files.map((f) => f.path).join(', ') || 'apenas ENTREGA.md'}`,
        ].join('\n'),
        { name: 'README.md' }
      );
    }

    void archive.finalize();
  });
}

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Gera página HTML de impressão A4 otimizada para o "Modo copiar à mão":
 * fonte grande, alto contraste, espaço generoso entre respostas e separação visual
 * da seção de justificativas (para estudar, não copiar).
 */
export function generateHandwrittenPrintHtml(input: {
  courseName: string;
  assignmentName: string;
  markdown: string;
  generatedAt?: Date;
}): string {
  const dateLabel =
    formatSaoPauloDateTime(input.generatedAt ?? new Date()).split(',')[0] ||
    new Date().toLocaleDateString('pt-BR');

  const lines = String(input.markdown || '').replace(/\r\n/g, '\n').split('\n');
  const htmlBlocks: string[] = [];
  let inJustificativas = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (/^#{1,2}\s+/.test(trimmed)) {
      const title = cleanInlineMarkdown(trimmed.replace(/^#{1,2}\s+/, ''));
      const isJust = /justificativa/i.test(title);
      if (isJust && !inJustificativas) {
        inJustificativas = true;
        htmlBlocks.push('<section class="justificativas-box">');
      } else if (!isJust && inJustificativas) {
        inJustificativas = false;
        htmlBlocks.push('</section>');
      }
      htmlBlocks.push(`<h2>${escapeHtml(title)}</h2>`);
      continue;
    }

    if (/^#{3,6}\s+/.test(trimmed)) {
      const title = cleanInlineMarkdown(trimmed.replace(/^#{3,6}\s+/, ''));
      htmlBlocks.push(`<h3>${escapeHtml(title)}</h3>`);
      continue;
    }

    // Linha compacta de questão fechada: "1 - b"
    if (/^\d{1,3}\s*[-–—]\s*[a-eA-E]\b/.test(trimmed)) {
      htmlBlocks.push(`<div class="closed-line">${escapeHtml(cleanInlineMarkdown(trimmed))}</div>`);
      continue;
    }

    htmlBlocks.push(`<p>${escapeHtml(cleanInlineMarkdown(trimmed))}</p>`);
  }

  if (inJustificativas) {
    htmlBlocks.push('</section>');
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Copiar à mão — ${escapeHtml(input.assignmentName)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Roboto, Arial, sans-serif;
      color: #111;
      background: #fff;
      margin: 0;
      padding: 20px 28px;
      font-size: 16pt;
      line-height: 1.75;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      margin-bottom: 18px;
      background: #f3f5f8;
      border: 1px solid #cfd6df;
      border-radius: 8px;
      font-size: 11pt;
    }
    .toolbar button {
      background: #0f4c5c;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 11pt;
      cursor: pointer;
    }
    header {
      border-bottom: 2px solid #222;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    header h1 { margin: 0 0 4px; font-size: 18pt; }
    header .meta { font-size: 11pt; color: #444; }
    h2 {
      margin: 26px 0 12px;
      font-size: 16pt;
      border-bottom: 1px solid #bbb;
      padding-bottom: 4px;
    }
    h3 {
      margin: 22px 0 8px;
      font-size: 15pt;
    }
    p {
      margin: 0 0 16px;
      text-align: left;
    }
    .closed-line {
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 17pt;
      font-weight: 700;
      padding: 5px 0;
      border-bottom: 1px dashed #ddd;
    }
    .justificativas-box {
      margin-top: 32px;
      padding: 16px 20px;
      border: 2px dashed #888;
      background: #fafafa;
      font-size: 12.5pt;
      line-height: 1.55;
      page-break-before: always;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <span><strong>Modo copiar à mão (A4)</strong> — fonte grande com espaço entre respostas</span>
    <button type="button" onclick="window.print()">Imprimir / Salvar PDF A4</button>
  </div>
  <header>
    <h1>${escapeHtml(input.assignmentName)}</h1>
    <div class="meta">${escapeHtml(input.courseName)} · ${escapeHtml(dateLabel)}</div>
  </header>
  <main>
    ${htmlBlocks.join('\n    ')}
  </main>
</body>
</html>`;
}
