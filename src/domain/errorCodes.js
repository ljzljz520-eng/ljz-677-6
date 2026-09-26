/**
 * 错误码目录。
 * - E1xxx：导入预检阶段（字段级）
 * - D2xxx：重复样品提示（独立于普通失败，不计入 failures）
 * - E3xxx：监管平台回执错误码（由平台返回，本系统原样存储并支持筛选）
 */
export const PRECHECK_ERROR_CODES = Object.freeze({
  E1001: { field: 'sampleNo', message: '样品编号缺失' },
  E1002: { field: 'sampleNo', message: '样品编号格式非法（3-32位，字母/数字/连字符，须字母或数字开头）' },
  E1011: { field: 'origin', message: '产地缺失' },
  E1012: { field: 'origin', message: '产地超长（不超过100字符）' },
  E1021: { field: 'testItem', message: '检测项目缺失' },
  E1022: { field: 'testItem', message: '检测项目不在目录内' },
  E1031: { field: 'result', message: '检测结果缺失' },
  E1032: { field: 'result', message: '检测结果取值非法（合格/不合格）' },
  E1041: { field: 'batchNo', message: '批次号缺失' },
  E1042: { field: 'batchNo', message: '批次号格式非法（3-32位，字母/数字/连字符）' },
});

export const DUPLICATE_CODES = Object.freeze({
  D2001: '本次导入文件内重复样品',
  D2002: '与已报送成功的记录重复',
});
