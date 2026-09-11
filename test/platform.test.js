import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformClient, PlatformTransportError, withRetry, Ledger } from '../src/platform.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const validRecord = (over = {}) => ({
  line: 2,
  sampleCode: 'SMP-1001',
  origin: 'OR-SD-001',
  testItem: '农残-有机磷',
  rawResult: '0.1 mg/kg',
  parsedResult: { kind: 'quantitative', value: 0.1, unit: 'mg/kg' },
  batchNo: 'BATCH-20260910-001',
  ...over
});

test('正常受理并返回回执', async () => {
  const c = new PlatformClient();
  const res = await c.uploadEntry(validRecord());
  assert.equal(res.ok, true);
  assert.match(res.platformReceipt, /^RCPT-/);
});

test('批次未备案 -> P201；资质过期 -> P202；超量 -> P203', async () => {
  const c = new PlatformClient();
  assert.equal((await c.uploadEntry(validRecord({ batchNo: 'BATCH-20260910-099' }))).code, 'P201');
  assert.equal((await c.uploadEntry(validRecord({
    sampleCode: 'SMP-1002', testItem: '非法添加-苏丹红',
    parsedResult: { kind: 'qualitative', verdict: '合格' }
  }))).code, 'P202');
  assert.equal((await c.uploadEntry(validRecord({
    sampleCode: 'SMP-1003',
    parsedResult: { kind: 'quantitative', value: 999, unit: 'mg/kg' }
  }))).code, 'P203');
});

test('平台已存在 -> D003', async () => {
  const c = new PlatformClient({ accepted: new Set(['SMP-1001']) });
  const res = await c.uploadEntry(validRecord());
  assert.equal(res.ok, false);
  assert.equal(res.code, 'D003');
});

test('瞬时故障注入后 withRetry 自动重试成功', async () => {
  const c = new PlatformClient();
  c.injectFault('SMP-1001', 'P504', 2);
  let calls = 0;
  const sleeps = [];
  const res = await withRetry(async () => {
    calls += 1;
    return c.uploadEntry(validRecord());
  }, { retries: 3, baseDelayMs: 10, sleep: (ms) => sleeps.push(ms) });
  assert.equal(res.ok, true);
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test('重试耗尽抛出传输错误', async () => {
  const c = new PlatformClient();
  c.injectFault('SMP-1001', 'P500', 5);
  await assert.rejects(
    () => withRetry(() => c.uploadEntry(validRecord()), { retries: 2, baseDelayMs: 1, sleep: () => {} }),
    (err) => err instanceof PlatformTransportError && err.code === 'P500'
  );
});

test('Ledger 持久化与判重', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  try {
    const file = join(dir, 'ledger.json');
    const a = new Ledger(file);
    a.add('SMP-2001');
    a.save();
    assert.ok(existsSync(file));
    const b = new Ledger(file);
    assert.ok(b.has('SMP-2001'));
    assert.equal(b.has('SMP-2002'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
