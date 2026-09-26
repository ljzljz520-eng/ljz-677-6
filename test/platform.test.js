import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submit } from '../src/platform.js';

const base = { sampleCode: 'A-1', origin: '山东寿光', item: '铅', resultText: '0.1mg/kg', valueMgKg: 0.1 };

test('正常样品被平台接收并返回回执', () => {
  const r = submit(base, 'B20260926-001', { failureRate: 0 });
  assert.equal(r.accepted, true);
  assert.match(r.receipt, /^RCV-B20260926-001-A-1-/);
});

test('未备案产地回 E2001', () => {
  const r = submit({ ...base, origin: '山东青岛保税区（未备案）' }, 'B20260926-001', { failureRate: 0 });
  assert.equal(r.accepted, false);
  assert.equal(r.errorCode, 'E2001');
});

test('无资质检测项目回 E2002', () => {
  const r = submit({ ...base, item: '金黄色葡萄球菌' }, 'B20260926-001', { failureRate: 0 });
  assert.equal(r.errorCode, 'E2002');
});

test('结果超平台限值回 E2003（g/kg 单位换算后）', () => {
  const r = submit({ ...base, valueMgKg: 1200 }, 'B20260926-001', { failureRate: 0 });
  assert.equal(r.errorCode, 'E2003');
});

test('E5003 为临时性错误，attempt=2 重试成功', () => {
  // failureRate=1 保证首次一定触发 E5003
  const first = submit(base, 'B20260926-001', { failureRate: 1, attempt: 1 });
  assert.equal(first.errorCode, 'E5003');
  const again = submit(base, 'B20260926-001', { failureRate: 1, attempt: 2 });
  assert.equal(again.accepted, true);
});
