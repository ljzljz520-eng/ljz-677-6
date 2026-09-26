import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { precheck } from '../src/services/precheckService.js';
import { submitImport } from '../src/services/submissionService.js';

/** 可注入的平台假客户端：按 sampleNo -> errorCode 映射拒绝 */
function fakeClient(rejections = new Map()) {
  return {
    calls: [],
    async submitBatch(batchNo, records) {
      this.calls.push({ batchNo, records });
      const receipts = records.map((r) => (rejections.has(r.sampleNo)
        ? { sampleNo: r.sampleNo, testItem: r.testItem, status: 'REJECTED', errorCode: rejections.get(r.sampleNo), message: '平台拒绝' }
        : { sampleNo: r.sampleNo, testItem: r.testItem, status: 'ACCEPTED', platformRef: `REG-${r.sampleNo}` }));
      return { batchNo, accepted: receipts.every((r) => r.status === 'ACCEPTED'), receipts };
    },
  };
}

const records = [
  { sampleNo: 'SMP-001', origin: '寿光', testItem: '农药残留', result: '合格', batchNo: 'B20260926-01' },
  { sampleNo: 'SMP-002', origin: '寿光', testItem: '重金属', result: '不合格', batchNo: 'B20260926-01' },
  { sampleNo: 'SMP-003', origin: '青州', testItem: '微生物', result: '合格', batchNo: 'B20260926-02' },
];

function setup(store, client, data = records) {
  const imp = store.createImport(precheck(data));
  return { imp, run: (opts) => submitImport(store, client, imp.id, opts) };
}

test('按批分组上送，回执落库，可按错误码筛选', async () => {
  const store = new Store();
  const client = fakeClient(new Map([['SMP-002', 'E3007']]));
  const { run } = setup(store, client);
  const submission = await run();

  assert.equal(client.calls.length, 2); // 两个批次各一次调用
  assert.deepEqual(client.calls.map((c) => c.batchNo).sort(), ['B20260926-01', 'B20260926-02']);
  assert.equal(submission.totals.submitted, 3);
  assert.equal(submission.totals.accepted, 2);
  assert.equal(submission.totals.rejected, 1);

  const rejected = store.queryReceipts({ errorCode: 'E3007' });
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].sampleNo, 'SMP-002');
  assert.equal(rejected[0].status, 'REJECTED');

  assert.equal(store.queryReceipts({ batchNo: 'B20260926-02' }).length, 1);
  assert.equal(store.queryReceipts({ status: 'ACCEPTED' }).length, 2);

  const summary = store.receiptSummary();
  assert.equal(summary.byErrorCode.E3007, 1);
  assert.equal(summary.byStatus.ACCEPTED, 2);
});

test('已受理记录再次上送时按重复单独跳过，不进入普通失败', async () => {
  const store = new Store();
  const client = fakeClient();
  const { run } = setup(store, client);

  await run({ batchNos: ['B20260926-01'] }); // 先上送批次 01
  const second = await run();                // 再全量上送

  assert.equal(second.skippedDuplicates.length, 2); // SMP-001/002 已受理 -> 重复跳过
  assert.ok(second.skippedDuplicates.every((d) => d.code === 'D2002'));
  assert.equal(second.totals.submitted, 1);         // 只剩批次 02 的 1 条
  assert.equal(second.totals.rejected, 0);          // 重复不算失败
});

test('被平台拒绝的记录可修正后重新上送（不视为重复）', async () => {
  const store = new Store();
  const { imp } = setup(store, fakeClient());

  await submitImport(store, fakeClient(new Map([['SMP-002', 'E3007']])), imp.id, { batchNos: ['B20260926-01'] });
  const retry = await submitImport(store, fakeClient(), imp.id, { batchNos: ['B20260926-01'] });

  assert.equal(retry.skippedDuplicates.length, 1); // 仅 SMP-001 已受理
  assert.equal(retry.totals.submitted, 1);         // SMP-002 重试
  assert.equal(retry.totals.accepted, 1);
});

test('全部已受理后再次上送 => 400，无可上送记录', async () => {
  const store = new Store();
  const client = fakeClient();
  const { run } = setup(store, client);
  await run();
  const err = await run().catch((e) => e);
  assert.equal(err.statusCode, 400);
});
