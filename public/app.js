/* 农产品检测批量报送 - 前端逻辑（零依赖原生 JS） */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

let errorCatalog = {};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body && !options.raw ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.raw ? options.body : (options.body ? JSON.stringify(options.body) : undefined)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || '请求失败');
  return data;
}

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function escArgs(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (i < values.length ? esc(values[i]) : ''), '');
}

const CATEGORY_LABEL = { platform: '平台异常', precheck: '预检失败', duplicate: '重复样品' };
const CATEGORY_BADGE = { platform: 'b-rejected', precheck: 'b-invalid', duplicate: 'b-duplicate' };

/* ---------- 错误码下拉 ---------- */
async function loadErrorCodes() {
  errorCatalog = await api('/api/error-codes');
  const sel = $('#f-code');
  const groups = { '预检错误码 V0xxx': [], '重复样品 D1xxx': [], '监管平台 Exxxx': [] };
  for (const [code, desc] of Object.entries(errorCatalog)) {
    if (code.startsWith('V')) groups['预检错误码 V0xxx'].push([code, desc]);
    else if (code.startsWith('D')) groups['重复样品 D1xxx'].push([code, desc]);
    else groups['监管平台 Exxxx'].push([code, desc]);
  }
  sel.innerHTML = '<option value="">全部错误码</option>' +
    Object.entries(groups).map(([g, items]) =>
      `<optgroup label="${esc(g)}">${items.map(([c, d]) => `<option value="${c}">${c} ${esc(d)}</option>`).join('')}</optgroup>`
    ).join('');
}

/* ---------- 总览 ---------- */
async function loadStats() {
  const s = await api('/api/stats');
  $('#st-total').textContent = s.samples;
  $('#st-pending').textContent = s.pending;
  $('#st-submitted').textContent = s.submitted;
  $('#st-rejected').textContent = s.rejected;
  $('#st-invalid').textContent = s.precheckFailed;
  $('#st-duplicate').textContent = s.duplicates;
}

/* ---------- 批次 ---------- */
async function loadBatches() {
  const batches = await api('/api/batches');
  const tbody = $('#batch-table tbody');
  if (!batches.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无批次，请先导入样品</td></tr>';
  } else {
    tbody.innerHTML = batches.map(b => {
      const errs = Object.entries(b.errors || {}).map(([c, n]) => `${c}×${n}`).join('，');
      return `<tr>
        <td>${esc(b.batchNo)}</td>
        <td>${b.total}</td>
        <td>${b.pending || 0}</td>
        <td>${b.submitted || 0}</td>
        <td>${b.rejected || 0}${errs ? `<div class="hint">${esc(errs)}</div>` : ''}</td>
        <td>${b.pending ? `<button class="btn btn-sm" data-batch="${esc(b.batchNo)}">上送</button>` : '—'}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('button[data-batch]').forEach(btn => {
      btn.addEventListener('click', () => submitBatch(btn.dataset.batch));
    });
  }
  const batchSel = $('#f-batch');
  const cur = batchSel.value;
  batchSel.innerHTML = '<option value="">全部批次</option>' +
    batches.map(b => `<option value="${esc(b.batchNo)}">${esc(b.batchNo)}</option>`).join('');
  batchSel.value = cur;
}

async function submitBatch(batchNo) {
  const r = await api('/api/submissions', { body: { batchNo } });
  toast(`批次 ${batchNo} 上送完成：接收 ${r.accepted}，异常 ${r.rejected}`);
  await refreshAll();
}

/* ---------- 导入 ---------- */
function renderImportResult(r) {
  const box = $('#import-result');
  box.classList.remove('hidden', 'has-err');
  const bad = r.summary.invalid + r.summary.duplicate;
  if (bad > 0) box.classList.add('has-err');
  let html = `<div><strong>导入批次 ${esc(r.importId)}</strong>：共 ${r.summary.total} 行，
    预检通过入库 <strong>${r.summary.valid}</strong>，
    字段失败 <strong style="color:#b91c1c">${r.summary.invalid}</strong>，
    重复样品 <strong style="color:#6d28d9">${r.summary.duplicate}</strong>（单独提示，未计入普通失败）。</div>`;
  if (r.invalid.length) {
    html += '<ul>' + r.invalid.slice(0, 8).map(d =>
      `<li>第${d.line}行 ${esc(d.sampleCode || '(无编号)')}：${d.errorCodes.join('、')} — ${esc(d.errors.map(e => e.message).join('；'))}</li>`
    ).join('') + (r.invalid.length > 8 ? `<li>…其余 ${r.invalid.length - 8} 条见异常筛选</li>` : '') + '</ul>';
  }
  if (r.duplicates.length) {
    html += '<ul>' + r.duplicates.slice(0, 8).map(d =>
      `<li style="color:#6d28d9">第${d.line}行 ${esc(d.sampleCode)}：${d.errorCode} — ${esc(d.message)}</li>`
    ).join('') + (r.duplicates.length > 8 ? `<li>…其余 ${r.duplicates.length - 8} 条见“重复样品”筛选</li>` : '') + '</ul>';
  }
  box.innerHTML = html;
}

async function doImport(csvText, fileName) {
  if (!csvText.trim()) { toast('请选择文件或粘贴 CSV 内容'); return; }
  const r = await api('/api/imports', {
    body: JSON.stringify({ csv: csvText, fileName }),
    headers: { 'Content-Type': 'application/json' }
  });
  renderImportResult(r);
  await refreshAll();
}

/* ---------- 异常筛选 ---------- */
async function loadExceptions() {
  const params = new URLSearchParams();
  const cat = $('#f-category').value;
  const code = $('#f-code').value;
  const batch = $('#f-batch').value;
  if (cat) params.set('category', cat);
  if (code) params.set('errorCode', code);
  if (batch) params.set('batchNo', batch);
  const rows = await api(`/api/exceptions?${params}`);
  const tbody = $('#ex-table tbody');
  $('#ex-empty').classList.toggle('hidden', rows.length > 0);
  tbody.innerHTML = rows.map(r => {
    const codes = r.category === 'precheck'
      ? (r.errorCodes || []).map(c => `<span class="tag tag-precheck">${esc(c)}</span>`).join('')
      : `<span class="tag tag-${esc(r.category)}">${esc(r.errorCode)}</span>`;
    const retry = r.category === 'platform'
      ? `<button class="btn btn-sm" data-retry="${esc(r.sampleCode)}">重试</button>` : '';
    return `<tr>
      <td><span class="badge ${CATEGORY_BADGE[r.category]}">${CATEGORY_LABEL[r.category]}</span></td>
      <td>${codes}</td>
      <td>${esc(r.batchNo)}</td>
      <td>${esc(r.sampleCode)}</td>
      <td>${esc(r.origin)}</td>
      <td>${esc(r.item)}</td>
      <td>${esc(r.result)}</td>
      <td>${esc(r.message)}</td>
      <td>${retry}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('button[data-retry]').forEach(btn =>
    btn.addEventListener('click', async () => {
      const r = await api(`/api/samples/${encodeURIComponent(btn.dataset.retry)}/retry`, { method: 'POST', body: {} });
      toast(r.accepted ? `重试成功，回执 ${r.receipt}` : `重试结果：${r.message}`);
      await refreshAll();
    })
  );
}

/* ---------- 样品台账 ---------- */
const STATUS_BADGE = { pending: 'b-pending', submitted: 'b-submitted', rejected: 'b-rejected' };
const STATUS_LABEL = { pending: '待上送', submitted: '已接收', rejected: '平台异常' };
async function loadSamples() {
  const status = $('#f-status').value;
  const rows = await api(`/api/samples${status ? `?status=${status}` : ''}`);
  $('#sample-table tbody').innerHTML = rows.length ? rows.map(s => `<tr>
    <td>${esc(s.batchNo)}</td>
    <td>${esc(s.sampleCode)}</td>
    <td>${esc(s.origin)}</td>
    <td>${esc(s.item)}</td>
    <td>${esc(s.resultText)}</td>
    <td><span class="badge ${STATUS_BADGE[s.status]}">${STATUS_LABEL[s.status]}</span></td>
    <td>${s.status === 'submitted' ? esc(s.receipt) : (s.errorCode ? `${esc(s.errorCode)} ${esc(s.errorMessage || '')}` : '—')}</td>
  </tr>`).join('') : '<tr><td colspan="7" class="empty">暂无样品</td></tr>';
}

/* ---------- 初始化事件 ---------- */
$('#file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => doImport(reader.result, file.name);
  reader.readAsText(file, 'utf-8');
});
$('#btn-import-text').addEventListener('click', () => doImport($('#csv-text').value, 'pasted.csv'));
$('#btn-template').addEventListener('click', () => {
  const csv = '样品编号,产地,检测项目,结果,批次\r\n' +
    'A-10001,山东寿光,铅,0.12mg/kg,B20260926-001\r\n' +
    'A-10002,河北保定,有机磷农药,合格,B20260926-001\r\n' +
    'A-10003,广东湛江,亚硝酸盐,不合格,B20260926-002\r\n';
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '样品导入模板.csv';
  a.click();
});
$('#btn-filter').addEventListener('click', loadExceptions);
$('#f-code').addEventListener('change', loadExceptions);
$('#f-batch').addEventListener('change', loadExceptions);
$('#btn-refresh-samples').addEventListener('click', loadSamples);
$('#f-status').addEventListener('change', loadSamples);
$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('确定清空全部演示数据？')) return;
  await api('/api/reset', { method: 'POST' });
  $('#import-result').classList.add('hidden');
  await refreshAll();
  toast('数据已重置');
});

async function refreshAll() {
  await Promise.all([loadStats(), loadBatches(), loadExceptions(), loadSamples()]);
}

(async function init() {
  await loadErrorCodes();
  await refreshAll();
})();
