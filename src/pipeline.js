/**
 * 主编排流水线：
 *   CSV 导入 -> 表头校验 -> 字段预检 -> 重复分流 -> 按批上送 -> 汇总结果
 */
import { readFileSync } from 'node:fs';
import { parseCsv } from './csvParser.js';
import { precheck, REQUIRED_HEADERS } from './precheck.js';
import { submitBatches } from './submitter.js';

export class HeaderError extends Error {
  constructor(missing) {
    super(`CSV 表头缺少必需列：${missing.join('、')}`);
    this.name = 'HeaderError';
    this.missing = missing;
  }
}

export function loadCsvFile(filePath) {
  return readFileSync(filePath, 'utf8');
}

export function validateHeaders(headers) {
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) throw new HeaderError(missing);
}

/**
 * @param opts.filePath CSV 路径（与 text 二选一）
 * @param opts.text     CSV 文本
 * @param opts.client   PlatformClient
 * @param opts.ledger   Ledger
 * @param opts.retryOpts withRetry 选项
 */
export async function runPipeline(opts) {
  const text = opts.text ?? loadCsvFile(opts.filePath);
  const { headers, rows } = parseCsv(text);
  validateHeaders(headers);

  const pre = precheck(rows, opts.ledger);
  const submitted = pre.valid.length === 0
    ? { succeeded: [], failed: [], batchResults: [] }
    : await submitBatches(opts.client, pre.valid, opts.ledger, opts.retryOpts ?? {});

  // 平台侧查重 D003 同样属于“重复样品”，统一并入 duplicates 通道，
  // 与 P* 普通平台失败分开，避免混入普通失败列表。
  const platformDuplicates = submitted.failed
    .filter((f) => f.code === 'D003')
    .map((f) => ({
      line: f.line,
      sampleCode: f.sampleCode,
      batchNo: f.batchNo,
      origin: f.origin,
      testItem: f.testItem,
      result: f.result,
      errors: [{ code: 'D003', message: '平台判定样品编号已存在' }]
    }));
  const platformFailed = submitted.failed.filter((f) => f.code !== 'D003');

  return {
    source: opts.filePath ?? '<inline-text>',
    counts: {
      total: pre.stats.total,
      valid: pre.stats.valid,
      invalid: pre.stats.invalid,
      duplicates: pre.stats.duplicates + platformDuplicates.length,
      submittedOk: submitted.succeeded.length,
      submittedFail: platformFailed.length
    },
    invalid: pre.invalid,       // 字段预检失败（F*）
    duplicates: [...pre.duplicates, ...platformDuplicates], // D001/D002/D003
    succeeded: submitted.succeeded,
    failed: platformFailed,     // 平台回传普通失败（P*）
    batchResults: submitted.batchResults
  };
}

/**
 * 异常筛选：从全部异常记录（预检失败 + 平台失败）中按错误码/阶段过滤。
 * 重复样品有独立提示通道，默认不混入普通异常；仅在显式按 D0xx 筛选
 * （或 includeDuplicates=true）时才出现。
 *
 * @param result runPipeline 的返回值
 * @param filter { code?: string, codes?: string[], stage?: 'precheck'|'submit',
 *                 includeDuplicates?: boolean }
 */
export function filterErrors(result, filter = {}) {
  const isDupRec = (errors) => errors.some((e) => e.code.startsWith('D0'));

  const flattenInvalid = result.invalid.map((r) => ({
    line: r.line, sampleCode: r.sampleCode, batchNo: r.batchNo,
    errors: r.errors, stage: 'precheck'
  }));
  const flattenFailed = result.failed.map((r) => ({
    line: r.line, sampleCode: r.sampleCode, batchNo: r.batchNo,
    errors: [{ code: r.code }], stage: 'submit'
  }));
  const flattenDuplicates = result.duplicates.map((r) => ({
    line: r.line, sampleCode: r.sampleCode, batchNo: r.batchNo,
    errors: r.errors,
    stage: r.errors.some((e) => e.code === 'D003') ? 'submit' : 'precheck'
  }));

  const all = [...flattenInvalid, ...flattenFailed, ...flattenDuplicates];
  const wantedCodes = filter.codes ?? (filter.code ? [filter.code] : null);
  const wantsDuplicateCodes = Boolean(wantedCodes?.some((c) => c.startsWith('D0')));

  return all.filter((rec) => {
    // 1. 重复通道隔离：除非显式筛选重复码或显式纳入，否则不混入普通异常
    if (isDupRec(rec.errors) && !wantsDuplicateCodes && !filter.includeDuplicates) {
      return false;
    }
    // 2. 错误码筛选（记录命中任一指定码即可）
    if (wantedCodes) {
      return rec.errors.some((e) => wantedCodes.includes(e.code));
    }
    // 3. 阶段筛选
    if (filter.stage) {
      return rec.stage === filter.stage;
    }
    return true;
  });
}
