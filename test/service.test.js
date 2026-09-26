import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { JsonStore } from '../src/store.js';
import { ReportService } from '../src/service.js';

let service, file;

function makeService() {
  file = join(tmpdir(), `agri-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  return new ReportService(new JsonStore(file));
}

beforeEach(() => { service = makeService(); });

const HEADER = '样品编号,产地,检测项目,结果,批次\n';
const goodCsv = HEADER +
  'A-10001,山东寿光,铅,0.12mg/kg,B20260926-001\n' +
  'A-10002,河北保定,有机磷农药,合格,B20260926-001\n';

test('导入：预检通过入库为 pending，字段失败与重复分开统计', () => {
  const csv = HEADER +
    'A-10001,山东寿光,铅,0.12mg/kg,B20260926-001\n' +
    'A-10001,山东寿光,铅,0.12mg/kg,B20260926-001\n' +  // D1001
    '7BAD,山东,铅,0.1mg/kg,B20260926-001\n' +           // V0002
    'A-10003,湖北,三聚氰胺,合格,B20260926-001\n';        // V0004
  const r = service.importCsv(csv);
  assert.deepEqual(r.summary, { total: 4, valid: 1, invalid: 2, duplicate: 1 });
  assert.equal(service.stats().samples, 1);
  assert.equal(service.stats().pending, 1);
});

test('整表缺列时所有数据行记 V0001', () => {
  const r = service.importCsv('样品编号,产地\nA-1,山东\nA-2,河北\n');
  assert.equal(r.summary.invalid, 2);
  assert.ok(r.invalid.every(x => x.errorCodes.includes('V0001')));
});

test('按批上送：全部接收（failureRate=0）', () => {
  service.importCsv(goodCsv);
  const r = service.submitBatch('B20260926-001', { failureRate: 0 });
  assert.equal(r.total, 2);
  assert.equal(r.accepted, 2);
  assert.equal(service.stats().submitted, 2);
});

test('平台异常回传：按错误码筛选，重复样品不混入普通失败', () => {
  const csv = HEADER +
    'A-20001,山东,铅,0.1mg/kg,B20260926-002\n' +          // 成功
    'A-20003,福建,金黄色葡萄球菌,合格,B20260926-002\n' +    // E2002
    'A-20004,山东,亚硝酸盐,1200mg/kg,B20260926-002\n' +     // E2003
    'A-20005,山东青岛保税区（未备案）,镉,0.03mg/kg,B20260926-002\n' + // E2001
    'A-20006,河南,瘦肉精,合格,B20260926-002\n' +
    'A-20006,河南,瘦肉精,合格,B20260926-002\n';             // D1001
  service.importCsv(csv);
  const sub = service.submitBatch('B20260926-002', { failureRate: 0 });
  assert.equal(sub.accepted, 2);
  assert.equal(sub.rejected, 3);

  const e2002 = service.listExceptions({ errorCode: 'E2002' });
  assert.deepEqual(e2002.map(e => e.sampleCode), ['A-20003']);
  assert.equal(e2002[0].category, 'platform');

  const onlyDup = service.listExceptions({ category: 'duplicate' });
  assert.equal(onlyDup.length, 1);
  assert.equal(onlyDup[0].errorCode, 'D1001');
  assert.equal(onlyDup[0].sampleCode, 'A-20006');

  // 不限类别时，重复与平台异常同表但类别不同，互不混淆
  const all = service.listExceptions({});
  assert.equal(all.length, 4);
  assert.deepEqual(all.map(e => e.category).sort(), ['duplicate', 'platform', 'platform', 'platform']);
});

test('E5003 失败后重试单条成功', () => {
  service.importCsv(HEADER + 'A-30001,山东,铅,0.1mg/kg,B20260926-003\n');
  // 强制首次失败
  const sub = service.submitBatch('B20260926-003', { failureRate: 1 });
  assert.equal(sub.results[0].errorCode, 'E5003');
  assert.equal(service.listSamples({ status: 'rejected' }).length, 1);

  const retry = service.retrySample('A-30001', { failureRate: 1 });
  assert.equal(retry.accepted, true);
  assert.match(retry.receipt, /^RCV-/);
  assert.equal(service.listSamples({ status: 'submitted' }).length, 1);
});

test('二次导入同一编号记 D1002，不覆盖原样品', () => {
  service.importCsv(goodCsv);
  const second = service.importCsv(HEADER + 'A-10001,山东,铅,0.99mg/kg,B20260926-009\n');
  assert.equal(second.summary.duplicate, 1);
  assert.equal(second.duplicates[0].errorCode, 'D1002');
  const s = service.listSamples().find(x => x.sampleCode === 'A-10001');
  assert.equal(s.resultText, '0.12mg/kg'); // 原数据未被覆盖
});

test('批次概览汇总状态与平台错误分布', () => {
  const csv = HEADER +
    'A-20003,福建,金黄色葡萄球菌,合格,B20260926-002\n' +
    'A-40001,山东,铅,0.1mg/kg,B20260926-004\n';
  service.importCsv(csv);
  service.submitBatch('B20260926-002', { failureRate: 0 });
  const batches = service.listBatches();
  const b = batches.find(x => x.batchNo === 'B20260926-002');
  assert.equal(b.rejected, 1);
  assert.equal(b.errors.E2002, 1);
});

test('数据持久化：重新加载后状态保留', () => {
  service.importCsv(goodCsv);
  service.submitBatch('B20260926-001', { failureRate: 0 });
  const reopened = new ReportService(new JsonStore(file));
  assert.equal(reopened.stats().submitted, 2);
});
