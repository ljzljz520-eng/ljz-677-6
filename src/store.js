import { randomUUID } from 'node:crypto';

/** 内存存储：导入批次、上送批次、平台回执、已受理记录键。
 *  生产环境可替换为数据库实现，接口保持不变。 */
export class Store {
  constructor() {
    this.imports = new Map();       // importId -> 预检报告
    this.submissions = new Map();   // submissionId -> 上送结果
    this.receipts = [];             // 平台回执（含 errorCode）
    this.submittedKeys = new Set(); // 已受理记录的 dedupKey（样品编号::检测项目）
  }

  createImport(report) {
    const record = { id: randomUUID(), createdAt: new Date().toISOString(), ...report };
    this.imports.set(record.id, record);
    return record;
  }

  getImport(id) {
    return this.imports.get(id) ?? null;
  }

  saveSubmission(submission) {
    this.submissions.set(submission.id, submission);
  }

  addReceipt(receipt) {
    this.receipts.push(receipt);
  }

  markAccepted(key) {
    this.submittedKeys.add(key);
  }

  /** 回执筛选：errorCode / batchNo / status / sampleNo 任意组合 */
  queryReceipts({ errorCode, batchNo, status, sampleNo } = {}) {
    return this.receipts.filter((r) =>
      (errorCode === undefined || r.errorCode === errorCode) &&
      (batchNo === undefined || r.batchNo === batchNo) &&
      (status === undefined || r.status === status) &&
      (sampleNo === undefined || r.sampleNo === sampleNo));
  }

  /** 回执汇总：按状态、按错误码计数 */
  receiptSummary() {
    const byStatus = {};
    const byErrorCode = {};
    for (const r of this.receipts) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.errorCode) byErrorCode[r.errorCode] = (byErrorCode[r.errorCode] ?? 0) + 1;
    }
    return { total: this.receipts.length, byStatus, byErrorCode };
  }
}
