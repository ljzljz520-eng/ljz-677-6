/**
 * 监管平台客户端（模拟实现，接口形态与真实 HTTP 客户端一致）：
 *  - uploadEntry：逐条上送，返回业务回传；瞬时故障以 PlatformTransportError 抛出
 *  - Ledger：本地成功报送台账（JSON 持久化），供预检 D002 判重
 *  - withRetry：对可重试错误码（P301/P500/P504）指数退避重试
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { ERROR_CODES, isRetryable } from './errorCodes.js';
import { REGISTERED_BATCHES, TEST_ITEMS } from './catalog.js';

export class PlatformTransportError extends Error {
  constructor(code) {
    super(ERROR_CODES[code]?.message ?? `平台传输错误 ${code}`);
    this.name = 'PlatformTransportError';
    this.code = code;
  }
}

export class PlatformClient {
  /**
   * @param opts.accepted Set<string> 平台侧已受理样品（模拟跨报送主体的历史数据，触发 D003）
   * @param opts.clock () => Date
   */
  constructor(opts = {}) {
    this.accepted = opts.accepted ?? new Set();
    this.clock = opts.clock ?? (() => new Date());
    /** 故障注入：sampleCode -> { code: 'P504', times: 2 }，剩余次数内持续抛出 */
    this._faults = new Map();
  }

  /** 为指定样品注入 N 次瞬时故障（用于演示/测试自动重试） */
  injectFault(sampleCode, code, times = 1) {
    if (!isRetryable(code)) {
      throw new Error(`仅可注入可重试错误码，收到 ${code}`);
    }
    this._faults.set(sampleCode, { code, times });
  }

  async uploadEntry(record) {
    // 0. 注入的瞬时传输故障（限流/5xx/超时）
    const fault = this._faults.get(record.sampleCode);
    if (fault && fault.times > 0) {
      fault.times -= 1;
      if (fault.times === 0) this._faults.delete(record.sampleCode);
      throw new PlatformTransportError(fault.code);
    }

    // 1. 平台侧查重（其它渠道已报送，本地台账未必知晓）
    if (this.accepted.has(record.sampleCode)) {
      return { ok: false, code: 'D003' };
    }
    // 2. 批次备案校验
    if (!REGISTERED_BATCHES.has(record.batchNo)) {
      return { ok: false, code: 'P201' };
    }
    // 3. 检测资质校验
    if (TEST_ITEMS[record.testItem]?.qualifiedCertExpired) {
      return { ok: false, code: 'P202' };
    }
    // 4. 结果量值范围校验
    const item = TEST_ITEMS[record.testItem];
    if (record.parsedResult?.kind === 'quantitative' &&
        record.parsedResult.value > item.max) {
      return { ok: false, code: 'P203' };
    }

    // 5. 受理
    this.accepted.add(record.sampleCode);
    return {
      ok: true,
      acceptedAt: this.clock().toISOString(),
      platformReceipt: `RCPT-${record.batchNo}-${record.sampleCode}`
    };
  }
}

/**
 * 指数退避重试：仅对 isRetryable 的传输错误重试，业务驳回不重试。
 */
export async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      const code = err instanceof PlatformTransportError ? err.code : null;
      if (!code || !isRetryable(code) || attempt >= retries) {
        throw err;
      }
      await sleep(baseDelayMs * 2 ** attempt);
      attempt += 1;
    }
  }
}

/** 成功报送台账，JSON 文件持久化 */
export class Ledger {
  constructor(filePath) {
    this.filePath = filePath;
    this.codes = new Set();
    if (filePath && existsSync(filePath)) {
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf8'));
        this.codes = new Set(data.submitted ?? []);
      } catch {
        this.codes = new Set();
      }
    }
  }

  has(code) {
    return this.codes.has(code);
  }

  add(code) {
    this.codes.add(code);
  }

  save() {
    if (!this.filePath) return;
    const payload = JSON.stringify({ submitted: [...this.codes] }, null, 2);
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, payload, 'utf8');
    renameSync(tmp, this.filePath);
  }

  clear() {
    this.codes.clear();
  }
}
