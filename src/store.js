// JSON 文件存储（零依赖、同步写）。生产可替换为数据库实现。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const EMPTY_STATE = () => ({
  samples: {},        // sampleCode -> sample 对象（最新状态）
  submissions: [],    // 上送流水
  imports: [],        // 导入批次审计
  seq: 0
});

export class JsonStore {
  constructor(file) {
    this.file = file;
    this.state = EMPTY_STATE();
    this.load();
  }

  load() {
    try {
      if (existsSync(this.file)) {
        this.state = JSON.parse(readFileSync(this.file, 'utf8'));
      }
    } catch (err) {
      // 文件损坏时不阻断启动，从空库开始并留错误日志
      console.error('[store] 状态文件读取失败，使用空库:', err.message);
      this.state = EMPTY_STATE();
    }
  }

  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(tmp, this.file); // 同目录原子替换
  }

  reset() {
    this.state = EMPTY_STATE();
    this.save();
  }

  nextId(prefix) {
    this.state.seq += 1;
    return `${prefix}${String(this.state.seq).padStart(6, '0')}`;
  }
}
