// 字段预检：逐行校验 + 重复样品单独识别。
import {
  SAMPLE_CODE_PATTERN, BATCH_PATTERN, RESULT_QUANT_PATTERN,
  QUALITATIVE_RESULTS, TEST_ITEMS, REGISTERED_ORIGIN_PREFIXES,
  UNIT_TO_MG_KG, PRECHECK_ERRORS,
  DUPLICATE_CODE, DUPLICATE_DESC, DUPLICATE_DB_CODE, DUPLICATE_DB_DESC
} from './catalog.js';

function originRegistered(origin) {
  return REGISTERED_ORIGIN_PREFIXES.some(p => origin.startsWith(p));
}

/** 解析检测结果，返回 { kind, raw, normalizedMgKg, text } 或 null */
export function parseResult(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (QUALITATIVE_RESULTS.includes(value)) {
    return { kind: 'qualitative', raw: value, text: value };
  }
  const m = value.match(RESULT_QUANT_PATTERN);
  if (!m) return null;
  const num = Number(m[1]);
  if (!Number.isFinite(num) || num < 0) return null;
  const unit = m[2].toLowerCase();
  return {
    kind: 'quantitative',
    raw: value,
    value: num,
    unit,
    normalizedMgKg: num * UNIT_TO_MG_KG[unit],
    text: value
  };
}

/**
 * 校验单条字段（不做重复性判断）。
 * 返回该条的字段错误列表：[{ code, field, message }]
 */
export function validateFields(rec) {
  const errors = [];
  const sampleCode = (rec.sampleCode || '').trim().toUpperCase();
  const origin = (rec.origin || '').trim();
  const item = (rec.item || '').trim();
  const result = (rec.result || '').trim();
  const batchNo = (rec.batchNo || '').trim().toUpperCase();

  if (!sampleCode) errors.push({ code: 'V0002', field: 'sampleCode', message: '样品编号为空' });
  else if (!SAMPLE_CODE_PATTERN.test(sampleCode)) {
    errors.push({ code: 'V0002', field: 'sampleCode', message: PRECHECK_ERRORS.V0002 });
  }

  if (!origin) errors.push({ code: 'V0003', field: 'origin', message: '产地为空' });
  else if (!originRegistered(origin)) {
    errors.push({ code: 'V0003', field: 'origin', message: PRECHECK_ERRORS.V0003 });
  }

  if (!item) errors.push({ code: 'V0004', field: 'item', message: '检测项目为空' });
  else if (!TEST_ITEMS.includes(item)) {
    errors.push({ code: 'V0004', field: 'item', message: PRECHECK_ERRORS.V0004 });
  }

  if (!result) errors.push({ code: 'V0005', field: 'result', message: '检测结果为空' });
  else if (!parseResult(result)) {
    errors.push({ code: 'V0005', field: 'result', message: PRECHECK_ERRORS.V0005 });
  }

  if (!batchNo) errors.push({ code: 'V0006', field: 'batchNo', message: '批次号为空' });
  else if (!BATCH_PATTERN.test(batchNo)) {
    errors.push({ code: 'V0006', field: 'batchNo', message: PRECHECK_ERRORS.V0006 });
  }

  return { errors, normalized: { sampleCode, origin, item, batchNo, parsedResult: parseResult(result) } };
}

/**
 * 预检整批导入：
 *  - 字段错误 -> invalid（普通失败）
 *  - 文件内重复 / 与库内重复 -> duplicate（单独提示，不混入普通失败）
 * @param records parseCsv 产出的记录
 * @param existingCodes 库中已存在的样品编号集合（Set，大写）
 * @returns {{ valid: Array, invalid: Array, duplicates: Array, summary: object }}
 */
export function precheck(records, existingCodes = new Set()) {
  const valid = [];
  const invalid = [];
  const duplicates = [];
  const seenInFile = new Map(); // sampleCode -> 首次出现行

  for (const rec of records) {
    const { errors, normalized } = validateFields(rec);

    if (errors.length > 0) {
      invalid.push({
        line: rec._line,
        raw: rec,
        errors,
        errorCodes: [...new Set(errors.map(e => e.code))]
      });
      continue;
    }

    const code = normalized.sampleCode;
    if (seenInFile.has(code)) {
      duplicates.push({
        line: rec._line,
        raw: rec,
        normalized,
        errorCode: DUPLICATE_CODE,
        message: `${DUPLICATE_DESC}（首次出现于第 ${seenInFile.get(code)} 行）`
      });
      continue;
    }
    if (existingCodes.has(code)) {
      duplicates.push({
        line: rec._line,
        raw: rec,
        normalized,
        errorCode: DUPLICATE_DB_CODE,
        message: DUPLICATE_DB_DESC
      });
      continue;
    }

    seenInFile.set(code, rec._line);
    valid.push({ line: rec._line, raw: rec, normalized });
  }

  return {
    valid,
    invalid,
    duplicates,
    summary: {
      total: records.length,
      valid: valid.length,
      invalid: invalid.length,
      duplicate: duplicates.length
    }
  };
}
