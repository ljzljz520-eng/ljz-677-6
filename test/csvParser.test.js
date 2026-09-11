import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csvParser.js';

test('解析普通 CSV 并标注行号', () => {
  const { headers, rows } = parseCsv('样品编号,产地\nA,OR-1\nB,OR-2\n');
  assert.deepEqual(headers, ['样品编号', '产地']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].样品编号, 'A');
  assert.equal(rows[0]._line, 2);
  assert.equal(rows[1]._line, 3);
});

test('剥离 UTF-8 BOM', () => {
  const { headers } = parseCsv('﻿样品编号,产地\nA,OR-1\n');
  assert.equal(headers[0], '样品编号');
});

test('支持引号内逗号、换行与双引号转义', () => {
  const csv = 'a,b\n"x,y","line1\nline2"\n"q""q",z';
  const { rows } = parseCsv(csv);
  assert.equal(rows[0].a, 'x,y');
  assert.equal(rows[0].b, 'line1\nline2');
  assert.equal(rows[1].a, 'q"q');
});

test('CRLF 与末尾无换行均可解析', () => {
  const { rows } = parseCsv('a,b\r\n1,2\r\n3,4');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].b, '4');
});

test('空行被忽略', () => {
  const { rows } = parseCsv('a,b\n1,2\n\n,\n');
  assert.equal(rows.length, 1);
});
