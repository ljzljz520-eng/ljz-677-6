import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

let server;
let base;

before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('端到端：导入 -> 预检 -> 按批上送 -> 回执按错误码筛选', async () => {
  const csv = [
    '样品编号,产地,检测项目,结果,批次',
    'SMP-0001,山东省寿光市,农药残留,合格,B20260926-01',
    'SMP-ERR-9,山东省寿光市,重金属,合格,B20260926-01',   // Mock: 含 ERR -> E3099
    'SMP-0001,山东省寿光市,农药残留,合格,B20260926-01',   // 文件内重复 -> D2001
    'BAD !!,寿光,未知项目,也许,!!',                        // 字段失败 -> E1xxx
    'SMP-0007,山东省青州市,微生物,合格,B20260926-LOCK',   // Mock: 批次锁定 -> E3002
  ].join('\n');

  // 1. 导入 + 预检
  const importRes = await fetch(`${base}/api/imports`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csv,
  });
  assert.equal(importRes.status, 201);
  const report = await importRes.json();
  assert.equal(report.total, 5);
  assert.equal(report.validCount, 3);
  assert.equal(report.duplicateCount, 1);
  assert.equal(report.duplicates[0].code, 'D2001');
  assert.equal(report.failureCount, 1);
  assert.ok(report.failures[0].errors.every((e) => e.code.startsWith('E1'))); // 普通失败只有字段错误

  // 2. 按批上送
  const submitRes = await fetch(`${base}/api/imports/${report.id}/submit`, { method: 'POST' });
  assert.equal(submitRes.status, 201);
  const submission = await submitRes.json();
  assert.equal(submission.batches.length, 2); // B20260926-01 / B20260926-LOCK
  assert.equal(submission.totals.accepted, 1);
  assert.equal(submission.totals.rejected, 2);

  // 3. 回执按错误码筛选
  const locked = await (await fetch(`${base}/api/receipts?errorCode=E3002`)).json();
  assert.equal(locked.total, 1);
  assert.equal(locked.receipts[0].sampleNo, 'SMP-0007');

  const platformErr = await (await fetch(`${base}/api/receipts?errorCode=E3099`)).json();
  assert.equal(platformErr.total, 1);
  assert.equal(platformErr.receipts[0].sampleNo, 'SMP-ERR-9');

  // 4. 汇总
  const summary = await (await fetch(`${base}/api/receipts/summary`)).json();
  assert.deepEqual(summary.byErrorCode, { E3002: 1, E3099: 1 });
  assert.equal(summary.byStatus.ACCEPTED, 1);

  // 5. 重复导入同一文件 => 已受理的 SMP-0001 提示 D2002，而非普通失败
  const reimport = await (await fetch(`${base}/api/imports`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csv,
  })).json();
  const d2002 = reimport.duplicates.filter((d) => d.code === 'D2002');
  assert.equal(d2002.length, 1);
  assert.equal(d2002[0].record.sampleNo, 'SMP-0001');
  assert.ok(reimport.failures.every((f) => f.errors.every((e) => e.code.startsWith('E1'))));
});
