import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../src/csv.js';

test('解析普通 CSV 并映射中文表头', () => {
  const { records, missingColumns } = parseCsv('样品编号,产地,检测项目,结果,批次\nA-00001,山东,铅,0.1mg/kg,B20260926-001\n');
  assert.deepEqual(missingColumns, []);
  assert.equal(records.length, 1);
  assert.equal(records[0].sampleCode, 'A-00001');
  assert.equal(records[0].batchNo, 'B20260926-001');
  assert.equal(records[0]._line, 2);
});

test('支持引号转义、字段内换行与 CRLF、BOM', () => {
  const csv = '﻿样品编号,产地,检测项目,结果,批次\r\nA-00002,"山东,寿光","铅""总""",0.1mg/kg,B20260926-001\r\n';
  const { records } = parseCsv(csv);
  assert.equal(records[0].origin, '山东,寿光');
  assert.equal(records[0].item, '铅"总"');
});

test('缺少必需列时报告 missingColumns', () => {
  const { missingColumns, records } = parseCsv('样品编号,产地\nA-1,山东\n');
  assert.ok(missingColumns.includes('item'));
  assert.ok(missingColumns.includes('result'));
  assert.ok(missingColumns.includes('batchNo'));
  assert.equal(records.length, 1);
});

test('空文件视为全部列缺失', () => {
  const { missingColumns, records } = parseCsv('   \n');
  assert.equal(missingColumns.length, 5);
  assert.equal(records.length, 0);
});

test('toCsv 对特殊字符加引号', () => {
  const out = toCsv([{ a: 'x,y', b: 'he said "hi"' }], ['a', 'b']);
  assert.ok(out.includes('"x,y"'));
  assert.ok(out.includes('"he said ""hi"""'));
});
