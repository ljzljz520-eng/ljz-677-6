#!/usr/bin/env node
/**
 * 命令行：
 *   agri-submit run <file.csv> [--code P201,...] [--stage submit|precheck]
 *                              [--include-duplicates] [--json] [--reset]
 *   agri-submit filter <file.csv> --code P201,D001   等价于 run + --code
 *   agri-submit reset-ledger
 */
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { runPipeline, filterErrors } from './pipeline.js';
import { PlatformClient, Ledger } from './platform.js';
import { renderText, renderRecords } from './report.js';

const LEDGER_PATH = resolve('.data/ledger.json');

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--code') flags.code = args[++i];
    else if (a === '--stage') flags.stage = args[++i];
    else if (a === '--json') flags.json = true;
    else if (a === '--include-duplicates') flags.includeDuplicates = true;
    else if (a === '--reset') flags.reset = true;
    else positional.push(a);
  }
  return { flags, positional };
}

async function main() {
  const [command, ...rest] = argv.slice(2);
  const { flags, positional } = parseFlags(rest);

  if (command === 'reset-ledger') {
    const ledger = new Ledger(LEDGER_PATH);
    ledger.clear();
    ledger.save();
    console.log('报送台账已清空');
    return;
  }

  if (command !== 'run' && command !== 'filter') {
    console.log(
      '用法:\n' +
      '  agri-submit run <file.csv> [--code P201,...] [--stage submit|precheck]\n' +
      '                            [--include-duplicates] [--json] [--reset]\n' +
      '  agri-submit filter <file.csv> --code P201,D001\n' +
      '  agri-submit reset-ledger'
    );
    exit(1);
  }

  const filePath = positional[0];
  if (!filePath) {
    console.error('错误：缺少 CSV 文件路径');
    exit(1);
  }

  // --reset 忽略历史台账（用于演示 D002 之外的干净重跑）
  const ledger = flags.reset ? new Ledger(null) : new Ledger(LEDGER_PATH);
  if (flags.reset) ledger.save = () => {};

  const client = new PlatformClient();
  const result = await runPipeline({
    filePath: resolve(filePath),
    client,
    ledger,
    retryOpts: { retries: 3, baseDelayMs: 200 }
  });

  const codes = (flags.code ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const filtering = command === 'filter' || codes.length > 0 || Boolean(flags.stage);

  if (filtering) {
    const matched = filterErrors(result, {
      codes: codes.length ? codes : null,
      stage: flags.stage,
      includeDuplicates: flags.includeDuplicates
    });
    if (flags.json) {
      console.log(JSON.stringify(matched, null, 2));
    } else {
      console.log(
        `筛选条件: 错误码=${codes.length ? codes.join(',') : '(不限)'}` +
        `  阶段=${flags.stage ?? '(不限)'}`
      );
      console.log(`命中 ${matched.length} 条记录（重复样品单独通道，默认不混入）\n`);
      console.log(renderRecords(matched));
    }
    return;
  }

  console.log(flags.json ? JSON.stringify(result, null, 2) : renderText(result));
}

main().catch((err) => {
  console.error(`执行失败: ${err.message}`);
  exit(1);
});
