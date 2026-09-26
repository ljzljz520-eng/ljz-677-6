import { validateRecord, normalizeRecord, dedupKey } from '../domain/validators.js';
import { DUPLICATE_CODES } from '../domain/errorCodes.js';

/**
 * 预检：字段校验 + 重复样品识别。
 * 关键规则：重复样品进入 duplicates 单独提示，绝不混入 failures（普通失败）。
 * 字段校验失败的记录不参与重复判定。
 *
 * @param {Array} rawRecords 原始记录
 * @param {{submittedKeys?: Set<string>}} options 已报送成功记录的 dedupKey 集合
 */
export function precheck(rawRecords, { submittedKeys = new Set() } = {}) {
  const valid = [];
  const failures = [];
  const duplicates = [];
  const seenInFile = new Map(); // dedupKey -> 首次出现的行号

  rawRecords.forEach((raw, index) => {
    const row = index + 1;
    const record = normalizeRecord(raw);

    const errors = validateRecord(record);
    if (errors.length > 0) {
      failures.push({ row, record, errors });
      return;
    }

    const key = dedupKey(record);
    // 文件内重复优先判定：同一文件中后续重复行指向首行（即使首行本身与已报送冲突）
    if (seenInFile.has(key)) {
      duplicates.push({
        row,
        record,
        code: 'D2001',
        message: DUPLICATE_CODES.D2001,
        duplicateOfRow: seenInFile.get(key),
      });
      return;
    }
    if (submittedKeys.has(key)) {
      seenInFile.set(key, row); // 占位，使本文件后续重复行归为 D2001 而非重复报 D2002
      duplicates.push({ row, record, code: 'D2002', message: DUPLICATE_CODES.D2002 });
      return;
    }

    seenInFile.set(key, row);
    valid.push({ row, record });
  });

  return {
    total: rawRecords.length,
    validCount: valid.length,
    failureCount: failures.length,
    duplicateCount: duplicates.length,
    valid,
    failures,
    duplicates,
  };
}
