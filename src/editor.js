import { PROTOCOL_VERSION, buildEntryStates } from './protocol.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const ISSUE_URL = 'https://github.com/NLKASHEI/JMZQ-WORKSHOP/issues/new';
const DRAFT_KEY = 'jmzq-workshop-editor-draft-v1';

const state = {
  kind: 'compatible',
  entries: [],
  bindings: {},
  selectedEntry: null,
  deepFiles: [],
};

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 1800);
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function currentManifest() {
  const manifest = {
    schemaVersion: 1,
    kind: state.kind,
    id: $('#id').value.trim(),
    name: $('#name').value.trim(),
    version: $('#version').value.trim(),
    author: $('#author').value.trim(),
    summary: $('#summary').value.trim(),
    minimumHostVersion: $('#minimum-host').value.trim() || String(PROTOCOL_VERSION),
  };
  if (state.kind === 'compatible') {
    manifest.worldbook = 'worldbook.json';
    manifest.bindings = 'bindings.json';
    manifest.permissions = {
      readVariables: collectReadPaths(),
      writeOwnState: false,
    };
  } else {
    manifest.baseVersion = $('#base-version').value.trim();
    manifest.installGuide = 'INSTALL.md';
    manifest.replaces = $$('#replace-options input:checked').map(input => input.value);
  }
  return manifest;
}

function cleanWorldbookEntry(entry) {
  const clone = { ...entry };
  delete clone.__editorId;
  delete clone.__enabledByDefault;
  return clone;
}

function bindingFor(entryId) {
  if (!state.bindings[entryId]) state.bindings[entryId] = { mode: 'all', conditions: [] };
  return state.bindings[entryId];
}

function conditionTree(entry) {
  const binding = state.bindings[entry.__editorId];
  if (!binding || !binding.conditions.length) return undefined;
  if (binding.conditions.length === 1) return binding.conditions[0];
  return { [binding.mode]: binding.conditions };
}

function currentBindings() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    entries: state.entries.map(entry => {
      const route = {
        name: entry.comment,
        enabledByDefault: entry.__enabledByDefault === true,
      };
      const activeWhen = conditionTree(entry);
      if (activeWhen) route.activeWhen = activeWhen;
      return route;
    }),
  };
}

function collectReadPaths() {
  const seen = new Set();
  const paths = [];
  for (const binding of Object.values(state.bindings)) {
    for (const condition of binding.conditions || []) {
      const path = Array.isArray(condition.path) ? condition.path : [];
      const key = JSON.stringify(path);
      if (path.length && !seen.has(key)) { seen.add(key); paths.push(path); }
    }
  }
  return paths;
}

function registryPackage() {
  const manifest = currentManifest();
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    enabled: true,
    entries: currentBindings().entries,
  };
}

function currentPackage() {
  const manifest = currentManifest();
  const result = {
    format: 'jmzq-workshop-package',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    manifest,
  };
  if (state.kind === 'compatible') {
    result.worldbook = state.entries.map(cleanWorldbookEntry);
    result.bindings = currentBindings();
  } else {
    result.installGuide = $('#install-guide').value;
    result.files = state.deepFiles.map(file => ({ name: file.name, type: file.type, size: file.size, sha256: file.sha256, base64: file.base64 }));
  }
  return result;
}

function validationErrors() {
  const manifest = currentManifest();
  const errors = [];
  if (!manifest.name) errors.push('请填写作品名称。');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(manifest.id)) errors.push('作品 ID 需要为 3～64 位，只能包含字母、数字、点、下划线和连字符。');
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) errors.push('版本必须使用语义版本，例如 1.0.0。');
  if (!manifest.author) errors.push('请填写作者。');
  if (!manifest.summary) errors.push('请填写简介。');
  if (state.kind === 'compatible') {
    if (!state.entries.length) errors.push('兼容扩展至少需要一个世界书条目。');
    const names = state.entries.map(entry => entry.comment.trim());
    if (names.some(name => !name)) errors.push('存在没有名称的世界书条目。');
    if (new Set(names).size !== names.length) errors.push('世界书条目名称不能重复。');
    const prefix = `[jmzq_ext:${manifest.id}]`;
    if (manifest.id && names.some(name => !name.startsWith(prefix))) errors.push(`所有条目都必须以 ${prefix} 开头，可使用“补全命名空间”。`);
  } else {
    if (!manifest.replaces.length) errors.push('深度改造需要选择至少一个被替换组件。');
    if (!$('#install-guide').value.trim()) errors.push('深度改造需要填写安装说明。');
    if (!state.deepFiles.length) errors.push('深度改造需要添加至少一个文件。');
  }
  return errors;
}

function renderValidation() {
  const errors = validationErrors();
  const el = $('#validation-result');
  el.className = `validation ${errors.length ? 'error' : 'ok'}`;
  el.textContent = errors.length ? `发现 ${errors.length} 个问题：\n${errors.map(item => `• ${item}`).join('\n')}` : '检查通过，可以导出并投稿。';
  $('#registry-preview').textContent = state.kind === 'compatible'
    ? JSON.stringify({ protocolVersion: PROTOCOL_VERSION, packages: [registryPackage()] }, null, 2)
    : '深度改造不写入自动注册表。';
  return errors;
}

function renderEntries() {
  const list = $('#entry-list');
  if (!state.entries.length) {
    list.className = 'entry-list empty';
    list.textContent = '尚未添加条目';
  } else {
    list.className = 'entry-list';
    list.innerHTML = state.entries.map(entry => `
      <button class="entry-item ${entry.__editorId === state.selectedEntry ? 'active' : ''}" data-entry-id="${entry.__editorId}" type="button">
        ${escapeHtml(entry.comment || '未命名条目')}
        <small>${entry.constant === false ? '关键词条目' : '常驻/条件条目'} · ${bindingFor(entry.__editorId).conditions.length} 条条件</small>
      </button>`).join('');
    $$('.entry-item').forEach(button => button.addEventListener('click', () => {
      state.selectedEntry = button.dataset.entryId;
      renderEntries(); renderEntryEditor(); renderBindingSelector();
    }));
  }
  renderBindingSelector();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function renderEntryEditor() {
  const host = $('#entry-editor');
  const entry = state.entries.find(item => item.__editorId === state.selectedEntry);
  if (!entry) {
    host.className = 'editor-card muted-card';
    host.innerHTML = '<p>选择或新增一个世界书条目后在这里编辑。</p>';
    return;
  }
  host.className = 'editor-card';
  host.innerHTML = `
    <div class="editor-fields">
      <label>条目名称<input id="entry-name" value="${escapeHtml(entry.comment)}"></label>
      <label>正文<textarea id="entry-content" rows="14">${escapeHtml(entry.content || '')}</textarea></label>
      <div class="editor-row">
        <label>默认状态<select id="entry-default"><option value="false">关闭</option><option value="true" ${entry.__enabledByDefault ? 'selected' : ''}>开启</option></select></label>
        <label>触发模式<select id="entry-mode"><option value="constant" ${entry.constant !== false ? 'selected' : ''}>由工坊条件控制</option><option value="selective" ${entry.constant === false ? 'selected' : ''}>酒馆关键词触发</option></select></label>
      </div>
      <div class="editor-row">
        <label>关键词（逗号分隔）<input id="entry-keys" value="${escapeHtml((entry.key || []).join(', '))}"></label>
        <label>扫描深度<input id="entry-depth" type="number" min="0" max="100" value="${Number(entry.scanDepth ?? 2)}"></label>
      </div>
      <button id="delete-entry" class="button danger-button" type="button">删除此条目</button>
    </div>`;
  $('#entry-name').addEventListener('input', event => { entry.comment = event.target.value; renderEntries(); });
  $('#entry-content').addEventListener('input', event => { entry.content = event.target.value; });
  $('#entry-default').addEventListener('change', event => { entry.__enabledByDefault = event.target.value === 'true'; });
  $('#entry-mode').addEventListener('change', event => {
    const selective = event.target.value === 'selective';
    entry.constant = !selective; entry.selective = selective;
  });
  $('#entry-keys').addEventListener('input', event => { entry.key = event.target.value.split(/[,，]/).map(v => v.trim()).filter(Boolean); });
  $('#entry-depth').addEventListener('input', event => { entry.scanDepth = Math.max(0, Number(event.target.value) || 0); });
  $('#delete-entry').addEventListener('click', () => {
    delete state.bindings[entry.__editorId];
    state.entries = state.entries.filter(item => item !== entry);
    state.selectedEntry = state.entries[0]?.__editorId || null;
    renderEntries(); renderEntryEditor(); renderConditions();
  });
}

function renderBindingSelector() {
  const select = $('#binding-entry');
  const current = state.selectedEntry || select.value || '';
  select.innerHTML = state.entries.length
    ? state.entries.map(entry => `<option value="${entry.__editorId}">${escapeHtml(entry.comment || '未命名')}</option>`).join('')
    : '<option value="">尚无条目</option>';
  if (state.entries.some(entry => entry.__editorId === current)) select.value = current;
  state.selectedEntry = select.value || null;
  renderConditions();
}

function parseConditionValue(raw) {
  const text = raw.trim();
  if (!text) return '';
  try { return JSON.parse(text); } catch { return text; }
}

function conditionValueText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function renderConditions() {
  const list = $('#condition-list');
  const entry = state.entries.find(item => item.__editorId === $('#binding-entry').value);
  if (!entry) {
    list.className = 'condition-list empty'; list.textContent = '先添加世界书条目'; return;
  }
  const binding = bindingFor(entry.__editorId);
  $('#binding-mode').value = binding.mode;
  if (!binding.conditions.length) {
    list.className = 'condition-list empty'; list.textContent = '当前条目没有变量条件'; return;
  }
  const operators = ['eq','neq','gt','gte','lt','lte','in','not_in','contains','starts_with','ends_with','exists','truthy','falsy'];
  list.className = 'condition-list';
  list.innerHTML = binding.conditions.map((condition, index) => `
    <div class="condition-row" data-index="${index}">
      <input class="condition-path" value="${escapeHtml((condition.path || []).join('.'))}" placeholder="环境.天气">
      <select class="condition-operator">${operators.map(op => `<option value="${op}" ${condition.operator === op ? 'selected' : ''}>${op}</option>`).join('')}</select>
      <input class="condition-value" value="${escapeHtml(conditionValueText(condition.value))}" placeholder='文字、数字或 ["A","B"]'>
      <button class="button danger-button condition-delete" type="button">删除</button>
    </div>`).join('');
  $$('.condition-row').forEach(row => {
    const condition = binding.conditions[Number(row.dataset.index)];
    row.querySelector('.condition-path').addEventListener('input', event => { condition.path = event.target.value.split('.').map(v => v.trim()).filter(Boolean); });
    row.querySelector('.condition-operator').addEventListener('change', event => { condition.operator = event.target.value; });
    row.querySelector('.condition-value').addEventListener('input', event => { condition.value = parseConditionValue(event.target.value); });
    row.querySelector('.condition-delete').addEventListener('click', () => {
      binding.conditions.splice(Number(row.dataset.index), 1); renderConditions(); renderEntries();
    });
  });
}

function normalizeImportedWorldbook(raw) {
  const source = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? (Array.isArray(raw.entries) ? raw.entries : Object.values(raw.entries || {})) : []);
  return source.filter(entry => entry && typeof entry === 'object').map(entry => ({
    ...entry,
    __editorId: uid(),
    __enabledByDefault: entry.enabled === true || entry.disable === false,
    comment: String(entry.comment || entry.name || entry.title || '未命名条目'),
    content: String(entry.content || ''),
    enabled: false,
    disable: true,
    constant: entry.constant !== false,
    selective: entry.constant === false || entry.selective === true,
    key: Array.isArray(entry.key) ? entry.key : [],
    keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
  }));
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function sha256(file) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function renderDeepFiles() {
  const host = $('#deep-file-list');
  if (!state.deepFiles.length) { host.className = 'file-list empty'; host.textContent = '尚未添加文件'; return; }
  host.className = 'file-list';
  host.innerHTML = state.deepFiles.map((file, index) => `<div class="file-item"><span>${escapeHtml(file.name)} · ${(file.size / 1024).toFixed(1)} KB</span><button class="button danger-button" data-file-index="${index}" type="button">移除</button></div>`).join('');
  $$('[data-file-index]').forEach(button => button.addEventListener('click', () => {
    state.deepFiles.splice(Number(button.dataset.fileIndex), 1); renderDeepFiles();
  }));
}

function downloadPackage() {
  const errors = renderValidation();
  if (errors.length) { toast('请先修正检查结果'); return false; }
  const pkg = currentPackage();
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${pkg.manifest.id}-${pkg.manifest.version}.jmzqpack.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('作品包已导出');
  return true;
}

function serializeDraft() {
  return {
    manifest: currentManifest(), entries: state.entries, bindings: state.bindings,
    installGuide: $('#install-guide').value, baseVersion: $('#base-version').value,
    replaces: $$('#replace-options input:checked').map(input => input.value),
  };
}

function loadDraft(draft) {
  const manifest = draft.manifest || {};
  for (const [id, value] of Object.entries({ name: manifest.name, id: manifest.id, version: manifest.version, author: manifest.author, summary: manifest.summary })) {
    if (value !== undefined) $(`#${id}`).value = value;
  }
  state.kind = manifest.kind === 'deep' ? 'deep' : 'compatible';
  $(`input[name="kind"][value="${state.kind}"]`).checked = true;
  state.entries = (draft.entries || []).map(entry => ({ ...entry, __editorId: entry.__editorId || uid() }));
  state.bindings = draft.bindings || {};
  state.selectedEntry = state.entries[0]?.__editorId || null;
  $('#install-guide').value = draft.installGuide || '';
  $('#base-version').value = draft.baseVersion || manifest.baseVersion || '';
  const replaces = new Set(draft.replaces || manifest.replaces || []);
  $$('#replace-options input').forEach(input => { input.checked = replaces.has(input.value); });
  refreshKind(); renderEntries(); renderEntryEditor(); renderDeepFiles(); renderValidation();
}

function importPackage(pkg) {
  if (pkg?.format !== 'jmzq-workshop-package' || pkg.schemaVersion !== 1 || !pkg.manifest) throw new Error('不是有效的创意工坊作品包');
  const entries = normalizeImportedWorldbook(pkg.worldbook || []);
  const bindings = {};
  for (const entry of entries) {
    const route = pkg.bindings?.entries?.find(item => item.name === entry.comment);
    if (!route) continue;
    entry.__enabledByDefault = route.enabledByDefault === true;
    const tree = route.activeWhen;
    if (tree?.all || tree?.any) bindings[entry.__editorId] = { mode: tree.all ? 'all' : 'any', conditions: structuredClone(tree.all || tree.any) };
    else if (tree) bindings[entry.__editorId] = { mode: 'all', conditions: [structuredClone(tree)] };
  }
  loadDraft({ manifest: pkg.manifest, entries, bindings, installGuide: pkg.installGuide || '', baseVersion: pkg.manifest.baseVersion, replaces: pkg.manifest.replaces });
  state.deepFiles = Array.isArray(pkg.files) ? pkg.files : [];
  renderDeepFiles();
  toast('作品包已导入');
}

function refreshKind() {
  $$('.type-card').forEach(card => card.classList.toggle('selected', card.querySelector('input').checked));
  const deepStep = $('.step[data-panel="deep"]');
  deepStep.style.opacity = state.kind === 'deep' ? '1' : '.55';
}

$$('.step').forEach(button => button.addEventListener('click', () => {
  $$('.step').forEach(item => item.classList.toggle('active', item === button));
  $$('.panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panelName === button.dataset.panel));
  if (button.dataset.panel === 'publish') renderValidation();
}));

$$('input[name="kind"]').forEach(input => input.addEventListener('change', () => { state.kind = input.value; refreshKind(); }));

$('#add-entry').addEventListener('click', () => {
  const id = $('#id').value.trim() || 'author.extension';
  const entry = {
    __editorId: uid(), __enabledByDefault: false,
    comment: `[jmzq_ext:${id}] 新条目`, content: '', enabled: false, disable: true,
    constant: true, selective: false, key: [], keysecondary: [], scanDepth: 2,
  };
  state.entries.push(entry); state.selectedEntry = entry.__editorId;
  renderEntries(); renderEntryEditor();
});

$('#namespace-entries').addEventListener('click', () => {
  const id = $('#id').value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(id)) { toast('请先填写合法作品 ID'); return; }
  const prefix = `[jmzq_ext:${id}]`;
  state.entries.forEach(entry => {
    if (!entry.comment.startsWith('[jmzq_ext:')) entry.comment = `${prefix} ${entry.comment}`;
    else entry.comment = entry.comment.replace(/^\[jmzq_ext:[^\]]+\]/, prefix);
  });
  renderEntries(); renderEntryEditor(); toast('已补全条目命名空间');
});

$('#worldbook-import').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const imported = normalizeImportedWorldbook(JSON.parse(await file.text()));
    state.entries.push(...imported);
    state.selectedEntry = imported[0]?.__editorId || state.selectedEntry;
    renderEntries(); renderEntryEditor(); toast(`已导入 ${imported.length} 个条目`);
  } catch (error) { toast(`导入失败：${error.message}`); }
  event.target.value = '';
});

$('#binding-entry').addEventListener('change', event => { state.selectedEntry = event.target.value || null; renderEntries(); renderEntryEditor(); renderConditions(); });
$('#binding-mode').addEventListener('change', event => {
  if (!state.selectedEntry) return;
  bindingFor(state.selectedEntry).mode = event.target.value;
});
$('#add-condition').addEventListener('click', () => {
  const entryId = $('#binding-entry').value;
  if (!entryId) { toast('请先添加世界书条目'); return; }
  bindingFor(entryId).conditions.push({ path: ['世界阶段'], operator: 'eq', value: '末世期' });
  renderConditions(); renderEntries();
});

$('#run-test').addEventListener('click', () => {
  try {
    const statData = JSON.parse($('#test-data').value);
    const registry = { protocolVersion: PROTOCOL_VERSION, packages: [registryPackage()] };
    const result = buildEntryStates(registry, statData);
    const enabled = [...result.states].filter(([, value]) => value).map(([name]) => name);
    $('#test-result').textContent = JSON.stringify({ enabled, errors: result.errors }, null, 2);
  } catch (error) { $('#test-result').textContent = `试算失败：${error.message}`; }
});

$('#deep-files').addEventListener('change', async event => {
  for (const file of event.target.files) {
    state.deepFiles.push({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, sha256: await sha256(file), base64: await fileToBase64(file) });
  }
  renderDeepFiles(); event.target.value = '';
});

$('#save-draft').addEventListener('click', () => {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeDraft())); toast('草稿已保存在本机浏览器');
});
$('#export-package').addEventListener('click', downloadPackage);
$('#publish-export').addEventListener('click', downloadPackage);
$('#validate-package').addEventListener('click', () => { renderValidation(); toast(validationErrors().length ? '检查发现问题' : '检查通过'); });
$('#open-submission').addEventListener('click', () => {
  const errors = renderValidation(); if (errors.length) { toast('请先修正检查结果'); return; }
  const manifest = currentManifest();
  const title = `[投稿] ${manifest.name} ${manifest.version}`;
  const body = `作品 ID：${manifest.id}\n作品类型：${manifest.kind === 'compatible' ? '兼容扩展' : '深度改造'}\n作者：${manifest.author}\n\n请把编辑器导出的 .jmzqpack.json 文件拖到这里，并补充测试说明。`;
  window.open(`${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('submission')}`, '_blank', 'noopener');
});

$('#package-import').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { importPackage(JSON.parse(await file.text())); } catch (error) { toast(`导入失败：${error.message}`); }
  event.target.value = '';
});

for (const id of ['name','id','version','author','summary','base-version','install-guide']) {
  $(`#${id}`).addEventListener('input', () => { if (id === 'id') renderEntries(); });
}

try {
  const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
  if (draft) loadDraft(draft);
  else { refreshKind(); renderEntries(); renderEntryEditor(); renderDeepFiles(); renderValidation(); }
} catch {
  refreshKind(); renderEntries(); renderEntryEditor(); renderDeepFiles(); renderValidation();
}
