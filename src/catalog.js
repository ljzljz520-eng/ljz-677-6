// 领域常量：错误码、检测项目目录、产地目录

// 预检错误码
export const PRECHECK_ERRORS = {
  V0001: '列缺失或表头无法识别',
  V0002: '样品编号格式不正确',
  V0003: '产地为空或未登记',
  V0004: '检测项目不在目录内',
  V0005: '检测结果格式不正确',
  V0006: '批次号格式不正确'
};

// 重复样品（单独归类，不混入普通失败）
export const DUPLICATE_CODE = 'D1001';
export const DUPLICATE_DESC = '样品编号重复（文件内重复）';
export const DUPLICATE_DB_CODE = 'D1002';
export const DUPLICATE_DB_DESC = '样品编号已存在于系统中';

// 监管平台回传错误码
export const PLATFORM_ERRORS = {
  E2001: '监管平台：产地未备案',
  E2002: '监管平台：检测项目超出实验室资质范围',
  E2003: '监管平台：结果数值超出平台限值',
  E5003: '监管平台：平台临时不可用（可重试）'
};

export const ALL_ERROR_CODES = {
  ...PRECHECK_ERRORS,
  D1001: DUPLICATE_DESC,
  D1002: DUPLICATE_DB_DESC,
  ...PLATFORM_ERRORS
};

// 检测项目目录（实验室资质）
export const TEST_ITEMS = [
  '铅', '镉', '有机磷农药', '瘦肉精', '金黄色葡萄球菌', '亚硝酸盐', '防腐剂合计'
];

// 微生物类项目：实验室无资质，上送时平台回 E2002
export const UNQUALIFIED_ITEMS = ['金黄色葡萄球菌'];

// 平台允许的结果上限（mg/kg 归一化后）
export const PLATFORM_MAX_VALUE = 1000;

// 已登记产地前缀（省/直辖市）
export const REGISTERED_ORIGIN_PREFIXES = [
  '北京', '天津', '上海', '重庆',
  '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江', '安徽',
  '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南',
  '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾',
  '内蒙古', '广西', '西藏', '宁夏', '新疆', '香港', '澳门'
];

// 样品编号：字母开头 + 数字/字母/连字符，6-32 位
export const SAMPLE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9-]{5,31}$/;
// 批次号：B + 8 位日期 + - + 3 位序号，如 B20260926-001
export const BATCH_PATTERN = /^B\d{8}-\d{3}$/;
// 定量结果：数字 + 可选单位（mg/kg、g/kg、%、mg/L）
export const RESULT_QUANT_PATTERN = /^(\d+(?:\.\d+)?)\s*(mg\/kg|g\/kg|mg\/l|%|mg\/L)$/i;
export const QUALITATIVE_RESULTS = ['合格', '不合格'];

// 统一换算到 mg/kg
export const UNIT_TO_MG_KG = {
  'mg/kg': 1,
  'g/kg': 1000,
  '%': 10000,
  'mg/l': 1
};

export const STATUS = {
  PENDING: 'pending',       // 预检通过，待上送
  SUBMITTED: 'submitted',   // 平台已接收
  REJECTED: 'rejected',     // 平台回传异常
  INVALID: 'invalid',       // 预检字段失败（普通失败）
  DUPLICATE: 'duplicate'    // 重复样品（单独提示）
};
