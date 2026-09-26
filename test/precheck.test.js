import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precheck } from '../src/services/precheckService.js';

const base = {
  sampleNo: 'SMP-001',
  origin: '山东省寿光市',
  testItem: '农药残留',
  result: '合格',
  batchNo: 'B20260926-01',
};

test('合法记录通过预检', () => {
  const report = precheck([base]);
  assert.equal(report.total, 1);
  assert.equal(report.validCount, 1);
  assert.equal(report.failureCount, 0);
  assert.equal(report.duplicateCount, 0);
});

test('字段缺失/非法产生对应错误码，且一条记录可累计多个错误', () => {
  const report = precheck([{ sampleNo: '', origin: '', testItem: '未知项目', result: '也许合格', batchNo: '!!' }]);
  assert.equal(report.failureCount, 1);
  const codes = report.failures[0].errors.map((e) => e.code);
  assert.ok(codes.includes('E1001')); // 样品编号缺失
  assert.ok(codes.includes('E1011')); // 产地缺失
  assert.ok(codes.includes('E1022')); // 检测项目不在目录
  assert.ok(codes.includes('E1032')); // 结果取值非法
  assert.ok(codes.includes('E1042')); // 批次号格式非法
});

test('重复样品单独提示，不混入普通失败', () => {
  const report = precheck([
    base,
    { ...base },                    // 文件内重复 -> D2001
    { ...base, sampleNo: '' },      // 字段失败 -> failures
  ]);
  assert.equal(report.validCount, 1);
  assert.equal(report.duplicateCount, 1);
  assert.equal(report.duplicates[0].code, 'D2001');
  assert.equal(report.duplicates[0].duplicateOfRow, 1);
  assert.equal(report.failureCount, 1);
  // 重复记录绝不出现在 failures 中
  assert.ok(report.failures.every((f) => f.errors.every((e) => e.code.startsWith('E1'))));
});

test('同一样品不同检测项目不算重复', () => {
  const report = precheck([base, { ...base, testItem: '重金属' }]);
  assert.equal(report.validCount, 2);
  assert.equal(report.duplicateCount, 0);
});

test('与已报送成功记录重复 => D2002，同样不进 failures', () => {
  const submittedKeys = new Set(['SMP-001::农药残留']);
  const report = precheck([base], { submittedKeys });
  assert.equal(report.validCount, 0);
  assert.equal(report.duplicateCount, 1);
  assert.equal(report.duplicates[0].code, 'D2002');
  assert.equal(report.failureCount, 0);
});
