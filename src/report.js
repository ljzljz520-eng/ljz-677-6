/**
 * 文本/JSON 报告渲染。重复样品在报告中拥有独立分区，绝不并入“普通失败”。
 */
import { ERROR_CODES } from './errorCodes.js';

function pad(str, n) {
  // 中文按两个宽度计

  str = String(str);
  let width = 0;
  for (const ch of str) width += ch.charCodeAt(0) > 255 ? 2 : 1;
  return str + ' '.repeat(Math.max(0, n - width));
}

function fmtErrors(errors) {
  return errors
    .map((e) => `${e.code} ${ERROR_CODES[e.code]?.message ?? '未知错误码'}`)
    .join('；');
}

export function renderText(result) {
  const lines = [];
  const c = result.counts;

  lines.push('================ 农产品检测批量报送报告 ================');
  lines.push(`数据来源     : ${result.source}`);
  lines.push(`记录总数     : ${c.total}`);
  lines.push(`预检通过     : ${c.valid}`);
  lines.push(`字段预检失败 : ${c.invalid}  (F*)`);
  lines.push(`重复样品     : ${c.duplicates}  (D*，已单独分流)`);
  lines.push(`平台受理成功 : ${c.submittedOk}`);
  lines.push(`平台回传失败 : ${c.submittedFail}  (P*)`);
  lines.push('');

  lines.push('---------------- 按批上送情况 ----------------');
  if (result.batchResults.length === 0) {
    lines.push('（无可上送批次）');
  } else {
    for (const b of result.batchResults) {
      lines.push(`批次 ${b.batchNo}: 共 ${b.total} 条，成功 ${b.succeeded}，失败 ${b.failed}，耗时 ${b.durationMs}ms`);
    }
  }
  lines.push('');

  // —— 重复样品：独立分区，单独提示 ——
  lines.push(`★★ 重复样品（单独提示，未计入普通失败）: ${result.duplicates.length} 条`);
  if (result.duplicates.length > 0) {
    lines.push(`  ${pad('行号', 4)} ${pad('样品编号', 16)} 原因 / 重复于`);
    for (const d of result.duplicates) {
      const dupCode = d.errors.find((e) => e.code.startsWith('D0'))?.code;
      const extra = dupCode === 'D001' ? `与第 ${d.duplicateOfLine} 行重复`
        : dupCode === 'D002' ? '已在监管平台台账中'
        : dupCode === 'D003' ? '平台判定已存在'
        : '';
      const fieldIssue = d.errors.filter((e) => !e.code.startsWith('D0'));
      lines.push(`  ${pad(d.line, 4)} ${pad(d.sampleCode, 16)} ${dupCode} ${extra}`
        + (fieldIssue.length ? `\n        另有字段问题: ${fmtErrors(fieldIssue)}` : ''));
    }
  }
  lines.push('');

  lines.push(`---------------- 字段预检失败 (F*): ${result.invalid.length} 条 ----------------`);
  for (const r of result.invalid) {
    lines.push(`  行 ${pad(r.line, 4)} 样品 ${pad(r.sampleCode || '(空)', 16)} ${fmtErrors(r.errors)}`);
  }
  lines.push('');

  lines.push(`---------------- 平台回传失败 (P*): ${result.failed.length} 条 ----------------`);
  for (const r of result.failed) {
    lines.push(`  行 ${pad(r.line, 4)} 样品 ${pad(r.sampleCode, 16)} 批次 ${r.batchNo} -> ${fmtErrors([{ code: r.code }])}`);
  }
  lines.push('');

  lines.push(`---------------- 受理成功: ${result.succeeded.length} 条 ----------------`);
  for (const r of result.succeeded) {
    lines.push(`  行 ${pad(r.line, 4)} 样品 ${pad(r.sampleCode, 16)} 回执 ${r.receipt.platformReceipt} @ ${r.receipt.acceptedAt}`);
  }

  return lines.join('\n');
}

export function renderRecords(records) {
  if (records.length === 0) return '（无匹配记录）';
  return records.map((r) => {
    const header = `行 ${r.line}  样品 ${r.sampleCode || '(空)'}  批次 ${r.batchNo || '(空)'}  [阶段:${r.stage}]`;
    return `${header}\n    ${fmtErrors(r.errors)}`;
  }).join('\n');
}
