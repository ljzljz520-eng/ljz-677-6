/**
 * 预检阶段：
 *  1. 字段级校验（F* 错误码）—— 不合法记录不进入上送
 *  2. 重复样品识别（D* 错误码）—— 单独通道，绝不与普通失败混在一起
 *     - D001：同一文件内样品编号重复（从第 2 次出现起）
 *     - D002：样品编号已在监管平台台账中（历史已成功报送）
 */
import { ERROR_CODES } from './errorCodes.js';
import { ORIGINS, TEST_ITEMS, QUALITATIVE_RESULTS } from './catalog.js';

export const REQUIRED_HEADERS = ['样品编号', '产地', '检测项目', '检测结果', '批次'];

const SAMPLE_CODE_RE = /^[A-Za-z0-9-]{4,32}$/;
const BATCH_RE = /^BATCH-\d{8}-[A-Za-z0-9]{3,}$/;
const QUANT_RE = /^(-?\d+(?:\.\d+)?)\s*(\S+)$/;

/** 解析检测结果字符串，非法返回 null */
export function parseResult(raw, item) {
  if (item.qualitative) {
    return QUALITATIVE_RESULTS.includes(raw) ? { kind: 'qualitative', verdict: raw } : null;
  }
  const m = QUANT_RE.exec(raw);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  return { kind: 'quantitative', value, unit: m[2] };
}

function err(code, field) {
  return { code, field, message: ERROR_CODES[code].message };
}

/**
 * @param rows csvParser 产出的行对象数组
 * @param ledger 已报送台账（具有 has() 的集合，如 Set / Ledger）
 */
export function precheck(rows, ledger = new Set()) {
  const firstLineByCode = new Map(); // sampleCode -> 文件内首次出现行号
  const valid = [];
  const invalid = [];
  const duplicates = [];

  for (const row of rows) {
    const sampleCode = row['样品编号'] ?? '';
    const origin = row['产地'] ?? '';
    const testItem = row['检测项目'] ?? '';
    const rawResult = row['检测结果'] ?? '';
    const batchNo = row['批次'] ?? '';
    const line = row._line;

    const fieldErrors = validateFields({ sampleCode, origin, testItem, rawResult, batchNo });

    // —— 重复判定（仅对形态合法的样品编号进行）—— //
    const dupErrors = [];
    let duplicateOfLine;
    const codeLooksUsable = sampleCode !== '' && SAMPLE_CODE_RE.test(sampleCode);
    if (codeLooksUsable) {
      if (firstLineByCode.has(sampleCode)) {
        dupErrors.push(err('D001', '样品编号'));
        duplicateOfLine = firstLineByCode.get(sampleCode);
      } else if (ledger.has?.(sampleCode)) {
        dupErrors.push(err('D002', '样品编号'));
      }
      if (!firstLineByCode.has(sampleCode)) {
        firstLineByCode.set(sampleCode, line);
      }
    }

    if (dupErrors.length > 0) {
      // 重复样品单独通道；同时附上该行其它字段问题，方便质检员一次处理
      duplicates.push({
        line, sampleCode, batchNo, origin, testItem, result: rawResult,
        duplicateOfLine,
        errors: [...dupErrors, ...fieldErrors]
      });
      continue;
    }

    if (fieldErrors.length > 0) {
      invalid.push({
        line, sampleCode, batchNo, origin, testItem, result: rawResult,
        errors: fieldErrors
      });
      continue;
    }

    valid.push({
      line,
      sampleCode,
      origin,
      originName: ORIGINS[origin],
      testItem,
      result: rawResult,
      parsedResult: parseResult(rawResult, TEST_ITEMS[testItem]),
      batchNo
    });
  }

  return {
    valid,
    invalid,
    duplicates,
    stats: {
      total: rows.length,
      valid: valid.length,
      invalid: invalid.length,
      duplicates: duplicates.length
    }
  };
}

function validateFields({ sampleCode, origin, testItem, rawResult, batchNo }) {
  const errors = [];

  if (sampleCode === '') {
    errors.push(err('F101', '样品编号'));
  } else if (!SAMPLE_CODE_RE.test(sampleCode)) {
    errors.push(err('F102', '样品编号'));
  }

  if (origin === '') {
    errors.push(err('F103', '产地'));
  } else if (!ORIGINS[origin]) {
    errors.push(err('F104', '产地'));
  }

  const item = TEST_ITEMS[testItem];
  if (testItem === '') {
    errors.push(err('F105', '检测项目'));
  } else if (!item) {
    errors.push(err('F106', '检测项目'));
  }

  if (rawResult === '') {
    errors.push(err('F107', '检测结果'));
  } else if (item) {
    const parsed = parseResult(rawResult, item);
    if (!parsed) {
      errors.push(err('F108', '检测结果'));
    } else if (parsed.kind === 'quantitative' && parsed.unit !== item.unit) {
      errors.push(err('F109', '检测结果'));
    }
  }

  if (batchNo === '') {
    errors.push(err('F110', '批次'));
  } else if (!BATCH_RE.test(batchNo)) {
    errors.push(err('F111', '批次'));
  }

  return errors;
}
