/**
 * 监管平台客户端接口：
 *   submitBatch(batchNo, records) => {
 *     batchNo,
 *     accepted,            // 整批是否全部受理
 *     batchErrorCode?,     // 整批级错误码（如批次锁定）
 *     batchErrorMessage?,
 *     receipts: [{ sampleNo, testItem, status: 'ACCEPTED'|'REJECTED', errorCode?, message?, platformRef? }]
 *   }
 *
 * 生产环境替换为真实 HTTP 客户端；此处 Mock 用于本地联调与演示。
 * Mock 规则（仅演示用）：
 *   - 批次号以 -LOCK 结尾  => 整批拒绝，错误码 E3002（批次已锁定）
 *   - 样品编号包含 "ERR"   => 单条拒绝，错误码 E3099（平台内部错误）
 *   - 其余 => 受理
 */
export class MockRegulatoryClient {
  constructor() {
    this.submittedBatches = [];
  }

  async submitBatch(batchNo, records) {
    this.submittedBatches.push({ batchNo, recordCount: records.length });

    if (batchNo.endsWith('-LOCK')) {
      return {
        batchNo,
        accepted: false,
        batchErrorCode: 'E3002',
        batchErrorMessage: '批次已锁定，禁止报送',
        receipts: records.map((r) => ({
          sampleNo: r.sampleNo,
          testItem: r.testItem,
          status: 'REJECTED',
          errorCode: 'E3002',
          message: '批次已锁定，禁止报送',
        })),
      };
    }

    const receipts = records.map((r) => (r.sampleNo.includes('ERR')
      ? {
          sampleNo: r.sampleNo,
          testItem: r.testItem,
          status: 'REJECTED',
          errorCode: 'E3099',
          message: '平台内部错误，请稍后重试',
        }
      : {
          sampleNo: r.sampleNo,
          testItem: r.testItem,
          status: 'ACCEPTED',
          platformRef: `REG-${batchNo}-${r.sampleNo}`,
        }));

    return {
      batchNo,
      accepted: receipts.every((x) => x.status === 'ACCEPTED'),
      receipts,
    };
  }
}
