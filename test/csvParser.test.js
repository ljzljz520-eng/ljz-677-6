import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvToRecords } from '../src/services/csvParser.js';

test('解析中文表头 CSV，支持引号内逗号', () => {
  const csv = '样品编号,产地,检测项目,结果,批次\nSMP-001,"潍坊市,寿光市",农药残留,合格,B20260926-01';
  const records = csvToRecords(csv);
  assert.equal(records.length, 1);
  assert.equal(records[0].sampleNo, 'SMP-001');
  assert.equal(records[0].origin, '潍坊市,寿光市');
  assert.equal(records[0].batchNo, 'B20260926-01');
});

test('兼容英文表头与 CRLF', () => {
  const csv = 'sampleNo,origin,testItem,result,batchNo\r\nSMP-002,青州,重金属,不合格,B20260926-02\r\n';
  const records = csvToRecords(csv);
  assert.equal(records.length, 1);
  assert.equal(records[0].testItem, '重金属');
});
