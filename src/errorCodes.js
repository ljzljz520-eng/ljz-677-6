/**
 * 统一错误码字典
 *
 * 分类：
 *  - F*  字段预检错误（本地预检阶段产生，记录不进入上送）
 *  - D*  重复样品错误（单独分流，不混入普通失败）
 *  - P*  监管平台回传错误（上送阶段产生）
 *
 * retryable=true 的平台错误会被自动重试（指数退避）。
 */
export const ERROR_CODES = Object.freeze({
  // ---- 字段预检 ----
  F101: { message: '样品编号不能为空', retryable: false, stage: 'precheck' },
  F102: { message: '样品编号格式错误（应为字母/数字/连字符，4-32位）', retryable: false, stage: 'precheck' },
  F103: { message: '产地不能为空', retryable: false, stage: 'precheck' },
  F104: { message: '产地编码未备案', retryable: false, stage: 'precheck' },
  F105: { message: '检测项目不能为空', retryable: false, stage: 'precheck' },
  F106: { message: '检测项目不支持', retryable: false, stage: 'precheck' },
  F107: { message: '检测结果不能为空', retryable: false, stage: 'precheck' },
  F108: { message: '检测结果格式错误（定量需为“数值 单位”，定性需为 合格/不合格/阳性/阴性）', retryable: false, stage: 'precheck' },
  F109: { message: '结果单位与检测项目要求不一致', retryable: false, stage: 'precheck' },
  F110: { message: '批次号不能为空', retryable: false, stage: 'precheck' },
  F111: { message: '批次号格式错误（应为 BATCH-YYYYMMDD-xxx）', retryable: false, stage: 'precheck' },

  // ---- 重复样品（单独类别 duplicate，绝不并入普通失败）----
  D001: { message: '文件内样品编号重复', retryable: false, stage: 'precheck', category: 'duplicate' },
  D002: { message: '样品已报送过监管平台（台账命中）', retryable: false, stage: 'precheck', category: 'duplicate' },
  D003: { message: '平台判定样品编号已存在', retryable: false, stage: 'submit', category: 'duplicate' },

  // ---- 监管平台回传 ----
  P201: { message: '批次未在监管平台备案', retryable: false, stage: 'submit' },
  P202: { message: '该检测项目无对应检测资质', retryable: false, stage: 'submit' },
  P203: { message: '结果值超出可接受范围', retryable: false, 'stage': 'submit' },
  P301: { message: '平台限流，请稍后重试', retryable: true, stage: 'submit' },
  P404: { message: '监管平台接口不存在/路由错误', retryable: false, stage: 'submit' },
  P500: { message: '监管平台内部错误', retryable: true, stage: 'submit' },
  P504: { message: '监管平台网关超时', retryable: true, stage: 'submit' },
  P900: { message: '平台回传未知错误', retryable: false, stage: 'submit' }
});

/** 重复类错误码集合 —— 用于把重复样品从普通失败中拆出来单独提示 */
export const DUPLICATE_CODES = Object.freeze(
  Object.keys(ERROR_CODES).filter((code) => ERROR_CODES[code].category === 'duplicate')
);

export function isDuplicateCode(code) {
  return DUPLICATE_CODES.includes(code);
}

export function isRetryable(code) {
  return Boolean(ERROR_CODES[code]?.retryable);
}

export function describeError(code) {
  return ERROR_CODES[code] ? `${code} ${ERROR_CODES[code].message}` : `${code} 未知错误码`;
}
