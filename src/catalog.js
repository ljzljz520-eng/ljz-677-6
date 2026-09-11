/**
 * 领域基础数据：产地备案表、检测项目目录、已备案批次
 * 实际项目中这些数据来自监管平台主数据接口，这里以内存表模拟。
 */

/** 已备案产地：编码 => 名称 */
export const ORIGINS = Object.freeze({
  'OR-SD-001': '山东寿光蔬菜基地',
  'OR-HN-014': '海南三亚芒果产区',
  'OR-HLJ-007': '黑龙江五常水稻产区',
  'OR-XJ-021': '新疆库尔勒香梨产区'
});

/**
 * 检测项目目录
 *  - unit：定量项目要求的结果单位（定性项目为 null）
 *  - qualitative：是否定性项目
 *  - max：定量结果上限（超过则预检不拦截，由平台 P203 判定；此处仅做基础合法性参考）
 *  - qualifiedCertExpired：模拟该项目检测资质是否过期（过期则平台回传 P202）
 */
export const TEST_ITEMS = Object.freeze({
  '农残-有机磷': { unit: 'mg/kg', qualitative: false, min: 0, max: 100, qualifiedCertExpired: false },
  '重金属-铅': { unit: 'mg/kg', qualitative: false, min: 0, max: 10, qualifiedCertExpired: false },
  '黄曲霉毒素': { unit: 'μg/kg', qualitative: false, min: 0, max: 50, qualifiedCertExpired: false },
  '瘦肉精': { unit: null, qualitative: true, qualifiedCertExpired: false },
  '非法添加-苏丹红': { unit: null, qualitative: true, qualifiedCertExpired: true } // 演示 P202
});

/** 已备案批次号（监管平台侧）。不在表中的批次上送时回传 P201 */
export const REGISTERED_BATCHES = Object.freeze(new Set([
  'BATCH-20260910-001',
  'BATCH-20260910-002'
]));

export const QUALITATIVE_RESULTS = Object.freeze(['合格', '不合格', '阳性', '阴性']);
