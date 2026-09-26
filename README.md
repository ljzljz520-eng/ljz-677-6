# 农产品检测批量报送

质检员导入样品检测记录（样品编号、产地、检测项目、结果、批次），系统**先预检字段**，再**按批上送监管平台**；
平台异常回执落库后可**按错误码筛选**；**重复样品单独提示**，不混入普通失败。

零外部依赖，仅需 Node.js ≥ 20。

## 快速开始

```bash
npm test          # 运行全部测试（node:test）
npm run demo      # 端到端演示（服务层 + Mock 监管平台）
npm start         # 启动 HTTP 服务，默认 http://localhost:3000
```

## 业务流程

1. **导入**：`POST /api/imports`，支持 `text/csv`（首行表头）或 JSON `{ "records": [...] }`
2. **预检**：字段级校验 + 重复识别，返回 `{ valid, failures, duplicates }` 三个独立清单
3. **按批上送**：`POST /api/imports/:id/submit`，有效记录按批次号分组逐批上送
4. **异常筛选**：`GET /api/receipts?errorCode=E3002`，支持 `errorCode / batchNo / status / sampleNo`

## 错误码

### 预检（E1xxx，普通失败）

| 码 | 字段 | 含义 |
|---|---|---|
| E1001/E1002 | 样品编号 | 缺失 / 格式非法（3-32位字母数字连字符） |
| E1011/E1012 | 产地 | 缺失 / 超过100字符 |
| E1021/E1022 | 检测项目 | 缺失 / 不在目录 |
| E1031/E1032 | 结果 | 缺失 / 非「合格、不合格」 |
| E1041/E1042 | 批次 | 缺失 / 格式非法 |

### 重复提示（D2xxx，独立于失败）

| 码 | 含义 |
|---|---|
| D2001 | 本次导入文件内重复样品（样品编号 + 检测项目相同） |
| D2002 | 与已报送成功的记录重复（含上送时已受理记录的跳过提示） |

### 平台回执（E3xxx，原样存储）

| 码 | 含义（Mock 示例） |
|---|---|
| E3002 | 批次已锁定，禁止报送（整批拒绝） |
| E3099 | 平台内部错误，可重试 |

> 真实平台错误码在 `regulatoryClient` 实现中透传，筛选逻辑不依赖具体码值。

## API

| 方法与路径 | 说明 |
|---|---|
| `GET /api/health` | 健康检查 |
| `GET /api/dictionaries` | 错误码、检测项目目录、结果取值字典 |
| `POST /api/imports` | 导入并预检（CSV 或 JSON） |
| `GET /api/imports/:id` | 查询导入预检结果 |
| `POST /api/imports/:id/submit` | 按批上送，body 可指定 `{ "batchNos": [...] }` |
| `GET /api/receipts?errorCode=&batchNo=&status=&sampleNo=` | 回执筛选 |
| `GET /api/receipts/summary` | 按状态/错误码汇总计数 |

### CSV 示例

```csv
样品编号,产地,检测项目,结果,批次
SMP-0001,山东省寿光市,农药残留,合格,B20260926-01
SMP-0002,山东省寿光市,重金属,不合格,B20260926-01
```

## 关键设计

- **重复与失败严格分离**：重复样品进入 `duplicates`（D2001/D2002），`failures` 中只放字段错误；
  上送时已受理记录进入 `skippedDuplicates`，不增加失败计数。
- **重复判定键**：`样品编号::检测项目`（同一样品的不同检测项目是不同记录）。
- **可重试**：平台拒绝的记录不计入已受理集合，可修正后重新上送。
- **平台可替换**：`MockRegulatoryClient` 仅实现 `submitBatch(batchNo, records)` 接口，
  生产环境换成真实 HTTP 客户端即可，服务层与接口层无需改动。

## 目录结构

```
src/
  domain/        错误码目录、字段校验、重复判定键
  services/      CSV 解析、预检、按批上送
  platform/      监管平台客户端（Mock，可替换）
  store.js       内存存储（可替换为数据库实现）
  server.js      HTTP 接口
test/            node:test 测试（预检/CSV/上送/端到端 API）
scripts/demo.mjs 演示脚本
```
