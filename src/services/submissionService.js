import { randomUUID } from 'node:crypto';
import { dedupKey } from '../domain/validators.js';
import { DUPLICATE_CODES } from '../domain/errorCodes.js';

/**
 * 按批上送：把导入记录中通过预检的记录按批次号分组，逐批调用监管平台客户端。
 * - 平台回执逐条落库（store.receipts），含 errorCode，供事后按错误码筛选。
 * - 已被平台受理的记录进入 submittedKeys；再次上送时作为重复跳过（skippedDuplicates），
 *   不进入普通失败；被平台拒绝的记录可修正后重新上送。
 */
export async function submitImport(store, client, importId, { batchNos } = {}) {
  const importRecord = store.getImport(importId);
  if (!importRecord) {
    const err = new Error(`导入记录不存在: ${importId}`);
    err.statusCode = 404;
    throw err;
  }

  const byBatch = new Map();
  const skippedDuplicates = [];
  for (const { row, record } of importRecord.valid) {
    if (batchNos && !batchNos.includes(record.batchNo)) continue;
    if (store.submittedKeys.has(dedupKey(record))) {
      skippedDuplicates.push({ row, record, code: 'D2002', message: `${DUPLICATE_CODES.D2002}，本次跳过` });
      continue;
    }
    if (!byBatch.has(record.batchNo)) byBatch.set(record.batchNo, []);
    byBatch.get(record.batchNo).push(record);
  }

  if (byBatch.size === 0) {
    const err = new Error('没有可上送的有效记录（可能均已报送成功，或不属于指定批次）');
    err.statusCode = 400;
    throw err;
  }

  const submission = {
    id: randomUUID(),
    importId,
    createdAt: new Date().toISOString(),
    batches: [],
    skippedDuplicates,
    totals: { submitted: 0, accepted: 0, rejected: 0 },
  };

  for (const [batchNo, records] of byBatch) {
    const response = await client.submitBatch(batchNo, records);
    const receipts = response.receipts.map((r) => {
      const receipt = {
        id: randomUUID(),
        submissionId: submission.id,
        importId,
        batchNo,
        sampleNo: r.sampleNo,
        testItem: r.testItem,
        status: r.status, // ACCEPTED | REJECTED
        errorCode: r.errorCode ?? null,
        message: r.message ?? null,
        platformRef: r.platformRef ?? null,
        receivedAt: new Date().toISOString(),
      };
      store.addReceipt(receipt);
      if (receipt.status === 'ACCEPTED') store.markAccepted(dedupKey(receipt));
      return receipt;
    });

    const accepted = receipts.filter((r) => r.status === 'ACCEPTED').length;
    const rejected = receipts.length - accepted;
    submission.batches.push({
      batchNo,
      recordCount: records.length,
      acceptedCount: accepted,
      rejectedCount: rejected,
      batchErrorCode: response.batchErrorCode ?? null,
      batchErrorMessage: response.batchErrorMessage ?? null,
      receipts,
    });
    submission.totals.submitted += records.length;
    submission.totals.accepted += accepted;
    submission.totals.rejected += rejected;
  }

  store.saveSubmission(submission);
  return submission;
}
