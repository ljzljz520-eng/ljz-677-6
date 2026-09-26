# 农产品检测批量报送系统

质检员批量导入农产品检测结果，系统**先做字段预检**，再**按批次上送监管平台**；平台异常回传后可**按错误码筛选**；**重复样品单独识别与提示**，不混入普通失败。

零依赖（仅使用 Node.js 内置模块），无需联网安装包，Node ≥ 18。

## 快速开始

```bash
npm start            # http://localhost:3000
npm test             # 26 个自动化测试（node:test）
PORT=3111 npm start  # 自定义端口
```

页面操作：① 选择/粘贴 CSV 导入 → ② 在“按批上送”面板点“上送” → ③ 在“异常回传”面板按类别/错误码/批次筛选，平台异常可单条重试。

## CSV 格式（UTF-8，首行表头）

```csv
样品编号,产地,检测项目,结果,批次
A-10001,山东寿光蔬菜基地,铅,0.12mg/kg,B20260926-001
A-10002,河北保定,有机磷农药,合格,B20260926-001
```

- 结果支持定性：`合格` / `不合格`；定量：`数字 + mg/kg | g/kg | mg/L | %`（统一归一到 mg/kg）
- 页面可下载模板；支持引号转义、字段内换行、CRLF、UTF-8 BOM
- 示例文件：`samples/samples-good.csv`、`samples/samples-with-errors.csv`（覆盖全部错误码与重复场景）

## 处理流程与错误码体系

| 阶段 | 错误码 | 含义 |
|---|---|---|
| 预检 | V0001 | 列缺失或表头无法识别 |
| 预检 | V0002 | 样品编号格式不正确（字母开头，6–32 位） |
| 预检 | V0003 | 产地为空或未登记 |
| 预检 | V0004 | 检测项目不在目录内 |
| 预检 | V0005 | 检测结果格式不正确 |
| 预检 | V0006 | 批次号格式不正确（`B+8位日期-+3位序号`） |
| **重复（单独类）** | **D1001** | 文件内样品编号重复（仅首次通过入库） |
| **重复（单独类）** | **D1002** | 样品编号已存在于系统中（不覆盖原数据） |
| 监管平台 | E2001 | 产地未备案 |
| 监管平台 | E2002 | 检测项目超出实验室资质范围（微生物类） |
| 监管平台 | E2003 | 结果数值超出平台限值（>1000 mg/kg） |
| 监管平台 | E5003 | 平台临时不可用（可重试，重试成功） |

**关键业务规则**：
- 字段失败（V 类）→ `invalid`；重复样品（D 类）→ `duplicate`，两类分开统计、分开筛选，重复**绝不**计入普通失败
- 字段校验未通过的行不进入后续重复判定；仅预检通过的样品入库为 `pending`
- 上送只发送 `pending` 样品；平台异常样品置 `rejected`，可单条重试（E5003 为临时性错误）
- 编号、批次号自动大写归一；定量结果按单位换算后参与平台限值校验

## REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/imports` | 导入 CSV（body 直传 text/csv 或 JSON `{csv, fileName}`） |
| POST | `/api/submissions` | 按批上送 `{batchNo, failureRate?}` |
| POST | `/api/samples/:code/retry` | 重试单条平台异常 |
| GET | `/api/exceptions?category=&errorCode=&batchNo=` | 异常统一查询（category: `platform`/`precheck`/`duplicate`） |
| GET | `/api/samples?status=&batchNo=&errorCode=` | 样品台账 |
| GET | `/api/batches` | 批次概览（含错误分布） |
| GET | `/api/stats` `/api/error-codes` | 统计 / 错误码目录 |
| POST | `/api/reset` | 清空演示数据 |

## 目录结构

```
src/catalog.js    错误码、检测项目目录、产地目录、格式正则
src/csv.js        零依赖 CSV 解析/序列化
src/precheck.js   字段预检 + 重复识别（D1001/D1002）
src/platform.js   监管平台适配器（模拟回传 E2001/E2002/E2003/E5003）
src/store.js      JSON 文件持久化（原子写）
src/service.js    业务编排：导入→预检→入库→上送→筛选→重试
src/server.js     HTTP 服务（REST + 静态页）
public/           前端单页（原生 JS）
test/             26 个单元/集成/HTTP 端到端测试
samples/          示例 CSV
```

> 说明：监管平台为内置确定性模拟适配器（`src/platform.js`），接入真实平台时只需替换该模块的 `submit` 实现，报文由 `buildPayload` 生成。
