import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';
import { precheck, validateFields, parseResult } from '../src/precheck.js';

const rec = (o) => ({ _line: 1, sampleCode: '', origin: '', item: '', result: '', batchNo: '', ...o });

test('合法定性/定量结果通过字段校验', () => {
  assert.equal(validateFields(rec({ sampleCode: 'A-10001', origin: '山东寿光', item: '铅', result: '合格', batchNo: 'B20260926-001' })).errors.length, 0);
  assert.equal(validateFields(rec({ sampleCode: 'A-10002', origin: '浙江金华', item: '镉', result: '1.2g/kg', batchNo: 'B20260926-001' })).errors.length, 0);
});

test('定量结果单位归一化到 mg/kg', () => {
  assert.equal(parseResult('2g/kg').normalizedMgKg, 2000);
  assert.equal(parseResult('0.05%').normalizedMgKg, 500);
  assert.equal(parseResult('0.1mg/kg').normalizedMgKg, 0.1);
});

test('各类字段错误返回对应 V 错误码', () => {
  assert.ok(validateFields(rec({ sampleCode: '7BAD' })).errors.some(e => e.code === 'V0002'));
  assert.ok(validateFields(rec({ origin: '火星基地' })).errors.some(e => e.code === 'V0003'));
  assert.ok(validateFields(rec({ item: '三聚氰胺' })).errors.some(e => e.code === 'V0004'));
  assert.ok(validateFields(rec({ result: '大约0.2' })).errors.some(e => e.code === 'V0005'));
  assert.ok(validateFields(rec({ batchNo: 'b20260926002' })).errors.some(e => e.code === 'V0006'));
});

test('样品编号与批次自动大写归一', () => {
  const { normalized } = validateFields(rec({ sampleCode: 'a-10009', origin: '山东', item: '铅', result: '0.1mg/kg', batchNo: 'b20260926-009' }));
  assert.equal(normalized.sampleCode, 'A-10009');
  assert.equal(normalized.batchNo, 'B20260926-009');
});

test('文件内重复单独标记为 D1001，不混入普通失败', () => {
  const csv = '样品编号,产地,检测项目,结果,批次\n' +
    'A-00001,山东,铅,0.1mg/kg,B20260926-001\n' +
    'A-00001,山东,铅,0.1mg/kg,B20260926-001\n';
  const { valid, invalid, duplicates } = precheck(parseCsv(csv).records);
  assert.equal(valid.length, 1);
  assert.equal(invalid.length, 0);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].errorCode, 'D1001');
});

test('与库内已存在编号重复标记为 D1002', () => {
  const csv = '样品编号,产地,检测项目,结果,批次\nA-EXIST,山东,铅,0.1mg/kg,B20260926-001\n';
  const { duplicates, valid } = precheck(parseCsv(csv).records, new Set(['A-EXIST']));
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].errorCode, 'D1002');
  assert.equal(valid.length, 0);
});

test('字段错误的行不参与重复判定', () => {
  const csv = '样品编号,产地,检测项目,结果,批次\n' +
    '7BAD,山东,铅,0.1mg/kg,B20260926-001\n' +
    '7BAD,山东,铅,0.1mg/kg,B20260926-001\n';
  const { invalid, duplicates, valid } = precheck(parseCsv(csv).records);
  assert.equal(invalid.length, 2);
  assert.equal(duplicates.length, 0);
  assert.equal(valid.length, 0);
});
