// 监管平台适配器（模拟外部 HTTP 报送）。
// 行为确定性：同一样品同一阶段的首次上送才可能 E5003，重试成功，便于联调和测试。
import {
  UNQUALIFIED_ITEMS, PLATFORM_MAX_VALUE, PLATFORM_ERRORS
} from './catalog.js';

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * 构造平台上送报文
 */
export function buildPayload(sample, batchNo) {
  return {
    sampleCode: sample.sampleCode,
    origin: sample.origin,
    item: sample.item,
    result: sample.resultText,
    valueMgKg: sample.valueMgKg ?? null,
    batchNo
  };
}

/**
 * 模拟上送。
 * @param sample 归一化样品 { sampleCode, origin, item, resultText, valueMgKg }
 * @param batchNo 批次号
 * @param options.attempt 上送序号（1 = 首次，2 = 重试）
 * @param options.failureRate E5003 模拟比例（默认 0.1），测试可置 0
 * @returns {{ accepted: boolean, receipt?: string, errorCode?: string, message: string }}
 */
export function submit(sample, batchNo, options = {}) {
  const attempt = options.attempt ?? 1;
  const failureRate = options.failureRate ?? 0.1;

  // E2001：产地未备案。预检只校验产地前缀是否登记；平台还有更细的备案库，
  // “保税区/未备案”产地虽前缀合法，但在监管平台没有备案。
  if (/保税区|未备案/.test(sample.origin)) {
    return reject('E2001');
  }

  // E2002：检测项目超出实验室资质（微生物类）
  if (UNQUALIFIED_ITEMS.includes(sample.item)) {
    return reject('E2002');
  }

  // E2003：结果数值超平台限值
  if (typeof sample.valueMgKg === 'number' && sample.valueMgKg > PLATFORM_MAX_VALUE) {
    return reject('E2003');
  }

  // E5003：平台临时不可用，仅首次上送、按确定性比例触发；重试成功
  if (attempt === 1) {
    const key = `${batchNo}|${sample.sampleCode}`;
    if (hashCode(key) % 100 < failureRate * 100) {
      return reject('E5003');
    }
  }

  const receipt = `RCV-${batchNo}-${sample.sampleCode}-${Date.now().toString(36)}`;
  return { accepted: true, receipt, message: '平台已接收' };
}

function reject(code) {
  return { accepted: false, errorCode: code, message: PLATFORM_ERRORS[code] };
}
