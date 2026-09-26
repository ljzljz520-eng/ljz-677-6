// HTTP 服务：REST API + 静态页面（零依赖）。
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { existsSync, readFileSync, createReadStream } from 'node:fs';
import { JsonStore } from './store.js';
import { ReportService } from './service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const DATA_FILE = process.env.DATA_FILE || join(__dirname, '..', 'data', 'db.json');

const store = new JsonStore(DATA_FILE);
const service = new ReportService(store);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 10 * 1024 * 1024) { reject(new Error('请求体过大（上限 10MB）')); req.destroy(); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    return sendJson(res, 404, { error: 'not_found', path: pathname });
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  const q = url.searchParams;

  try {
    // ---------- API ----------
    if (p.startsWith('/api/')) {
      // 错误码目录
      if (p === '/api/error-codes' && req.method === 'GET') {
        return sendJson(res, 200, service.errorCatalog());
      }
      // 概览
      if (p === '/api/stats' && req.method === 'GET') {
        return sendJson(res, 200, service.stats());
      }
      if (p === '/api/batches' && req.method === 'GET') {
        return sendJson(res, 200, service.listBatches());
      }
      // 导入（支持 text/csv 与 JSON {csv}）
      if (p === '/api/imports' && req.method === 'POST') {
        const ct = req.headers['content-type'] || '';
        let csvText;
        let fileName = q.get('name') || 'upload.csv';
        if (ct.includes('application/json')) {
          const body = JSON.parse(await readBody(req));
          csvText = body.csv ?? '';
          if (body.fileName) fileName = body.fileName;
        } else {
          csvText = await readBody(req);
        }
        return sendJson(res, 200, service.importCsv(csvText, fileName));
      }
      // 按批上送
      if (p === '/api/submissions' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (!body.batchNo) return sendJson(res, 400, { error: 'batchNo_required', message: '请指定批次号' });
        return sendJson(res, 200, service.submitBatch(body.batchNo, { failureRate: body.failureRate }));
      }
      // 重试单条
      if (p.startsWith('/api/samples/') && p.endsWith('/retry') && req.method === 'POST') {
        const code = decodeURIComponent(p.split('/')[3]);
        const body = JSON.parse((await readBody(req)) || '{}');
        return sendJson(res, 200, service.retrySample(code, { failureRate: body.failureRate }));
      }
      // 样品列表
      if (p === '/api/samples' && req.method === 'GET') {
        return sendJson(res, 200, service.listSamples({
          batchNo: q.get('batchNo') || undefined,
          status: q.get('status') || undefined,
          errorCode: q.get('errorCode') || undefined
        }));
      }
      // 异常查询（按错误码筛选）
      if (p === '/api/exceptions' && req.method === 'GET') {
        return sendJson(res, 200, service.listExceptions({
          batchNo: q.get('batchNo') || undefined,
          category: q.get('category') || undefined,
          errorCode: q.get('errorCode') || undefined
        }));
      }
      // 清空演示数据
      if (p === '/api/reset' && req.method === 'POST') {
        return sendJson(res, 200, service.reset());
      }
      return sendJson(res, 404, { error: 'api_not_found', path: p });
    }

    // ---------- 静态资源 ----------
    if (req.method === 'GET') return serveStatic(req, res, p);
    sendJson(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    console.error('[server]', err);
    sendJson(res, 500, { error: 'internal_error', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_RUN_MAIN !== 'false') {
  server.listen(PORT, () => {
    console.log(`农产品检测批量报送系统已启动: http://localhost:${PORT}`);
    console.log(`数据文件: ${DATA_FILE}`);
  });
}

export { server, service };
