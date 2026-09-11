/**
 * 极简 CSV 解析器（RFC4180 子集）：
 *  - 自动剥离 UTF-8 BOM
 *  - 支持双引号包裹、引号内逗号/换行、"" 转义
 *  - 第一行为表头，返回 { headers, rows }，rows 中保留原始行号（1 起，含表头偏移）
 */

export function parseCsv(text) {
  if (typeof text !== 'string') {
    throw new TypeError('parseCsv 仅接受字符串');
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const records = tokenize(text);
  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].map((h) => h.trim());
  const rows = records
    .slice(1)
    .map((cells, idx) => {
      // 跳过完全空白的行（所有单元格均为空串）
      const row = {};
      headers.forEach((h, i) => {
        row[h] = (cells[i] ?? '').trim();
      });
      row._line = idx + 2; // 数据首行对应文件第 2 行
      return row;
    })
    .filter((r) => Object.keys(r).some((k) => k !== '_line' && r[k] !== ''));

  return { headers, rows };
}

function tokenize(text) {
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      pushRecord();
    } else if (ch === '\n') {
      pushRecord();
    } else {
      field += ch;
    }
  }
  // 末行无换行符时收尾
  if (field !== '' || record.length > 0) {
    pushRecord();
  }
  return records;
}
