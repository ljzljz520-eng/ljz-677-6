// 核心业务编排：导入预检 -> 入库 -> 按批上送 -> 异常查询/重试。
import { parseCsv } from './csv.js';
import { precheck } from './precheck.js';
import * as platform from './platform.js';
import { STATUS, ALL_ERROR_CODES } from './catalog.js';

export class ReportService {
  constructor(store, clock = () => new Date()) {
    this.store = store;
    this.clock = clock;
  }

  now() { return this.clock().toISOString(); }

  /**
   * 导入 CSV：预检字段、识别重复，仅通过预检的样品入库为 pending。
   */
  importCsv(text, fileName = 'upload.csv') {
    const { records, missingColumns } = parseCsv(text);
    const importId = this.store.nextId('IMP');
    const at = this.now();

    let result;
    if (missingColumns.length > 0) {
      // 整表缺列：所有数据行记为 V0001（普通失败），不进入重复判定
      const invalid = records.map(rec => ({
        line: rec._line,
        raw: rec,
        errors: [{ code: 'V0001', field: null, message: `缺少必需列：${missingColumns.join('、')}` }],
        errorCodes: ['V0001']
      }));
      result = {
        valid: [], invalid, duplicates: [],
        summary: { total: records.length, valid: 0, invalid: invalid.length, duplicate: 0 }
      };
    } else {
      result = precheck(records, new Set(Object.keys(this.store.state.samples)));
    }

    // 通过预检的样品入库（pending，等待按批上送）
    const acceptedSamples = [];
    for (const v of result.valid) {
      const n = v.normalized;
      const sample = {
        sampleCode: n.sampleCode,
        origin: n.origin,
        item: n.item,
        resultKind: n.parsedResult.kind,
        resultText: n.parsedResult.text,
        valueMgKg: n.parsedResult.kind === 'quantitative' ? n.parsedResult.normalizedMgKg : null,
        batchNo: n.batchNo,
        status: STATUS.PENDING,
        errorCode: null,
        errorMessage: null,
        receipt: null,
        attempts: 0,
        importId,
        sourceLine: v.line,
        createdAt: at,
        updatedAt: at
      };
      this.store.state.samples[sample.sampleCode] = sample;
      acceptedSamples.push(sample.sampleCode);
    }

    // 导入审计（含失败/重复明细，供错误码筛选）
    this.store.state.imports.push({
      id: importId,
      fileName,
      at,
      summary: result.summary,
      acceptedSamples,
      invalidRows: result.invalid.map(r => ({
        line: r.line,
        sampleCode: r.raw.sampleCode || '',
        origin: r.raw.origin || '',
        item: r.raw.item || '',
        result: r.raw.result || '',
        batchNo: (r.raw.batchNo || '').toUpperCase(),
        errorCodes: r.errorCodes,
        errors: r.errors
      })),
      duplicateRows: result.duplicates.map(d => ({
        line: d.line,
        sampleCode: d.normalized?.sampleCode || (d.raw.sampleCode || '').toUpperCase(),
        origin: d.normalized?.origin || d.raw.origin || '',
        item: d.normalized?.item || d.raw.item || '',
        result: d.normalized?.parsedResult?.text || d.raw.result || '',
        batchNo: d.normalized?.batchNo || (d.raw.batchNo || '').toUpperCase(),
        errorCode: d.errorCode,
        message: d.message
      }))
    });

    this.store.save();

    return {
      importId,
      at,
      fileName,
      summary: result.summary,
      acceptedSamples,
      invalid: this.store.state.imports[this.store.state.imports.length - 1].invalidRows,
      duplicates: this.store.state.imports[this.store.state.imports.length - 1].duplicateRows
    };
  }

  /**
   * 按批次上送：提交该批次下所有 pending 样品。
   */
  submitBatch(batchNo, options = {}) {
    const targets = Object.values(this.store.state.samples)
      .filter(s => s.batchNo === batchNo && s.status === STATUS.PENDING);

    const results = targets.map(s => this._send(s, 'send', options));
    const summary = {
      batchNo,
      total: targets.length,
      accepted: results.filter(r => r.accepted).length,
      rejected: results.filter(r => !r.accepted).length
    };
    this.store.save();
    return { ...summary, results };
  }

  /**
   * 重试单条平台异常（E5003 为临时性错误，重试通常成功）。
   */
  retrySample(sampleCode, options = {}) {
    const s = this.store.state.samples[sampleCode];
    if (!s) return { found: false, accepted: false, message: '样品不存在' };
    if (s.status !== STATUS.REJECTED) {
      return { found: true, accepted: false, message: `当前状态 ${s.status}，无需重试` };
    }
    const result = this._send(s, 'retry', options);
    this.store.save();
    return { found: true, ...result };
  }

  _send(sample, phase, options) {
    sample.attempts += 1;
    const res = platform.submit(
      {
        sampleCode: sample.sampleCode,
        origin: sample.origin,
        item: sample.item,
        resultText: sample.resultText,
        valueMgKg: sample.valueMgKg
      },
      sample.batchNo,
      { attempt: sample.attempts, ...options }
    );

    if (res.accepted) {
      sample.status = STATUS.SUBMITTED;
      sample.errorCode = null;
      sample.errorMessage = null;
      sample.receipt = res.receipt;
    } else {
      sample.status = STATUS.REJECTED;
      sample.errorCode = res.errorCode;
      sample.errorMessage = res.message;
    }
    sample.updatedAt = this.now();

    this.store.state.submissions.push({
      id: this.store.nextId('SUB'),
      at: sample.updatedAt,
      phase,
      sampleCode: sample.sampleCode,
      batchNo: sample.batchNo,
      attempt: sample.attempts,
      accepted: !!res.accepted,
      errorCode: res.errorCode || null,
      message: res.message,
      receipt: res.receipt || null
    });

    return {
      sampleCode: sample.sampleCode,
      accepted: !!res.accepted,
      errorCode: res.errorCode || null,
      message: res.message,
      receipt: res.receipt || null,
      status: sample.status
    };
  }

  /**
   * 样品查询（按批次/状态）
   */
  listSamples(filter = {}) {
    let rows = Object.values(this.store.state.samples);
    if (filter.batchNo) rows = rows.filter(s => s.batchNo === filter.batchNo);
    if (filter.status) rows = rows.filter(s => s.status === filter.status);
    if (filter.errorCode) rows = rows.filter(s => s.errorCode === filter.errorCode);
    return rows.sort((a, b) => a.batchNo.localeCompare(b.batchNo) || a.sampleCode.localeCompare(b.sampleCode));
  }

  /**
   * 异常统一查询：平台回传(rejected) + 预检失败(invalid) + 重复(duplicate)
   * 重复样品单独成类，绝不混入普通失败。
   */
  listExceptions(filter = {}) {
    const rows = [];

    for (const s of Object.values(this.store.state.samples)) {
      if (s.status !== STATUS.REJECTED) continue;
      rows.push({
        source: 'platform',
        category: 'platform',
        batchNo: s.batchNo,
        sampleCode: s.sampleCode,
        origin: s.origin,
        item: s.item,
        result: s.resultText,
        status: s.status,
        errorCode: s.errorCode,
        message: s.errorMessage,
        receipt: s.receipt,
        at: s.updatedAt
      });
    }

    for (const imp of this.store.state.imports) {
      for (const r of imp.invalidRows) {
        rows.push({
          source: 'precheck',
          category: 'precheck',
          importId: imp.id,
          line: r.line,
          batchNo: r.batchNo,
          sampleCode: r.sampleCode,
          origin: r.origin,
          item: r.item,
          result: r.result,
          status: STATUS.INVALID,
          errorCodes: r.errorCodes,
          errorCode: r.errorCodes[0],
          message: r.errors.map(e => `${e.code} ${e.message}`).join('；')
        });
      }
      for (const d of imp.duplicateRows) {
        rows.push({
          source: 'duplicate',
          category: 'duplicate',
          importId: imp.id,
          line: d.line,
          batchNo: d.batchNo,
          sampleCode: d.sampleCode,
          origin: d.origin,
          item: d.item,
          result: d.result,
          status: STATUS.DUPLICATE,
          errorCode: d.errorCode,
          message: d.message
        });
      }
    }

    return rows.filter(r => {
      if (filter.batchNo && r.batchNo !== filter.batchNo) return false;
      if (filter.category && r.category !== filter.category) return false;
      if (filter.errorCode) {
        if (r.category === 'precheck') return r.errorCodes.includes(filter.errorCode);
        return r.errorCode === filter.errorCode;
      }
      return true;
    }).sort((a, b) => (a.batchNo || '').localeCompare(b.batchNo || '') || (a.sampleCode || '').localeCompare(b.sampleCode || ''));
  }

  /** 批次概览（按批汇总状态计数与平台错误分布） */
  listBatches() {
    const map = new Map();
    for (const s of Object.values(this.store.state.samples)) {
      if (!map.has(s.batchNo)) {
        map.set(s.batchNo, { batchNo: s.batchNo, total: 0, pending: 0, submitted: 0, rejected: 0, errors: {} });
      }
      const b = map.get(s.batchNo);
      b.total += 1;
      b[s.status] = (b[s.status] || 0) + 1;
      if (s.status === STATUS.REJECTED) {
        b.errors[s.errorCode] = (b.errors[s.errorCode] || 0) + 1;
      }
    }
    return [...map.values()].sort((a, b) => a.batchNo.localeCompare(b.batchNo));
  }

  stats() {
    const samples = Object.values(this.store.state.samples);
    const counts = { pending: 0, submitted: 0, rejected: 0 };
    for (const s of samples) counts[s.status] = (counts[s.status] || 0) + 1;
    const precheckFailed = this.store.state.imports.reduce((n, i) => n + i.invalidRows.length, 0);
    const duplicates = this.store.state.imports.reduce((n, i) => n + i.duplicateRows.length, 0);
    return {
      samples: samples.length,
      ...counts,
      precheckFailed,
      duplicates,
      imports: this.store.state.imports.length,
      submissions: this.store.state.submissions.length
    };
  }

  reset() {
    this.store.reset();
    return { ok: true, at: this.now() };
  }

  errorCatalog() {
    return ALL_ERROR_CODES;
  }
}
