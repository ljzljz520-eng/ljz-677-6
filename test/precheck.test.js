import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csvParser.js';
import { precheck, parseResult } from '../src/precheck.js';
import { TEST_ITEMS } from '../src/catalog.js';

const HEADER = '样品编号,产地,检测项目,检测结果,批次\n';

function pre(csvBody, ledger = new Set()) {
  return precheck(parseCsv(HEADER + csvBody).rows, ledger);
}

test('合法记录通过预检', () => {
  const r = pre('SMP-0001,OR-SD-001,农残-有机磷,0.12 mg/kg,BATCH-20260910-001\n');
  assert.equal(r.stats.valid, 1);
  assert.deepEqual(r.valid[0].parsedResult, { kind: 'quantitative', value: 0.12, unit: 'mg/kg' });
});

test('定性结果解析', () => {
  assert.deepEqual(parseResult('阴性', TEST_ITEMS['瘦肉精']), { kind: 'qualitative', verdict: '阴性' });
  assert.equal(parseResult('可疑', TEST_ITEMS['瘦肉精']), null);
});

test('字段错误：空编号/未备案产地/未知项目/批次格式', () => {
  const r = pre(',OR-XX-999,不存在项目,0.1 g/kg,bad-batch\n');
  const codes = r.invalid[0].errors.map((e) => e.code).sort();
  assert.deepEqual(codes, ['F101', 'F104', 'F106', 'F111']);
});

test('定性项目收到定量结果 -> F108；定量单位不匹配 -> F109', () => {
  const r = pre(
    'SMP-0002,OR-SD-001,瘦肉精,0.1 mg/kg,BATCH-20260910-001\n' +
    'SMP-0003,OR-SD-001,农残-有机磷,0.1 g/kg,BATCH-20260910-001\n'
  );
  assert.equal(r.invalid[0].errors[0].code, 'F108');
  assert.equal(r.invalid[1].errors[0].code, 'F109');
});

test('文件内重复样品：首次有效，后续 D001 且进入 duplicates 而非 invalid', () => {
  const r = pre(
    'SMP-0004,OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-001\n' +
    'SMP-0004,OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-001\n'
  );
  assert.equal(r.stats.valid, 1);
  assert.equal(r.stats.duplicates, 1);
  assert.equal(r.stats.invalid, 0);
  assert.equal(r.duplicates[0].errors[0].code, 'D001');
  assert.equal(r.duplicates[0].duplicateOfLine, 2);
});

test('台账命中：D002 单独通道', () => {
  const r = pre(
    'SMP-0005,OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-001\n',
    new Set(['SMP-0005'])
  );
  assert.equal(r.stats.duplicates, 1);
  assert.equal(r.duplicates[0].errors[0].code, 'D002');
  assert.equal(r.valid.length, 0);
});

test('重复行同时有字段问题时，字段问题附加展示但不进入 invalid', () => {
  const r = pre(
    'SMP-0006,OR-SD-001,农残-有机磷,0.1 mg/kg,BATCH-20260910-001\n' +
    'SMP-0006,,,0.1 mg/kg,BATCH-20260910-001\n'
  );
  assert.equal(r.duplicates.length, 1);
  const codes = r.duplicates[0].errors.map((e) => e.code);
  assert.ok(codes.includes('D001'));
  assert.ok(codes.includes('F103'));
  assert.equal(r.invalid.length, 0);
});
