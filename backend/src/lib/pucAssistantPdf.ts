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
