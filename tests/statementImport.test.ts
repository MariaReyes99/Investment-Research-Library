import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseCsv, parseDate, summariseStatement } from '../lib/statementImport';

test('amounts in common bank formats', () => {
  assert.equal(parseAmount('$1,234.50'), 1234.5);
  assert.equal(parseAmount('(45.00)'), -45);
  assert.equal(parseAmount('-12'), -12);
  assert.equal(parseAmount('12.00 DR'), -12);
  assert.equal(parseAmount(''), null);
});

test('day-first and ISO dates', () => {
  assert.equal(parseDate('31/01/2026')?.toISOString().slice(0, 10), '2026-01-31');
  assert.equal(parseDate('2026-01-31')?.toISOString().slice(0, 10), '2026-01-31');
  assert.equal(parseDate('20260131')?.toISOString().slice(0, 10), '2026-01-31');
});

test('quoted CSV fields', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\n1,2,3'), [['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
});

test('single amount column statement (two months)', () => {
  const csv = [
    'Account,12-3456-7890123-00',
    'Date,Description,Amount,Balance',
    '01/01/2026,SALARY ACME LTD,5000.00,5200.00',
    '05/01/2026,SUPERMARKET,-200.00,5000.00',
    '15/01/2026,RENT,-1800.00,3200.00',
    '01/02/2026,SALARY ACME LTD,5000.00,8200.00',
    '05/02/2026,SUPERMARKET,-250.00,7950.00',
    '28/02/2026,POWER,"-150.00",7800.00',
  ].join('\n');
  const s = summariseStatement(csv, 'statement.csv')!;
  assert.equal(s.transactions, 6);
  assert.ok(s.months >= 1.8 && s.months <= 2.0);
  assert.ok(Math.abs(s.averageMoneyIn - 10000 / s.months) < 2);
  assert.equal(s.latestBalance, 7800);
  assert.equal(s.largestIncomeSources[0].description, 'SALARY ACME LTD');
});

test('separate money in / money out columns', () => {
  const csv = 'Date,Details,Money In,Money Out,Balance\n2026-03-01,Pay,4000,,4100\n2026-03-10,Shop,,100,4000\n2026-03-31,Bill,,400,3600';
  const s = summariseStatement(csv)!;
  assert.equal(s.averageMoneyIn, 4000);
  assert.equal(s.averageMoneyOut, 500);
  assert.equal(s.latestBalance, 3600);
});

test('OFX statement', () => {
  const ofx = '<OFX><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260301<TRNAMT>3000.00<NAME>PAY</STMTTRN><STMTTRN><DTPOSTED>20260320<TRNAMT>-500.00<NAME>SHOP</STMTTRN><LEDGERBAL><BALAMT>2500.00<DTASOF>20260331</LEDGERBAL></OFX>';
  const s = summariseStatement(ofx, 'march.ofx')!;
  assert.equal(s.transactions, 2);
  assert.equal(s.averageMoneyIn, 3000);
  assert.equal(s.latestBalance, 2500);
});

test('files that are not statements give nothing', () => {
  assert.equal(summariseStatement('hello,world\n1,2'), null);
});
