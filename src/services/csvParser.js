import { KEY_ALIASES } from '../domain/validators.js';

/** 轻量 CSV 解析：支持引号包裹、内嵌逗号、"" 转义、\r\n、BOM */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { row.push(field); field = ''; i += 1; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      rows.push(row); row = [];
      i += 1; continue;
    }
    field += c; i += 1;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function mapHeader(headerCells) {
  const lower = headerCells.map((h) => h.trim().toLowerCase());
  const columnMap = {};
  for (const [field, aliases] of Object.entries(KEY_ALIASES)) {
    const idx = lower.findIndex((h) => aliases.some((a) => a.toLowerCase() === h));
    columnMap[field] = idx >= 0 ? idx : null;
  }
  return columnMap;
}

/** CSV 文本 -> 标准字段记录数组（首行为表头） */
export function csvToRecords(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const columnMap = mapHeader(rows[0]);
  const records = [];
  for (let i = 1; i < rows.length; i += 1) {
    const record = {};
    for (const [field, col] of Object.entries(columnMap)) {
      record[field] = col === null ? '' : (rows[i][col] ?? '');
    }
    records.push(record);
  }
  return records;
}
