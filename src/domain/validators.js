import { PRECHECK_ERROR_CODES } from './errorCodes.js';

/** 检测项目目录（可按监管要求扩充） */
export const TEST_ITEM_CATALOG = Object.freeze([
  '农药残留',
  '兽药残留',
  '重金属',
  '微生物',
  '食品添加剂',
  '真菌毒素',
  '理化指标',
]);

export const RESULT_VALUES = Object.freeze(['合格', '不合格']);

const SAMPLE_NO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/;
const BATCH_NO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/;
const ORIGIN_MAX_LENGTH = 100;

/** 字段别名：兼容中文表头 / 英文键 / 蛇形键 */
export const KEY_ALIASES = Object.freeze({
  sampleNo: ['sampleNo', 'sample_no', 'sampleno', '样品编号'],
  origin: ['origin', '产地', '来源地'],
  testItem: ['testItem', 'test_item', 'testitem', '检测项目', '项目'],
  result: ['result', '检测结果', '结果'],
  batchNo: ['batchNo', 'batch_no', 'batchno', 'batch', '批次', '批次号'],
});

/** 把任意别名的对象键统一为标准字段名 */
export function normalizeKeys(obj) {
  const out = {};
  for (const [field, aliases] of Object.entries(KEY_ALIASES)) {
    for (const alias of aliases) {
      if (obj[alias] !== undefined && obj[alias] !== null) {
        out[field] = obj[alias];
        break;
      }
    }
  }
  return out;
}

export function normalizeRecord(record) {
  const std = normalizeKeys(record);
  return {
    sampleNo: String(std.sampleNo ?? '').trim(),
    origin: String(std.origin ?? '').trim(),
    testItem: String(std.testItem ?? '').trim(),
    result: String(std.result ?? '').trim(),
    batchNo: String(std.batchNo ?? '').trim(),
  };
}

/** 字段级预检，返回错误数组（空数组 = 通过） */
export function validateRecord(record) {
  const errors = [];
  const push = (code) => {
    const def = PRECHECK_ERROR_CODES[code];
    errors.push({ code, field: def.field, message: def.message });
  };

  if (!record.sampleNo) push('E1001');
  else if (!SAMPLE_NO_PATTERN.test(record.sampleNo)) push('E1002');

  if (!record.origin) push('E1011');
  else if (record.origin.length > ORIGIN_MAX_LENGTH) push('E1012');

  if (!record.testItem) push('E1021');
  else if (!TEST_ITEM_CATALOG.includes(record.testItem)) push('E1022');

  if (!record.result) push('E1031');
  else if (!RESULT_VALUES.includes(record.result)) push('E1032');

  if (!record.batchNo) push('E1041');
  else if (!BATCH_NO_PATTERN.test(record.batchNo)) push('E1042');

  return errors;
}

/** 重复判定键：同一样品编号 + 同一检测项目视为同一条检测记录 */
export function dedupKey(record) {
  return `${record.sampleNo}::${record.testItem}`;
}
