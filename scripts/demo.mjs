/**
 * 端到端演示（不依赖 HTTP，直接走服务层 + Mock 监管平台）：
 *   node scripts/demo.mjs
 */
import { Store } from '../src/store.js';
import { precheck } from '../src/services/precheckService.js';
import { csvToRecords } from '../src/services/csvParser.js';
import { submitImport } from '../src/services/submissionService.js';
import { MockRegulatoryClient } from '../src/platform/regulatoryClient.js';

const csv = `样品编号,产地,检测项目,结果,批次
SMP-0001,山东省寿光市,农药残留,合格,B20260926-01
SMP-0002,山东省寿光市,重金属,不合格,B20260926-01
SMP-0001,山东省寿光市,农药残留,合格,B20260926-01
SMP-ERR-3,山东省青州市,兽药残留,合格,B20260926-01
SMP-0005,山东省青州市,微生物,合格,B20260926-02
SMP-0006,山东省青州市,食品添加剂,合格,B20260926-LOCK
BAD-编号 ,寿光,未知项目,也许,!!
SMP-0008,,农药残留,合格,B20260926-02`;

const store = new Store();
const client = new MockRegulatoryClient();

console.log('===== 1. 导入 + 预检 =====');
const report = precheck(csvToRecords(csv), { submittedKeys: store.submittedKeys });
const saved = store.createImport(report);
console.log(`总数 ${report.total} | 可上送 ${report.validCount} | 普通失败 ${report.failureCount} | 重复提示 ${report.duplicateCount}`);
console.log('普通失败（字段错误）：');
for (const f of report.failures) {
  console.log(`  第${f.row}行: ${f.errors.map((e) => `${e.code} ${e.message}`).join('；')}`);
}
console.log('重复样品（单独提示，不混入失败）：');
for (const d of report.duplicates) {
  console.log(`  第${d.row}行 ${d.record.sampleNo}/${d.record.testItem}: ${d.code} ${d.message}`);
}

console.log('\n===== 2. 按批上送监管平台 =====');
const submission = await submitImport(store, client, saved.id);
for (const b of submission.batches) {
  console.log(`批次 ${b.batchNo}: 报送 ${b.recordCount}，受理 ${b.acceptedCount}，拒绝 ${b.rejectedCount}${b.batchErrorCode ? `（整批 ${b.batchErrorCode}）` : ''}`);
}
console.log(`合计：受理 ${submission.totals.accepted}，拒绝 ${submission.totals.rejected}`);

console.log('\n===== 3. 异常回执按错误码筛选 =====');
const errorCodes = [...new Set(store.receipts.filter((r) => r.errorCode).map((r) => r.errorCode))];
for (const code of errorCodes) {
  const list = store.queryReceipts({ errorCode: code });
  console.log(`${code} (${list.length}条): ${list.map((r) => `${r.sampleNo}/${r.testItem}`).join('、')}`);
}

console.log('\n===== 4. 重复导入同文件：已受理记录提示 D2002 =====');
const reReport = precheck(csvToRecords(csv), { submittedKeys: store.submittedKeys });
for (const d of reReport.duplicates.filter((d) => d.code === 'D2002')) {
  console.log(`  第${d.row}行 ${d.record.sampleNo}/${d.record.testItem}: ${d.code} ${d.message}`);
}
console.log(`再次预检：可上送 ${reReport.validCount}（已受理的不再算），普通失败仍为 ${reReport.failureCount}`);
