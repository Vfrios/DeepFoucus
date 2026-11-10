import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createFinanceWorkbook, currentMonthRange, parseAmount, parseIsoDate, summarize } from './finance';

test('parses an ISO 8601 timestamp with its explicit timezone', () => {
  assert.equal(parseIsoDate('2026-11-10T13:30:00-03:00')?.toISOString(), '2026-11-10T16:30:00.000Z');
  assert.equal(parseIsoDate('2026-02-30T13:30:00-03:00'), null);
  assert.equal(parseIsoDate('2026-11-10T13:30:00'), null);
});

test('parses positive decimal amounts from the Shortcuts JSON string', () => {
  assert.equal(parseAmount('50.00'), 50);
  assert.equal(parseAmount('50,25'), 50.25);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('1e3'), null);
  assert.equal(parseAmount('-10'), null);
});

test('calculates the current finance month in São Paulo time, including year rollover', () => {
  const october = currentMonthRange(new Date('2026-11-01T02:30:00.000Z'));
  assert.equal(october.start.toISOString(), '2026-10-01T03:00:00.000Z');
  assert.equal(october.end.toISOString(), '2026-11-01T03:00:00.000Z');

  const december = currentMonthRange(new Date('2026-12-15T12:00:00.000Z'));
  assert.equal(december.start.toISOString(), '2026-12-01T03:00:00.000Z');
  assert.equal(december.end.toISOString(), '2027-01-01T03:00:00.000Z');
});

test('summarizes totals by responsible person and category', () => {
  const summary = summarize([
    { data: new Date(), valor: 12.35, estabelecimento: 'Mercado', local: '', responsavel: 'Vitor', categoria: 'Mercado', origem: 'iOS' },
    { data: new Date(), valor: 7.65, estabelecimento: 'Padaria', local: '', responsavel: 'Vitor', categoria: 'Alimentação', origem: 'iOS' },
    { data: new Date(), valor: 10, estabelecimento: 'Farmácia', local: '', responsavel: 'Sophia', categoria: 'Saúde', origem: 'iOS' },
  ]);
  assert.deepEqual(summary, {
    totalGeral: 30,
    porResponsavel: { Vitor: 20, Sophia: 10 },
    porCategoria: { Mercado: 12.35, Alimentação: 7.65, Saúde: 10 },
  });
});

test('exports an XLSX expense table with totals by responsible person', async () => {
  const workbook = createFinanceWorkbook([
    { data: new Date('2026-11-10T16:30:00Z'), valor: 50, estabelecimento: 'Posto Shell', local: 'Av. Raja Gabaglia', responsavel: 'Vitor', categoria: 'Gasolina', origem: 'iOS' },
    { data: new Date('2026-11-11T12:00:00Z'), valor: 20, estabelecimento: 'Farmácia', local: 'Centro', responsavel: 'Sophia', categoria: 'Saúde', origem: 'iOS' },
  ]);
  const bytes = await workbook.xlsx.writeBuffer();
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(bytes);
  const sheet = exported.getWorksheet('Finanças');

  assert.ok(sheet);
  assert.equal(sheet.getCell('A1').value, 'Data');
  assert.equal(sheet.getCell('C2').value, 'Posto Shell');
  assert.equal(sheet.getCell('A5').value, 'Totais por responsável');
  assert.equal(sheet.getCell('A7').value, 'Sophia');
  assert.equal(sheet.getCell('B7').value, 20);
  assert.equal(sheet.getCell('A8').value, 'Vitor');
  assert.equal(sheet.getCell('B8').value, 50);
  assert.equal(sheet.getCell('A9').value, 'Total geral');
  assert.equal(sheet.getCell('B9').value, 70);
});
