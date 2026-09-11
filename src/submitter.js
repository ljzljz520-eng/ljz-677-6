/**
 * 按批上送：预检通过的记录按批次号分组，逐批调用监管平台。
 * 平台驳回逐条带回错误码；传输重试耗尽后记 P500。
 * 成功受理的样品写入台账（每批结束落盘一次）。
 */
import { withRetry, PlatformTransportError } from './platform.js';

export function groupByBatch(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.batchNo)) groups.set(record.batchNo, []);
    groups.get(record.batchNo).push(record);
  }
  return groups;
}

/**
 * @param client PlatformClient
 * @param records 预检通过的记录
 * @param ledger Ledger
 */
export async function submitBatches(client, records, ledger, retryOpts = {}) {
  const groups = groupByBatch(records);
  const succeeded = [];
  const failed = [];
  const batchResults = [];

  for (const [batchNo, batchRecords] of groups) {
    const startedAt = Date.now();
    let batchOk = 0;
    let batchFail = 0;

    for (const record of batchRecords) {
      try {
        const receipt = await withRetry(
          () => client.uploadEntry(record),
          retryOpts
        );
        if (receipt.ok) {
          batchOk += 1;
          ledger.add(record.sampleCode);
          succeeded.push({ ...record, receipt });
        } else {
          batchFail += 1;
          failed.push({ ...record, code: receipt.code });
        }
      } catch (err) {
        batchFail += 1;
        const code = err instanceof PlatformTransportError ? err.code : 'P500';
        failed.push({ ...record, code, transportError: true });
      }
    }

    ledger.save?.();
    batchResults.push({
      batchNo,
      total: batchRecords.length,
      succeeded: batchOk,
      failed: batchFail,
      durationMs: Date.now() - startedAt
    });
  }

  return { succeeded, failed, batchResults };
}
