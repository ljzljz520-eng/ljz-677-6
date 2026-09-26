import http from 'node:http';
import { Store } from './store.js';
import { precheck } from './services/precheckService.js';
import { csvToRecords } from './services/csvParser.js';
import { submitImport } from './services/submissionService.js';
import { MockRegulatoryClient } from './platform/regulatoryClient.js';
import { PRECHECK_ERROR_CODES, DUPLICATE_CODES } from './domain/errorCodes.js';
import { TEST_ITEM_CATALOG, RESULT_VALUES } from './domain/validators.js';

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createApp({ store = new Store(), platformClient = new MockRegulatoryClient() } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const seg = path.split('/').filter(Boolean);

      // 健康检查
      if (req.method === 'GET' && path === '/api/health') {
        return sendJson(res, 200, { status: 'ok' });
      }

      // 字典：错误码目录 + 检测项目目录 + 结果取值
      if (req.method === 'GET' && path === '/api/dictionaries') {
        return sendJson(res, 200, {
          precheckErrorCodes: PRECHECK_ERROR_CODES,
          duplicateCodes: DUPLICATE_CODES,
          testItemCatalog: TEST_ITEM_CATALOG,
          resultValues: RESULT_VALUES,
        });
      }

      // 导入 + 预检：支持 text/csv 或 JSON { records: [...] } / { csv: "..." }
      if (req.method === 'POST' && path === '/api/imports') {
        const contentType = req.headers['content-type'] ?? '';
        const body = await readBody(req);
        let records;
        if (contentType.includes('text/csv')) {
          records = csvToRecords(body);
        } else {
          const parsed = JSON.parse(body || '{}');
          records = parsed.records ?? (parsed.csv ? csvToRecords(parsed.csv) : null);
          if (!Array.isArray(records)) {
            return sendJson(res, 400, { error: '请求体需为 records 数组或 csv 文本' });
          }
        }
        if (records.length === 0) {
          return sendJson(res, 400, { error: '导入内容为空' });
        }
        const report = precheck(records, { submittedKeys: store.submittedKeys });
        const saved = store.createImport(report);
        return sendJson(res, 201, saved);
      }

      // 查询导入/预检结果
      if (req.method === 'GET' && seg[0] === 'api' && seg[1] === 'imports' && seg.length === 3) {
        const record = store.getImport(seg[2]);
        if (!record) return sendJson(res, 404, { error: '导入记录不存在' });
        return sendJson(res, 200, record);
      }

      // 按批上送（可选 body: { batchNos: [...] } 只上送指定批次）
      if (req.method === 'POST' && seg[0] === 'api' && seg[1] === 'imports' && seg.length === 4 && seg[3] === 'submit') {
        const body = await readBody(req);
        const options = body ? JSON.parse(body) : {};
        const submission = await submitImport(store, platformClient, seg[2], options);
        return sendJson(res, 201, submission);
      }

      // 回执筛选：?errorCode=&batchNo=&status=&sampleNo=
      if (req.method === 'GET' && path === '/api/receipts') {
        const receipts = store.queryReceipts({
          errorCode: url.searchParams.get('errorCode') ?? undefined,
          batchNo: url.searchParams.get('batchNo') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          sampleNo: url.searchParams.get('sampleNo') ?? undefined,
        });
        return sendJson(res, 200, { total: receipts.length, receipts });
      }

      // 回执汇总：按状态 / 按错误码计数
      if (req.method === 'GET' && path === '/api/receipts/summary') {
        return sendJson(res, 200, store.receiptSummary());
      }

      return sendJson(res, 404, { error: '接口不存在' });
    } catch (err) {
      return sendJson(res, err.statusCode ?? 500, { error: err.message });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`农产品检测批量报送服务已启动: http://localhost:${port}`);
  });
}
