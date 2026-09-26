import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 每个测试进程独立数据文件与端口
process.env.DATA_FILE = join(tmpdir(), `agri-http-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
process.env.PORT = String(4000 + Math.floor(Math.random() * 1000));

const { server } = await import('../src/server.js');

await new Promise(r => server.once('listening', r));
const base = `http://localhost:${server.address().port}`;

const json = async (path, opts = {}) => {
  const res = await fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  return { status: res.status, body: await res.json() };
};

test('HTTP 全链路：导入(含重复/坏行) -> 上送 -> 错误码筛选 -> 重试', async () => {
  // 1. 错误码目录
  const codes = await json('/api/error-codes');
  assert.equal(codes.body.E2002, '监管平台：检测项目超出实验室资质范围');

  // 2. 导入：CSV 文本直传
  const csv = '样品编号,产地,检测项目,结果,批次\n' +
    'H-00001,山东,铅,0.1mg/kg,B20260926-100\n' +
    'H-00002,福建,金黄色葡萄球菌,合格,B20260926-100\n' +
    'H-00001,山东,铅,0.1mg/kg,B20260926-100\n';
  const imp = await fetch(base + '/api/imports', { method: 'POST', body: csv });
  const impBody = await imp.json();
  assert.deepEqual(impBody.summary, { total: 3, valid: 2, invalid: 0, duplicate: 1 });
  assert.equal(impBody.duplicates[0].errorCode, 'D1001');

  // 3. 按批上送（failureRate=0 排除临时故障，稳定得到 E2002）
  const sub = await json('/api/submissions', { method: 'POST', body: JSON.stringify({ batchNo: 'B20260926-100', failureRate: 0 }) });
  assert.equal(sub.body.accepted, 1);
  assert.equal(sub.body.rejected, 1);

  // 4. 异常筛选：仅平台 E2002
  const ex = await json('/api/exceptions?category=platform&errorCode=E2002');
  assert.equal(ex.body.length, 1);
  assert.equal(ex.body[0].sampleCode, 'H-00002');

  // 5. 重复单独筛选，不与平台异常混在一起
  const dup = await json('/api/exceptions?category=duplicate');
  assert.equal(dup.body.length, 1);
  assert.equal(dup.body[0].status, 'duplicate');

  // 6. 静态页面可访问
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /农产品检测批量报送系统/);

  server.close();
});
