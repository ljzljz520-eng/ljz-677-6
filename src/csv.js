// 零依赖 CSV 解析：支持引号、转义引号、字段内换行、CRLF、UTF-8 BOM。

function tokenize(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false; // 本字段是否出现过内容（用于区分空字段）

  const pushField = () => { row.push(field); field = ''; fieldStarted = false; };
  const pushRow = () => { rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
      fieldStarted = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      pushField(); pushRow();
    } else if (c === '\n') {
      pushField(); pushRow();
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  // 末尾收尾
  if (field.length > 0 || fieldStarted || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}

// 中文表头 -> 标准字段
const HEADER_ALIASES = {
  '样品编号': 'sampleCode',
  '编号': 'sampleCode',
  'samplecode': 'sampleCode',
  '产地': 'origin',
  'origin': 'origin',
  '检测项目': 'item',
  '项目': 'item',
  '检测结果': 'result',
  '结果': 'result',
  'result': 'result',
  '批次': 'batchNo',
  '批次号': 'batchNo',
  'batchno': 'batchNo'
};

const REQUIRED_COLUMNS = ['sampleCode', 'origin', 'item', 'result', 'batchNo'];

/**
 * 解析 CSV 文本为 { headers, records, missingColumns }
 * 缺少必需列时返回 missingColumns，由上层映射成 V0001。
 */
export function parseCsv(text) {
  const rawRows = tokenize(text).map(r => r.map(c => c.trim()));
  const nonEmpty = rawRows.filter(r => r.some(c => c !== ''));
  if (nonEmpty.length === 0) {
    return { headers: [], records: [], missingColumns: REQUIRED_COLUMNS.slice() };
  }

  const headerRow = nonEmpty[0].map(h => HEADER_ALIASES[h] || HEADER_ALIASES[h.toLowerCase()] || null);
  const missingColumns = REQUIRED_COLUMNS.filter(col => !headerRow.includes(col));

  const records = [];
  for (let r = 1; r < nonEmpty.length; r++) {
    const cells = nonEmpty[r];
    const rec = { _line: r + 1 }; // CSV 中的物理行号（含表头）
    for (let c = 0; c < headerRow.length; c++) {
      const key = headerRow[c];
      if (key) rec[key] = (cells[c] ?? '').trim();
    }
    for (const key of REQUIRED_COLUMNS) {
      if (rec[key] === undefined) rec[key] = '';
    }
    records.push(rec);
  }
  return { headers: headerRow.filter(Boolean), records, missingColumns };
}

/** 将样品记录序列化为 CSV（用于模板/导出） */
export function toCsv(rows, columns) {
  const esc = v => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(esc).join(',')];
  for (const row of rows) lines.push(columns.map(c => esc(row[c])).join(','));
  return lines.join('\r\n');
}
