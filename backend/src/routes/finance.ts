import { NextFunction, Request, Response, Router } from 'express';
import ExcelJS from 'exceljs';
import { Collection, ObjectId } from 'mongodb';
import { callAI } from '../lib/ai';
import { getDb } from '../lib/mongo';
import { notifyAndroid } from '../lib/realtime';
import { apiTokenAuth } from '../middleware/apiToken';
import { jwtAuth } from '../middleware/jwtAuth';
import { requireRole } from '../middleware/requireRole';

interface Expense {
  _id?: ObjectId;
  data: Date;
  valor: number;
  estabelecimento: string;
  local: string;
  responsavel: string;
  categoria: string;
  origem: string;
}

interface FinanceSummary {
  totalGeral: number;
  porResponsavel: Record<string, number>;
  porCategoria: Record<string, number>;
}

const r = Router();
const collection = async (): Promise<Collection<Expense>> =>
  (await getDb()).collection<Expense>('finance');
const exportOrigins = new Set(['iOS-Vitor', 'iOS-Sophia']);
const financeRole = requireRole(['owner', 'finance']);

function financeWriteAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.header('x-api-token')) {
    apiTokenAuth(req, res, next);
    return;
  }
  jwtAuth(req, res, () => financeRole(req, res, next));
}

export function currentMonthRange(now = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const start = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00-03:00`);
  const end = new Date(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01T00:00:00-03:00`);
  return { start, end };
}

export function summarize(expenses: Expense[]): FinanceSummary {
  const summary: FinanceSummary = { totalGeral: 0, porResponsavel: {}, porCategoria: {} };
  for (const expense of expenses) {
    summary.totalGeral += expense.valor;
    summary.porResponsavel[expense.responsavel] =
      (summary.porResponsavel[expense.responsavel] ?? 0) + expense.valor;
    summary.porCategoria[expense.categoria] =
      (summary.porCategoria[expense.categoria] ?? 0) + expense.valor;
  }
  summary.totalGeral = Number(summary.totalGeral.toFixed(2));
  for (const totals of [summary.porResponsavel, summary.porCategoria]) {
    for (const key of Object.keys(totals)) totals[key] = Number(totals[key].toFixed(2));
  }
  return summary;
}

export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', , zone, , offsetHourText = '0', offsetMinuteText = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  const localDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() !== month - 1 ||
    localDate.getUTCDate() !== day ||
    localDate.getUTCHours() !== hour ||
    localDate.getUTCMinutes() !== minute ||
    localDate.getUTCSeconds() !== second ||
    (zone !== 'Z' && (offsetHour > 23 || offsetMinute > 59))
  ) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseAmount(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized.replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? money(amount) : null;
}

async function categorize(estabelecimento: string): Promise<string> {
  const result = await callAI(
    'Categorize the expense based only on the establishment name. Return JSON {"categoria":"..."} with a concise category in Brazilian Portuguese. If unclear, use "Outros".',
    estabelecimento,
    { temperature: 0, maxTokens: 80 }
  );
  const category = (result as { categoria?: unknown })?.categoria;
  if (typeof category !== 'string' || !category.trim() || category.trim().length > 80) {
    throw new Error('invalid_expense_category_from_ai');
  }
  return category.trim();
}

function money(value: number): number {
  return Number(value.toFixed(2));
}

export function createFinanceWorkbook(expenses: Expense[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LOSAI';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Finanças');

  sheet.columns = [
    { width: 22 },
    { width: 14 },
    { width: 28 },
    { width: 30 },
    { width: 20 },
    { width: 20 },
    { width: 14 },
  ];
  sheet.addTable({
    name: 'Despesas',
    ref: 'A1',
    headerRow: true,
    columns: [
      { name: 'Data' },
      { name: 'Valor' },
      { name: 'Estabelecimento' },
      { name: 'Local' },
      { name: 'Responsável' },
      { name: 'Categoria' },
      { name: 'Origem' },
    ],
    rows: expenses.map((expense) => [
      expense.data,
      expense.valor,
      expense.estabelecimento,
      expense.local,
      expense.responsavel,
      expense.categoria,
      expense.origem,
    ]),
  });
  const totalsByResponsible = new Map<string, number>();
  for (const expense of expenses) {
    totalsByResponsible.set(
      expense.responsavel,
      money((totalsByResponsible.get(expense.responsavel) ?? 0) + expense.valor)
    );
  }
  sheet.addRow([]);
  sheet.addRow(['Totais por responsável']);
  sheet.addRow(['Responsável', 'Total']);
  for (const [responsible, total] of [...totalsByResponsible].sort(([a], [b]) => a.localeCompare(b))) {
    sheet.addRow([responsible, total]);
  }
  const totalRow = sheet.addRow(['Total geral', money(expenses.reduce((sum, expense) => sum + expense.valor, 0))]);
  totalRow.font = { bold: true };
  sheet.getColumn(1).numFmt = 'dd/mm/yyyy hh:mm';
  sheet.getColumn(2).numFmt = '"R$" #,##0.00';
  sheet.getColumn(2).alignment = { horizontal: 'right' };
  sheet.getColumn(2).eachCell((cell, rowNumber) => {
    if (rowNumber > expenses.length + 3) cell.numFmt = '"R$" #,##0.00';
  });
  return workbook;
}

r.post('/add', financeWriteAuth, async (req, res, next) => {
  const body = req.body;
  const amount = parseAmount(body?.valor);
  const date = parseIsoDate(body?.data);

  if (!date) {
    res.status(400).json({ error: 'data deve ser ISO 8601 com fuso horário' });
    return;
  }
  if (amount === null) {
    res.status(400).json({ error: 'valor inválido' });
    return;
  }
  for (const field of ['estabelecimento', 'local', 'responsavel', 'origem'] as const) {
    const value = body?.[field];
    if (typeof value !== 'string' || value.trim().length > 200 ||
      (field === 'estabelecimento' && !value.trim()) ||
      (field === 'responsavel' && !value.trim())) {
      res.status(400).json({ error: `${field} inválido` });
      return;
    }
  }
  if (body?.categoria !== undefined &&
      (typeof body.categoria !== 'string' || body.categoria.length > 80)) {
    res.status(400).json({ error: 'categoria inválida' });
    return;
  }

  try {
    const estabelecimento = body.estabelecimento.trim();
    let categoria = typeof body.categoria === 'string' ? body.categoria.trim() : '';
    if (!categoria || categoria.toLocaleLowerCase('pt-BR') === 'outros') {
      try {
        categoria = await categorize(estabelecimento);
      } catch (error) {
        console.error('[finance] category inference failed:', error instanceof Error ? error.message : String(error));
        res.status(502).json({ error: 'ai_unavailable' });
        return;
      }
    }

    const expense: Expense = {
      data: date,
      valor: amount,
      estabelecimento,
      local: body.local.trim(),
      responsavel: body.responsavel.trim(),
      categoria,
      origem: body.origem.trim(),
    };
    const result = await (await collection()).insertOne(expense);
    notifyAndroid('RELOAD_FINANCE');
    res.status(201).json({
      message: 'Gasto registrado com sucesso.',
      gasto: { ...expense, _id: String(result.insertedId) },
    });
  } catch (error) {
    next(error);
  }
});

r.get('/', jwtAuth, financeRole, async (_req, res, next) => {
  try {
    const { start, end } = currentMonthRange();
    const expenses = await (await collection())
      .find({ data: { $gte: start, $lt: end } })
      .sort({ data: -1 })
      .toArray();
    res.json({
      gastos: expenses.map((expense) => ({ ...expense, _id: String(expense._id) })),
      resumo: summarize(expenses),
    });
  } catch (error) {
    next(error);
  }
});

r.delete('/:id', jwtAuth, financeRole, async (req, res, next) => {
  if (!ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: 'id inválido' });
    return;
  }

  try {
    const result = await (await collection()).deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) {
      res.status(404).json({ error: 'gasto não encontrado' });
      return;
    }
    notifyAndroid('RELOAD_FINANCE');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

r.get('/exportar', jwtAuth, financeRole, async (req, res, next) => {
  try {
    const origin = req.query.origem;
    if (origin !== undefined && (typeof origin !== 'string' || !exportOrigins.has(origin))) {
      res.status(400).json({ error: 'origem inválida' });
      return;
    }
    const category = req.query.categoria;
    if (category !== undefined && (typeof category !== 'string' || !category.trim() || category.length > 80)) {
      res.status(400).json({ error: 'categoria inválida' });
      return;
    }
    const filters: { origem?: string; categoria?: string } = {};
    if (typeof origin === 'string') filters.origem = origin;
    if (typeof category === 'string') filters.categoria = category;
    const expenses = await (await collection())
      .find(filters)
      .sort({ data: -1 })
      .toArray();
    const workbook = createFinanceWorkbook(expenses);
    const buffer = await workbook.xlsx.writeBuffer();
    res
      .status(200)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', 'attachment; filename="financeiro.xlsx"')
      .send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

export default r;
