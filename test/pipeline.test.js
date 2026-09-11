import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, filterErrors, HeaderError } from '../src/pipeline.js';
import { PlatformClient, Ledger } from '../src/platform.js';

const HEADER = '样品编号,产地,检测项目,检测结果,批次\n';

const ok = (code, extra = '') =>
  `${code},OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-001${extra}`;

async function pipeline(body, opts = {}) {
  return runPipeline({
    text: HEADER + body,
    client: opts.client ?? new PlatformClient(),
    ledger: opts.ledger ?? new Ledger(null),
    retryOpts: { retries: 1, baseDelayMs: 1, sleep: () => {} }
  });
}

test('表头缺列抛 HeaderError', async () => {
  const client = new PlatformClient();
  await assert.rejects(
    () => runPipeline({
      text: '样品编号,产地\nSMP-0001,OR-SD-001\n',
      client,
      ledger: new Ledger(null)
    }),
    (err) => err instanceof HeaderError && err.missing.includes('检测项目')
  );
});

test('端到端：成功 + 平台失败 + 字段失败 + 文件内重复 各自归位', async () => {
  const csv =
    ok('SMP-A001') + '\n' +
    'SMP-A002,OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-099\n' + // P201
    'SMP-A003,OR-SD-001,农残-有机磷,0.1 mg/kg,badformat\n' +          // F111
    'SMP-A001,OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-001\n';  // D001

  const r = await pipeline(csv);
  assert.equal(r.counts.total, 4);
  assert.equal(r.counts.submittedOk, 1);
  assert.equal(r.counts.submittedFail, 1);
  assert.equal(r.counts.invalid, 1);
  assert.equal(r.counts.duplicates, 1);
  assert.equal(r.failed[0].code, 'P201');
  assert.equal(r.duplicates[0].errors[0].code, 'D001');
});

test('按错误码筛选 P201 只回平台失败记录', async () => {
  const csv =
    ok('SMP-B001') + '\n' +
    'SMP-B002,OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-099\n' +
    'SMP-B003,OR-SD-001,农残-有机磷,,BATCH-20260910-001\n' +
    'SMP-B001,OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-001\n';
  const r = await pipeline(csv);

  const p201 = filterErrors(r, { code: 'P201' });
  assert.equal(p201.length, 1);
  assert.equal(p201[0].sampleCode, 'SMP-B002');

  const f107 = filterErrors(r, { code: 'F107' });
  assert.equal(f107.length, 1);
  assert.equal(f107[0].sampleCode, 'SMP-B003');
});

test('重复样品不混入普通失败；显式按 D001 筛选才出现', async () => {
  const csv =
    ok('SMP-C001') + '\n' +
    ok('SMP-C001') + '\n' +
    'SMP-C002,OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-099\n';
  const r = await pipeline(csv);

  const normalFailures = filterErrors(r);
  assert.equal(normalFailures.length, 1);
  assert.equal(normalFailures[0].sampleCode, 'SMP-C002');
  assert.ok(normalFailures.every((x) => !x.errors.some((e) => e.code.startsWith('D0'))));

  const dups = filterErrors(r, { code: 'D001' });
  assert.equal(dups.length, 1);
  assert.equal(dups[0].sampleCode, 'SMP-C001');
});

test('按阶段筛选', async () => {
  const csv =
    ok('SMP-D001') + '\n' +
    'SMP-D002,OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-099\n' +
    'SMP-D003,OR-SD-001,农残-有机磷,,BATCH-20260910-001\n';
  const r = await pipeline(csv);
  assert.equal(filterErrors(r, { stage: 'submit' }).length, 1);
  assert.equal(filterErrors(r, { stage: 'precheck' }).length, 1);
});

test('传输重试耗尽计入平台失败', async () => {
  const client = new PlatformClient();
  client.injectFault('SMP-E001', 'P500', 9);
  const r = await pipeline(ok('SMP-E001') + '\n', { client });
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].code, 'P500');
  assert.equal(r.failed[0].transportError, true);
});

test('平台 D003 归入重复通道而非普通失败', async () => {
  const client = new PlatformClient({ accepted: new Set(['SMP-F001']) });
  const r = await pipeline(ok('SMP-F001') + '\n' +
    'SMP-F002,OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-099\n', { client });
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].errors[0].code, 'D003');
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].code, 'P201');
  assert.equal(r.counts.duplicates, 1);
  assert.equal(r.counts.submittedFail, 1);
});
