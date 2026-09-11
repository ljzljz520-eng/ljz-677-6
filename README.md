# 农产品检测批量报送

质检员导入 CSV（样品编号、产地、检测项目、检测结果、批次），系统先做字段预检，
再按批上送监管平台；平台异常回传后可按错误码筛选。重复样品单独提示，**不混入普通失败**。

零外部依赖，Node.js >= 18，内置 `node:test` 测试。

## 快速开始

```bash
npm test                                   # 24 个单元/端到端测试
npm run demo                               # 完整演示（干净台账）
node src/cli.js reset-ledger               # 清空报送台账
```

## CLI

```bash
node src/cli.js run samples/samples.csv                 # 全量报告
node src/cli.js filter samples/samples.csv --code P201  # 按错误码筛选
node src/cli.js filter samples/samples.csv --code P201,P202
node src/cli.js run samples/samples.csv --stage precheck
node src/cli.js run samples/samples.csv --code D001     # 重复样品需显式筛选
node src/cli.js run samples/samples.csv --json
```

## 处理流水线

```
CSV 导入
  └─ 表头校验（缺列直接中止）
      └─ 预检 precheck
           ├─ 字段校验 F*  → invalid（不上送）
           ├─ 重复识别 D*  → duplicates（独立通道）
           └─ 合法记录     → 按批次分组 submitBatches
                               ├─ 成功 → succeeded + 写台账
                               └─ 回传 P* / D003 → failed
```

关键约束：`D001/D002/D003` 永远落在 duplicates 通道（平台 D003 在 failed 中
带 duplicate 标记），报告里有独立分区；`filterErrors` 默认也不把重复记录
混进普通异常，只有显式 `--code D0xx` 或 `--include-duplicates` 才会出现。

## 错误码

| 码 | 含义 | 阶段 |
|---|---|---|
| F101–F111 | 字段预检错误（空值、格式、未备案产地/项目、单位不符等） | 预检 |
| D001 | 文件内样品编号重复 | 预检（重复通道） |
| D002 | 样品已报送过（本地台账命中） | 预检（重复通道） |
| D003 | 平台判定样品编号已存在 | 上送（重复通道） |
| P201 | 批次未备案 | 上送 |
| P202 | 检测项目无资质 | 上送 |
| P203 | 结果值超范围 | 上送 |
| P301/P500/P504 | 限流/平台错误/网关超时（自动指数退避重试，默认 3 次） | 上送 |

## 模块

- `src/csvParser.js` CSV 解析（BOM、引号转义、CRLF、行号）
- `src/catalog.js` 产地/检测项目/已备案批次主数据
- `src/errorCodes.js` 统一错误码字典与分类
- `src/precheck.js` 字段预检 + 重复分流
- `src/platform.js` 监管平台客户端（模拟）、报送台账、重试
- `src/submitter.js` 按批分组上送
- `src/pipeline.js` 编排 + 异常按错误码/阶段筛选
- `src/report.js` / `src/cli.js` 报告与命令行

## 接入真实系统的替换点

1. `PlatformClient.uploadEntry` 换成真实监管平台 HTTP 调用，业务回传映射到既有 P*/D003 码；
   传输层故障继续抛 `PlatformTransportError` 以复用重试。
2. `catalog.js` 的产地/项目/批次表改为平台主数据接口。
3. `Ledger` 可替换为数据库中"样品编号 + 受理状态"唯一索引；平台侧查重保持 D003 语义。
4. `runPipeline` 是纯函数式编排，可直接包到 HTTP 接口（如 `/imports`、`/imports/:id/errors?code=P201`）后面。
