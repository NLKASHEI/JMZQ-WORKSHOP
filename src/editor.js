import { PROTOCOL_VERSION, buildEntryStates } from './protocol.js';
import zodCatalog from './zod-variable-catalog.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const ISSUE_URL = 'https://github.com/NLKASHEI/JMZQ-WORKSHOP/issues/new';
const DRAFT_KEY = 'jmzq-workshop-editor-draft-v1';
const AUTOSAVE_DELAY = 900;

const state = {
  kind: 'compatible',
  entries: [],
  bindings: {},
  selectedEntry: null,
  deepFiles: [],
  activePanel: 'kind',
  pickerTarget: null,
  pickerGroup: '全部',
};

const OPERATOR_LABELS = {
  eq: '等于', neq: '不等于', gt: '大于', gte: '大于或等于', lt: '小于', lte: '小于或等于',
  contains: '包含', starts_with: '开头是', ends_with: '结尾是', exists: '存在这项数据',
  truthy: '处于开启状态', falsy: '处于关闭状态', in: '属于其中一个', not_in: '不属于这些值',
};

const POSITION_OPTIONS = [
  [0, '角色定义之前（影响中等）'],
  [1, '角色定义之后（推荐，影响较强）'],
  [2, '示例对话之前'],
  [3, '示例对话之后'],
  [4, '作者注释顶部'],
  [5, '作者注释底部'],
  [6, '聊天记录指定深度'],
  [7, 'Outlet（由提示词手动调用）'],
];

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function splitList(value) {
  return String(value || '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
}

function stripNamespace(value) {
  return String(value || '').replace(/^\[jmzq_ext:[^\]]+\]\s*/, '').trim();
}

function managedEntryName(entry) {
  const id = $('#id').value.trim() || 'author.extension';
  return `[jmzq_ext:${id}] ${stripNamespace(entry.comment) || '未命名条目'}`;
}

function defaultEntry() {
  return {
    __editorId: uid(),
    __enabledByDefault: true,
    uid: state.entries.reduce((max, item) => Math.max(max, Number(item.uid) || 0), -1) + 1,
    key: [], keysecondary: [], comment: `新条目 ${state.entries.length + 1}`, content: '',
    constant: false, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true,
    order: 100, position: 1, disable: true, enabled: false,
    ignoreBudget: false, excludeRecursion: true, preventRecursion: true, delayUntilRecursion: false,
    matchPersonaDescription: false, matchCharacterDescription: false, matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false, matchScenario: false, matchCreatorNotes: false,
    probability: 100, useProbability: true, depth: 4, outletName: '', group: '', groupOverride: false,
    groupWeight: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null,
    useGroupScoring: null, automationId: '', role: 0, sticky: 0, cooldown: 0, delay: 0,
    characterFilterNames: [], characterFilterTags: [], characterFilterExclude: false, triggers: [],
  };
}

function entryStrategy(entry) {
  if (entry.constant === true) return 'constant';
  if (entry.vectorized === true) return 'vectorized';
  return 'keyword';
}

function applyEntryStrategy(entry, strategy) {
  entry.constant = strategy === 'constant';
  entry.vectorized = strategy === 'vectorized';
  entry.selective = strategy !== 'constant';
}

function cleanWorldbookEntry(entry) {
  const clone = { ...entry, comment: managedEntryName(entry) };
  for (const key of Object.keys(clone)) if (key.startsWith('__')) delete clone[key];
  clone.characterFilter = {
    isExclude: clone.characterFilterExclude === true,
    names: [...(clone.characterFilterNames || [])],
    tags: [...(clone.characterFilterTags || [])],
  };
  return clone;
}

function bindingFor(entryId) {
  if (!state.bindings[entryId]) state.bindings[entryId] = { mode: 'all', conditions: [] };
  return state.bindings[entryId];
}

function cleanCondition(condition) {
  const result = {
    path: Array.isArray(condition.path) ? condition.path.map(String) : [],
    operator: condition.operator || 'eq',
  };
  if (!['exists', 'truthy', 'falsy'].includes(result.operator)) result.value = condition.value;
  return result;
}

function conditionTree(entry) {
  const binding = state.bindings[entry.__editorId];
  if (!binding || !binding.conditions.length) return undefined;
  const conditions = binding.conditions.map(cleanCondition);
  if (conditions.length === 1) return conditions[0];
  return { [binding.mode]: conditions };
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
    minimumHostVersion: String(PROTOCOL_VERSION),
  };
  if (state.kind === 'compatible') {
    manifest.worldbook = 'worldbook.json';
    manifest.bindings = 'bindings.json';
    manifest.permissions = { readVariables: collectReadPaths(), writeOwnState: false };
  } else {
    manifest.baseVersion = $('#base-version').value.trim();
    manifest.installGuide = 'INSTALL.md';
    manifest.uninstallGuide = 'UNINSTALL.md';
    manifest.installMode = 'manual';
    manifest.replaces = $$('#replace-options input:checked').map(input => input.value);
    manifest.dependencies = splitList($('#deep-dependencies').value);
    manifest.conflicts = splitList($('#deep-conflicts').value);
    manifest.helperSupport = {
      catalog: true,
      download: true,
      versionCheck: true,
      updateNotice: true,
      automaticInstall: false,
    };
  }
  return manifest;
}

function currentBindings() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    entries: state.entries.map(entry => {
      const route = { name: managedEntryName(entry), enabledByDefault: entry.__enabledByDefault === true };
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
  return { id: manifest.id, name: manifest.name, version: manifest.version, enabled: true, entries: currentBindings().entries };
}

function currentPackage() {
  const manifest = currentManifest();
  const result = { format: 'jmzq-workshop-package', schemaVersion: 1, exportedAt: new Date().toISOString(), manifest };
  if (state.kind === 'compatible') {
    result.worldbook = state.entries.map(cleanWorldbookEntry);
    result.bindings = currentBindings();
  } else {
    result.installGuide = $('#install-guide').value;
    result.uninstallGuide = $('#uninstall-guide').value;
    result.files = state.deepFiles.map(file => ({ name: file.name, type: file.type, size: file.size, sha256: file.sha256, base64: file.base64 }));
  }
  return result;
}

function validationErrors() {
  const manifest = currentManifest();
  const errors = [];
  if (!manifest.name) errors.push('还没有填写作品名称。');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(manifest.id)) errors.push('作品代号需要 3～64 位，只能使用字母、数字、点、下划线和连字符。');
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) errors.push('版本请写成 1.0.0 这样的格式。');
  if (!manifest.author) errors.push('还没有填写作者。');
  if (!manifest.summary) errors.push('还没有填写给玩家看的简介。');
  if (state.kind === 'compatible') {
    if (!state.entries.length) errors.push('轻量扩展至少需要一个世界书条目。');
    const names = state.entries.map(entry => stripNamespace(entry.comment));
    if (names.some(name => !name)) errors.push('有世界书条目还没有标题。');
    if (new Set(names).size !== names.length) errors.push('世界书条目的标题不能重复。');
    for (const binding of Object.values(state.bindings)) {
      for (const condition of binding.conditions || []) {
        if ((condition.path || []).some(segment => /^\{.+\}$/.test(segment))) errors.push('有出现条件还没有填写具体的角色名、物品名或记录名。');
      }
    }
  } else {
    if (!manifest.replaces.length) errors.push('请选择这次会改动的部分。');
    if (!manifest.baseVersion) errors.push('请填写准确的本体适配版本，供小助手检查兼容性。');
    if (!$('#install-guide').value.trim()) errors.push('请填写给玩家的安装步骤。');
    if (!$('#uninstall-guide').value.trim()) errors.push('请填写卸载和恢复步骤。');
    if (!state.deepFiles.length) errors.push('请添加至少一个改造文件。');
  }
  return [...new Set(errors)];
}

function renderValidation() {
  const errors = validationErrors();
  const el = $('#validation-result');
  el.className = `validation ${errors.length ? 'error' : 'ok'}`;
  el.textContent = errors.length
    ? `还差 ${errors.length} 件事：\n${errors.map(item => `• ${item}`).join('\n')}`
    : '✓ 检查通过。现在可以导出作品包并投稿。';
  $('#registry-preview').textContent = state.kind === 'compatible'
    ? JSON.stringify({ protocolVersion: PROTOCOL_VERSION, packages: [registryPackage()] }, null, 2)
    : '完整改造不会写入自动管理清单。';
  updateStepCompletion();
  return errors;
}

function strategyMeta(entry) {
  const mode = entryStrategy(entry);
  if (mode === 'constant') return { icon: '', light: 'blue', label: '蓝灯 · 始终有效' };
  if (mode === 'vectorized') return { icon: '🔗', light: 'chain', label: '链式 · 相似内容触发' };
  return { icon: '', light: 'green', label: '绿灯 · 关键词触发' };
}

function renderEntries() {
  const list = $('#entry-list');
  $('#entry-count').textContent = `${state.entries.length} 条`;
  if (!state.entries.length) {
    list.className = 'entry-list empty';
    list.textContent = '点击“新建条目”开始';
  } else {
    list.className = 'entry-list';
    list.innerHTML = state.entries.map(entry => {
      const meta = strategyMeta(entry);
      return `<button class="entry-item ${entry.__editorId === state.selectedEntry ? 'active' : ''}" data-entry-id="${entry.__editorId}" type="button">
        <span class="light ${meta.light}">${meta.icon}</span>${escapeHtml(stripNamespace(entry.comment) || '未命名条目')}
        <small>${meta.label} · ${bindingFor(entry.__editorId).conditions.length} 个额外条件</small>
      </button>`;
    }).join('');
    $$('.entry-item').forEach(button => button.addEventListener('click', () => {
      state.selectedEntry = button.dataset.entryId;
      renderEntries(); renderEntryEditor(); renderBindingSelector();
    }));
  }
  renderBindingSelector();
  updateStepCompletion();
}

function selectOptions(options, value) {
  return options.map(([key, label]) => `<option value="${key}" ${String(value) === String(key) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function checkbox(entry, key, label) {
  return `<label><input data-entry-check="${key}" type="checkbox" ${entry[key] ? 'checked' : ''}>${label}</label>`;
}

function renderEntryEditor() {
  const host = $('#entry-editor');
  const entry = state.entries.find(item => item.__editorId === state.selectedEntry);
  if (!entry) {
    host.className = 'editor-card muted-card';
    host.innerHTML = '<div class="empty-illustration">📖</div><p>选择左侧条目，或新建第一条内容。</p>';
    return;
  }
  const strategy = entryStrategy(entry);
  const showKeywords = strategy === 'keyword';
  const names = entry.characterFilterNames || entry.characterFilter?.names || [];
  const tags = entry.characterFilterTags || entry.characterFilter?.tags || [];
  host.className = 'editor-card';
  host.innerHTML = `
    <div class="editor-fields">
      <label>条目标题<span class="field-help">只给作者看，不会发送给 AI</span><input id="entry-name" value="${escapeHtml(stripNamespace(entry.comment))}" placeholder="例如：暴雪中的体温规则"></label>
      <label>正文<span class="field-help">把这条设定写完整，让它脱离标题和关键词也能看懂</span><textarea id="entry-content" rows="12" placeholder="写入会交给 AI 的设定、规则或人物信息……">${escapeHtml(entry.content)}</textarea></label>

      <div class="field-section">
        <h3>它怎样被酒馆触发？</h3>
        <div class="strategy-grid">
          <label class="strategy-card blue ${strategy === 'constant' ? 'selected' : ''}"><input type="radio" name="entry-strategy" value="constant" ${strategy === 'constant' ? 'checked' : ''}><b>🔵 蓝灯 · 始终有效</b><small>每次生成都带上。适合核心规则和必须遵守的设定。</small></label>
          <label class="strategy-card green ${strategy === 'keyword' ? 'selected' : ''}"><input type="radio" name="entry-strategy" value="keyword" ${strategy === 'keyword' ? 'checked' : ''}><b>🟢 绿灯 · 关键词触发</b><small>聊天里出现关键词才带上。适合地点、人物和物品。</small></label>
          <label class="strategy-card ${strategy === 'vectorized' ? 'selected' : ''}"><input type="radio" name="entry-strategy" value="vectorized" ${strategy === 'vectorized' ? 'checked' : ''}><b>🔗 链式 · 相似内容触发</b><small>由酒馆向量功能寻找相似内容。需要玩家启用向量扩展。</small></label>
        </div>
        ${showKeywords ? `<div class="editor-row">
          <label>主要关键词<span class="field-help">出现其中任意一个就进入候选，逗号分隔</span><input id="entry-keys" value="${escapeHtml((entry.key || []).join(', '))}" placeholder="暴雪, 降温, 冻伤"></label>
          <label>进一步筛选（可不填）<span class="field-help">只有同时满足这里的规则才触发</span><input id="entry-secondary" value="${escapeHtml((entry.keysecondary || []).join(', '))}" placeholder="户外, 夜晚"></label>
        </div>
        <label>进一步筛选方式<select id="entry-selective-logic">${selectOptions([[0,'包含任意一个筛选词'],[1,'包含全部筛选词'],[2,'不能包含任何筛选词'],[3,'不能同时包含全部筛选词']], Number(entry.selectiveLogic) || 0)}</select></label>` : ''}
      </div>

      <div class="field-section">
        <h3>放在提示词的哪里？</h3>
        <div class="editor-row">
          <label>插入位置<select id="entry-position">${selectOptions(POSITION_OPTIONS, Number(entry.position ?? 1))}</select></label>
          <label>顺序<span class="field-help">数字越大，越靠近提示词末尾，影响通常越强</span><input id="entry-order" type="number" value="${Number(entry.order ?? 100)}"></label>
        </div>
        ${Number(entry.position) === 6 ? `<div class="editor-row"><label>聊天深度<span class="field-help">0 是最靠近最新消息</span><input id="entry-depth" type="number" min="0" value="${Number(entry.depth ?? 4)}"></label><label>消息角色<select id="entry-role">${selectOptions([[0,'系统'],[1,'用户'],[2,'助手']], Number(entry.role ?? 0))}</select></label></div>` : ''}
        ${Number(entry.position) === 7 ? `<label>Outlet 名称<input id="entry-outlet" value="${escapeHtml(entry.outletName || '')}" placeholder="例如：weather_rules"></label>` : ''}
        <div class="editor-row">
          <label>触发概率<span class="field-help">100 表示每次满足都触发</span><input id="entry-probability" type="number" min="0" max="100" value="${Number(entry.probability ?? 100)}"></label>
          <label>小助手默认状态<select id="entry-default"><option value="true" ${entry.__enabledByDefault ? 'selected' : ''}>安装后启用</option><option value="false" ${!entry.__enabledByDefault ? 'selected' : ''}>安装后关闭</option></select></label>
        </div>
      </div>

      <details class="advanced-box">
        <summary>高级设置：递归、冷却、角色过滤等</summary>
        <div class="editor-fields">
          <div class="editor-row">
            <label>覆盖扫描深度<span class="field-help">留空则跟随玩家的酒馆设置</span><input id="entry-scan-depth" type="number" min="0" value="${entry.scanDepth ?? ''}" placeholder="跟随全局"></label>
            <label>自动化 ID<span class="field-help">与 Quick Replies / STscript 联动</span><input id="entry-automation" value="${escapeHtml(entry.automationId || '')}"></label>
          </div>
          <div class="editor-row">
            <label>包含组<span class="field-help">同组多条触发时只选一条</span><input id="entry-group" value="${escapeHtml(entry.group || '')}"></label>
            <label>组权重<input id="entry-group-weight" type="number" min="0" value="${Number(entry.groupWeight ?? 100)}"></label>
          </div>
          <div class="editor-row">
            <label>触发后继续保留（消息数）<input id="entry-sticky" type="number" min="0" value="${Number(entry.sticky ?? 0)}"></label>
            <label>触发后冷却（消息数）<input id="entry-cooldown" type="number" min="0" value="${Number(entry.cooldown ?? 0)}"></label>
          </div>
          <label>开聊多少条消息后才允许触发<input id="entry-delay" type="number" min="0" value="${Number(entry.delay ?? 0)}"></label>
          <div class="toggle-row">
            ${checkbox(entry, 'useProbability', '使用上面的触发概率')}
            ${checkbox(entry, 'excludeRecursion', '不允许被其他条目递归激活')}
            ${checkbox(entry, 'preventRecursion', '激活后不再触发其他条目')}
            ${checkbox(entry, 'delayUntilRecursion', '等到递归扫描时再激活')}
            ${checkbox(entry, 'ignoreBudget', '忽略世界书预算')}
            ${checkbox(entry, 'groupOverride', '同组内优先选择顺序更高的条目')}
          </div>
          <div class="editor-row">
            <label>大小写匹配<select id="entry-case-sensitive">${selectOptions([['','跟随酒馆全局设置'],['true','区分大小写'],['false','不区分大小写']], entry.caseSensitive === null || entry.caseSensitive === undefined ? '' : String(entry.caseSensitive))}</select></label>
            <label>完整词匹配<select id="entry-whole-words">${selectOptions([['','跟随酒馆全局设置'],['true','只匹配完整词'],['false','允许匹配词的一部分']], entry.matchWholeWords === null || entry.matchWholeWords === undefined ? '' : String(entry.matchWholeWords))}</select></label>
          </div>
          <label>包含组评分<select id="entry-group-scoring">${selectOptions([['','跟随酒馆全局设置'],['true','按命中关键词数量评分'],['false','不使用组评分']], entry.useGroupScoring === null || entry.useGroupScoring === undefined ? '' : String(entry.useGroupScoring))}</select></label>
          <div class="editor-row">
            <label>只对这些角色生效<span class="field-help">角色名用逗号分隔；留空表示不限制</span><input id="entry-character-names" value="${escapeHtml(names.join(', '))}"></label>
            <label>只对带这些标签的角色生效<input id="entry-character-tags" value="${escapeHtml(tags.join(', '))}"></label>
          </div>
          <div class="toggle-row">${checkbox(entry, 'characterFilterExclude', '反选：对上面列出的角色或标签不生效')}</div>
          <label>只在这些生成方式中触发<span class="field-help">不选表示全部允许</span></label>
          <div class="toggle-row" id="entry-triggers">
            ${[['normal','正常回复'],['continue','继续写'],['impersonate','扮演用户'],['swipe','切换回复'],['regenerate','重新生成'],['quiet','后台生成']].map(([value,label]) => `<label><input type="checkbox" value="${value}" ${(entry.triggers || []).includes(value) ? 'checked' : ''}>${label}</label>`).join('')}
          </div>
          <label>额外拿哪些资料匹配关键词？</label>
          <div class="toggle-row">
            ${checkbox(entry, 'matchCharacterDescription', '角色描述')}${checkbox(entry, 'matchCharacterPersonality', '角色性格')}${checkbox(entry, 'matchScenario', '情景')}
            ${checkbox(entry, 'matchPersonaDescription', '玩家人设')}${checkbox(entry, 'matchCharacterDepthPrompt', '角色备注')}${checkbox(entry, 'matchCreatorNotes', '创作者注释')}
          </div>
        </div>
      </details>
      <button id="delete-entry" class="button danger-button" type="button">删除这个条目</button>
    </div>`;

  const bindInput = (selector, key, parse = value => value) => {
    const input = $(selector);
    if (!input) return;
    input.addEventListener('input', event => { entry[key] = parse(event.target.value); if (key === 'comment') renderEntries(); });
    input.addEventListener('change', event => { entry[key] = parse(event.target.value); });
  };
  bindInput('#entry-name', 'comment', stripNamespace);
  bindInput('#entry-content', 'content');
  bindInput('#entry-keys', 'key', splitList);
  bindInput('#entry-secondary', 'keysecondary', splitList);
  bindInput('#entry-selective-logic', 'selectiveLogic', Number);
  bindInput('#entry-order', 'order', Number);
  bindInput('#entry-probability', 'probability', value => Math.max(0, Math.min(100, Number(value) || 0)));
  bindInput('#entry-depth', 'depth', value => Math.max(0, Number(value) || 0));
  bindInput('#entry-role', 'role', Number);
  bindInput('#entry-outlet', 'outletName');
  bindInput('#entry-scan-depth', 'scanDepth', value => value === '' ? null : Math.max(0, Number(value) || 0));
  bindInput('#entry-automation', 'automationId');
  bindInput('#entry-group', 'group');
  bindInput('#entry-group-weight', 'groupWeight', value => Math.max(0, Number(value) || 0));
  bindInput('#entry-sticky', 'sticky', value => Math.max(0, Number(value) || 0));
  bindInput('#entry-cooldown', 'cooldown', value => Math.max(0, Number(value) || 0));
  bindInput('#entry-delay', 'delay', value => Math.max(0, Number(value) || 0));
  bindInput('#entry-character-names', 'characterFilterNames', splitList);
  bindInput('#entry-character-tags', 'characterFilterTags', splitList);
  const nullableBoolean = value => value === '' ? null : value === 'true';
  bindInput('#entry-case-sensitive', 'caseSensitive', nullableBoolean);
  bindInput('#entry-whole-words', 'matchWholeWords', nullableBoolean);
  bindInput('#entry-group-scoring', 'useGroupScoring', nullableBoolean);
  $('#entry-default').addEventListener('change', event => { entry.__enabledByDefault = event.target.value === 'true'; });
  $('#entry-position').addEventListener('change', event => { entry.position = Number(event.target.value); renderEntryEditor(); });
  $$('input[name="entry-strategy"]').forEach(input => input.addEventListener('change', event => {
    applyEntryStrategy(entry, event.target.value); renderEntries(); renderEntryEditor();
  }));
  $$('[data-entry-check]').forEach(input => input.addEventListener('change', event => { entry[event.target.dataset.entryCheck] = event.target.checked; }));
  $$('#entry-triggers input').forEach(input => input.addEventListener('change', () => { entry.triggers = $$('#entry-triggers input:checked').map(item => item.value); }));
  $('#delete-entry').addEventListener('click', () => {
    delete state.bindings[entry.__editorId];
    state.entries = state.entries.filter(item => item !== entry);
    state.selectedEntry = state.entries[0]?.__editorId || null;
    renderEntries(); renderEntryEditor(); renderConditions(); markDirty();
  });
}

function renderBindingSelector() {
  const select = $('#binding-entry');
  const current = state.selectedEntry || select.value || '';
  select.innerHTML = state.entries.length
    ? state.entries.map(entry => `<option value="${entry.__editorId}">${escapeHtml(stripNamespace(entry.comment) || '未命名')}</option>`).join('')
    : '<option value="">先去编写一个世界书条目</option>';
  if (state.entries.some(entry => entry.__editorId === current)) select.value = current;
  state.selectedEntry = select.value || null;
  renderConditions();
}

function catalogItemForCondition(condition) {
  const availableFields = zodCatalog.conditionFields || zodCatalog.fields;
  if (condition.__catalogPath) {
    const exact = availableFields.find(item => item.path.join('.') === condition.__catalogPath.join('.'))
      || zodCatalog.fields.find(item => item.path.join('.') === condition.__catalogPath.join('.'));
    if (exact) return exact;
  }
  const actual = condition.path || [];
  return availableFields.find(item => item.path.length === actual.length && item.path.every((segment, index) => /^\{.+\}$/.test(segment) || segment === actual[index]))
    || zodCatalog.fields.find(item => item.path.length === actual.length && item.path.every((segment, index) => /^\{.+\}$/.test(segment) || segment === actual[index]));
}

function operatorsFor(field) {
  if (!field) return ['eq', 'neq', 'contains', 'exists'];
  if (field.type === 'number') return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists'];
  if (field.type === 'boolean') return ['eq', 'neq', 'truthy', 'falsy', 'exists'];
  if (field.type === 'enum' || field.type === 'literal') return ['eq', 'neq', 'in', 'not_in', 'exists'];
  if (field.type === 'array') return ['contains', 'exists'];
  return ['eq', 'neq', 'contains', 'starts_with', 'ends_with', 'in', 'not_in', 'exists'];
}

function parseConditionValue(raw, field, operator) {
  if (['exists', 'truthy', 'falsy'].includes(operator)) return undefined;
  if (['in', 'not_in'].includes(operator)) return splitList(raw);
  if (field?.type === 'number') return Number(raw) || 0;
  if (field?.type === 'boolean') return String(raw) === 'true';
  return raw;
}

function conditionValueControl(condition, field, index) {
  if (['exists', 'truthy', 'falsy'].includes(condition.operator)) return '<div class="field-help">这个判断不需要填写比较值</div>';
  if (['in', 'not_in'].includes(condition.operator)) return `<input class="condition-value" data-condition-value="${index}" value="${escapeHtml(Array.isArray(condition.value) ? condition.value.join(', ') : condition.value || '')}" placeholder="多个值用逗号分隔">`;
  if (field?.options?.length) return `<select class="condition-value" data-condition-value="${index}">${field.options.map(value => `<option value="${escapeHtml(value)}" ${String(condition.value) === String(value) ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select>`;
  if (field?.type === 'boolean') return `<select class="condition-value" data-condition-value="${index}"><option value="true" ${condition.value === true ? 'selected' : ''}>是 / 开启</option><option value="false" ${condition.value === false ? 'selected' : ''}>否 / 关闭</option></select>`;
  return `<input class="condition-value" data-condition-value="${index}" ${field?.type === 'number' ? 'type="number"' : ''} value="${escapeHtml(condition.value ?? '')}" placeholder="要比较的内容">`;
}

function renderConditions() {
  const list = $('#condition-list');
  const entry = state.entries.find(item => item.__editorId === $('#binding-entry').value);
  if (!entry) { list.className = 'condition-list empty'; list.textContent = '先去编写一个世界书条目。'; return; }
  const binding = bindingFor(entry.__editorId);
  $('#binding-mode').value = binding.mode;
  if (!binding.conditions.length) {
    list.className = 'condition-list empty';
    list.textContent = '这条内容没有额外条件，将按世界书自身设置工作。';
    return;
  }
  list.className = 'condition-list';
  list.innerHTML = binding.conditions.map((condition, index) => {
    const field = catalogItemForCondition(condition);
    const path = condition.path || [];
    const template = condition.__catalogPath || field?.path || path;
    const dynamicFields = template.map((segment, segmentIndex) => /^\{(.+)\}$/.exec(segment)?.[1] ? { label: /^\{(.+)\}$/.exec(segment)[1], segmentIndex } : null).filter(Boolean);
    const fieldLabel = field?.label || path.join(' › ') || '还没有选择';
    const options = operatorsFor(field);
    if (!options.includes(condition.operator)) condition.operator = options[0];
    return `<div class="condition-row" data-index="${index}">
      <div class="condition-sentence">
        <label>游戏里的数据<button class="button condition-field" data-pick-condition="${index}" type="button"><span><b>${escapeHtml(fieldLabel)}</b><small>${escapeHtml(field?.description || '点击重新选择')}</small></span></button></label>
        <label>怎样判断<select class="condition-operator" data-condition-operator="${index}">${options.map(operator => `<option value="${operator}" ${condition.operator === operator ? 'selected' : ''}>${OPERATOR_LABELS[operator]}</option>`).join('')}</select></label>
        <label>比较值${conditionValueControl(condition, field, index)}</label>
        <button class="button danger-button condition-delete" data-delete-condition="${index}" type="button">删除</button>
      </div>
      ${dynamicFields.length ? `<div class="dynamic-slots"><span>这条路径里还需要指定：</span>${dynamicFields.map(item => `<label>${escapeHtml(item.label)}<input data-dynamic-index="${index}" data-segment-index="${item.segmentIndex}" value="${/^\{.+\}$/.test(path[item.segmentIndex] || '') ? '' : escapeHtml(path[item.segmentIndex] || '')}" placeholder="填写${escapeHtml(item.label)}"></label>`).join('')}</div>` : ''}
    </div>`;
  }).join('');

  $$('[data-pick-condition]').forEach(button => button.addEventListener('click', () => openVariablePicker(entry.__editorId, Number(button.dataset.pickCondition))));
  $$('[data-condition-operator]').forEach(select => select.addEventListener('change', () => {
    const condition = binding.conditions[Number(select.dataset.conditionOperator)];
    condition.operator = select.value;
    renderConditions(); markDirty();
  }));
  $$('[data-condition-value]').forEach(input => input.addEventListener('input', () => {
    const index = Number(input.dataset.conditionValue);
    const condition = binding.conditions[index];
    condition.value = parseConditionValue(input.value, catalogItemForCondition(condition), condition.operator);
  }));
  $$('[data-delete-condition]').forEach(button => button.addEventListener('click', () => {
    binding.conditions.splice(Number(button.dataset.deleteCondition), 1); renderConditions(); renderEntries(); markDirty();
  }));
  $$('[data-dynamic-index]').forEach(input => input.addEventListener('input', () => {
    const condition = binding.conditions[Number(input.dataset.dynamicIndex)];
    const template = condition.__catalogPath || catalogItemForCondition(condition)?.path || [];
    const segmentIndex = Number(input.dataset.segmentIndex);
    condition.path[segmentIndex] = input.value.trim() || template[segmentIndex];
  }));
}

function renderVariablePicker() {
  const search = $('#variable-search').value.trim().toLowerCase();
  const selectableFields = zodCatalog.conditionFields || [];
  $('#catalog-summary').textContent = `已检查本体 ZOD 的 ${zodCatalog.fieldCount} 个数据位置，并筛出 ${selectableFields.length} 个适合做开关的稳定状态。`;
  const orderedGroups = zodCatalog.conditionGroupOrder || [...new Set(selectableFields.map(item => item.group))];
  const groups = ['全部', ...orderedGroups.filter(group => selectableFields.some(item => item.group === group))];
  $('#variable-groups').innerHTML = groups.map(group => `<button class="group-chip ${state.pickerGroup === group ? 'active' : ''}" data-variable-group="${escapeHtml(group)}" type="button">${escapeHtml(group)}</button>`).join('');
  $$('[data-variable-group]').forEach(button => button.addEventListener('click', () => { state.pickerGroup = button.dataset.variableGroup; renderVariablePicker(); }));
  const results = selectableFields.filter(item => {
    const groupMatch = state.pickerGroup === '全部' || item.group === state.pickerGroup;
    const haystack = `${item.label} ${item.description} ${item.type}`.toLowerCase();
    return groupMatch && (!search || haystack.includes(search));
  }).slice(0, 180);
  $('#variable-results').innerHTML = results.length ? results.map((item, index) => `
    <button class="variable-option" data-variable-index="${selectableFields.indexOf(item)}" type="button">
      <b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.description || '本体数据项')}</small><em>${escapeHtml(item.type)}${item.dynamic ? ' · 需填名称' : ''}</em>
    </button>`).join('') : '<div class="entry-list empty">没有找到，换个关键词试试。</div>';
  $$('[data-variable-index]').forEach(button => button.addEventListener('click', () => chooseVariable(selectableFields[Number(button.dataset.variableIndex)])));
}

function openVariablePicker(entryId, conditionIndex) {
  state.pickerTarget = { entryId, conditionIndex };
  state.pickerGroup = '全部';
  $('#variable-search').value = '';
  renderVariablePicker();
  $('#variable-picker').showModal();
  setTimeout(() => $('#variable-search').focus(), 0);
}

function chooseVariable(field) {
  const target = state.pickerTarget;
  const condition = bindingFor(target.entryId).conditions[target.conditionIndex];
  condition.__catalogPath = [...field.path];
  condition.path = [...field.path];
  condition.operator = operatorsFor(field)[0];
  condition.value = field.options?.[0] ?? (field.type === 'number' ? 0 : field.type === 'boolean' ? true : '');
  $('#variable-picker').close();
  renderConditions(); markDirty();
}

function normalizeImportedWorldbook(raw) {
  const source = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? (Array.isArray(raw.entries) ? raw.entries : Object.values(raw.entries || {})) : []);
  return source.filter(entry => entry && typeof entry === 'object').map((rawEntry, index) => {
    const entry = { ...defaultEntry(), ...rawEntry };
    const sourceName = String(rawEntry.comment || rawEntry.name || rawEntry.title || `未命名条目 ${index + 1}`);
    entry.__editorId = uid();
    entry.__sourceName = sourceName;
    entry.__enabledByDefault = rawEntry.__enabledByDefault ?? (rawEntry.enabled === true || rawEntry.disable === false);
    entry.comment = stripNamespace(sourceName);
    entry.content = String(rawEntry.content || '');
    entry.key = Array.isArray(rawEntry.key) ? rawEntry.key : splitList(rawEntry.key);
    entry.keysecondary = Array.isArray(rawEntry.keysecondary) ? rawEntry.keysecondary : splitList(rawEntry.keysecondary);
    entry.triggers = Array.isArray(rawEntry.triggers) ? rawEntry.triggers : [];
    entry.characterFilterNames = rawEntry.characterFilterNames || rawEntry.characterFilter?.names || [];
    entry.characterFilterTags = rawEntry.characterFilterTags || rawEntry.characterFilter?.tags || [];
    entry.characterFilterExclude = rawEntry.characterFilterExclude ?? rawEntry.characterFilter?.isExclude ?? false;
    return entry;
  });
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
    state.deepFiles.splice(Number(button.dataset.fileIndex), 1); renderDeepFiles(); markDirty();
  }));
}

function downloadPackage() {
  const errors = renderValidation();
  if (errors.length) { toast('先按检查结果补全作品'); return false; }
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
    savedAt: new Date().toISOString(),
    manifest: currentManifest(),
    entries: state.entries,
    bindings: state.bindings,
    installGuide: $('#install-guide').value,
    uninstallGuide: $('#uninstall-guide').value,
    baseVersion: $('#base-version').value,
    dependencies: $('#deep-dependencies').value,
    conflicts: $('#deep-conflicts').value,
    replaces: $$('#replace-options input:checked').map(input => input.value),
    activePanel: state.activePanel,
  };
}

function setSaveState(mode, text) {
  const el = $('#save-state');
  el.className = `save-state ${mode || ''}`;
  el.innerHTML = `<i></i>${escapeHtml(text)}`;
}

function saveDraft(showToast = false) {
  clearTimeout(saveDraft.timer);
  try {
    setSaveState('saving', '正在保存…');
    const draft = serializeDraft();
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    setSaveState('', `已自动保存 ${time}`);
    if (showToast) toast('草稿已保存在当前浏览器');
  } catch (error) {
    setSaveState('error', '自动保存失败');
    if (showToast) toast(`保存失败：${error.message}`);
  }
}

function markDirty() {
  setSaveState('saving', '有修改，准备保存…');
  clearTimeout(saveDraft.timer);
  saveDraft.timer = setTimeout(() => saveDraft(false), AUTOSAVE_DELAY);
  updateStepCompletion();
}

function loadDraft(draft) {
  const manifest = draft.manifest || {};
  for (const [id, value] of Object.entries({ name: manifest.name, id: manifest.id, version: manifest.version, author: manifest.author, summary: manifest.summary })) {
    if (value !== undefined) $(`#${id}`).value = value;
  }
  state.kind = manifest.kind === 'deep' ? 'deep' : 'compatible';
  $(`input[name="kind"][value="${state.kind}"]`).checked = true;
  state.entries = (draft.entries || []).map((rawEntry, index) => {
    const entry = { ...defaultEntry(), ...rawEntry };
    entry.__editorId = rawEntry.__editorId || uid();
    entry.comment = stripNamespace(rawEntry.comment || `未命名条目 ${index + 1}`);
    return entry;
  });
  state.bindings = draft.bindings || {};
  state.selectedEntry = state.entries[0]?.__editorId || null;
  $('#install-guide').value = draft.installGuide || '';
  $('#uninstall-guide').value = draft.uninstallGuide || '';
  $('#base-version').value = draft.baseVersion || manifest.baseVersion || '';
  $('#deep-dependencies').value = draft.dependencies || (manifest.dependencies || []).join('\n');
  $('#deep-conflicts').value = draft.conflicts || (manifest.conflicts || []).join('\n');
  const replaces = new Set(draft.replaces || manifest.replaces || []);
  $$('#replace-options input').forEach(input => { input.checked = replaces.has(input.value); });
  refreshKind(); renderEntries(); renderEntryEditor(); renderDeepFiles(); renderValidation();
  showPanel(draft.activePanel && visibleStepNames().includes(draft.activePanel) ? draft.activePanel : 'kind', false);
  if (draft.savedAt) {
    const time = new Date(draft.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    setSaveState('', `已恢复草稿 ${time}`);
  }
}

function importPackage(pkg) {
  if (pkg?.format !== 'jmzq-workshop-package' || pkg.schemaVersion !== 1 || !pkg.manifest) throw new Error('这不是创意工坊作品包');
  const entries = normalizeImportedWorldbook(pkg.worldbook || []);
  const bindings = {};
  for (const entry of entries) {
    const route = pkg.bindings?.entries?.find(item => item.name === entry.__sourceName || stripNamespace(item.name) === entry.comment);
    if (!route) continue;
    entry.__enabledByDefault = route.enabledByDefault === true;
    const tree = route.activeWhen;
    if (tree?.all || tree?.any) bindings[entry.__editorId] = { mode: tree.all ? 'all' : 'any', conditions: structuredClone(tree.all || tree.any) };
    else if (tree) bindings[entry.__editorId] = { mode: 'all', conditions: [structuredClone(tree)] };
  }
  loadDraft({
    manifest: pkg.manifest,
    entries,
    bindings,
    installGuide: pkg.installGuide || '',
    uninstallGuide: pkg.uninstallGuide || '',
    baseVersion: pkg.manifest.baseVersion,
    dependencies: (pkg.manifest.dependencies || []).join('\n'),
    conflicts: (pkg.manifest.conflicts || []).join('\n'),
    replaces: pkg.manifest.replaces,
    activePanel: 'basic',
  });
  state.deepFiles = Array.isArray(pkg.files) ? pkg.files : [];
  renderDeepFiles(); markDirty(); toast('作品包已导入，可以继续编辑');
}

function visibleStepNames() {
  return $$('.step:not([hidden])').map(button => button.dataset.panel);
}

function showPanel(name, scroll = true) {
  if (!visibleStepNames().includes(name)) name = visibleStepNames()[0];
  state.activePanel = name;
  $$('.step').forEach(button => button.classList.toggle('active', button.dataset.panel === name));
  $$('.panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panelName === name));
  if (name === 'publish') renderValidation();
  const steps = visibleStepNames();
  const index = steps.indexOf(name);
  $('#prev-step').disabled = index <= 0;
  $('#next-step').textContent = index === steps.length - 1 ? '检查作品 ✓' : '下一步 →';
  const hints = { kind: '先选择你要制作的类型', basic: '用几句话让玩家认识你的作品', worldbook: '把设定拆成清楚的世界书条目', bindings: '需要时再添加游戏状态条件', deep: '放入改造文件并写清安装步骤', publish: '检查无误后导出投稿' };
  $('#step-hint').textContent = hints[name] || '';
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepCompletion() {
  const completed = {
    kind: true,
    basic: Boolean($('#name').value.trim() && $('#id').value.trim() && $('#author').value.trim() && $('#summary').value.trim()),
    worldbook: state.kind === 'deep' || state.entries.length > 0,
    bindings: true,
    deep: state.kind !== 'deep' || Boolean(state.deepFiles.length && $('#base-version').value.trim() && $('#install-guide').value.trim() && $('#uninstall-guide').value.trim()),
    publish: validationErrors().length === 0,
  };
  $$('.step').forEach(button => button.classList.toggle('done', completed[button.dataset.panel]));
}

function refreshKind() {
  $$('.type-card').forEach(card => card.classList.toggle('selected', card.querySelector('input').checked));
  $('.step[data-panel="deep"]').hidden = state.kind !== 'deep';
  $$('.step.light-only').forEach(step => { step.hidden = state.kind === 'deep'; });
  $('.steps').classList.toggle('compact', state.kind !== 'deep');
  $('.steps').classList.toggle('deep-flow', state.kind === 'deep');
  if (state.kind === 'deep') {
    $('#journey-title').textContent = '完整改造怎么进入工坊？';
    $('#journey-row').innerHTML = '<div><span>1</span><b>在本地完成改造</b><small>先自行制作并测试文件</small></div><i>→</i><div><span>2</span><b>声明兼容边界</b><small>版本、替换范围和冲突</small></div><i>→</i><div><span>3</span><b>打包供玩家下载</b><small>小助手引导手动安装</small></div>';
  } else {
    $('#journey-title').textContent = '轻量扩展怎么工作？';
    $('#journey-row').innerHTML = '<div><span>1</span><b>写内容</b><small>例如新势力、新事件</small></div><i>→</i><div><span>2</span><b>选出现时机</b><small>例如末世期或下雨时</small></div><i>→</i><div><span>3</span><b>导出投稿</b><small>玩家一键安装</small></div>';
  }
  if (!visibleStepNames().includes(state.activePanel)) showPanel('kind', false);
  updateStepCompletion();
}

$$('.step').forEach(button => button.addEventListener('click', () => showPanel(button.dataset.panel)));
$('#prev-step').addEventListener('click', () => {
  const steps = visibleStepNames();
  showPanel(steps[Math.max(0, steps.indexOf(state.activePanel) - 1)]);
});
$('#next-step').addEventListener('click', () => {
  const steps = visibleStepNames();
  const index = steps.indexOf(state.activePanel);
  if (index === steps.length - 1) { renderValidation(); toast(validationErrors().length ? '还有内容需要补全' : '作品已经可以导出'); return; }
  showPanel(steps[index + 1]);
});

$$('input[name="kind"]').forEach(input => input.addEventListener('change', () => { state.kind = input.value; refreshKind(); markDirty(); }));

$('#add-entry').addEventListener('click', () => {
  const entry = defaultEntry();
  state.entries.push(entry); state.selectedEntry = entry.__editorId;
  renderEntries(); renderEntryEditor(); markDirty();
});

$('#namespace-entries').addEventListener('click', () => {
  const used = new Set();
  for (const entry of state.entries) {
    let base = stripNamespace(entry.comment) || '未命名条目';
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base} ${suffix++}`;
    entry.comment = name;
    used.add(name);
  }
  renderEntries(); renderEntryEditor(); markDirty(); toast('已整理空标题和重复标题，发布标记会自动添加');
});

$('#worldbook-import').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const imported = normalizeImportedWorldbook(JSON.parse(await file.text()));
    state.entries.push(...imported);
    state.selectedEntry = imported[0]?.__editorId || state.selectedEntry;
    renderEntries(); renderEntryEditor(); markDirty(); toast(`已导入 ${imported.length} 个酒馆世界书条目`);
  } catch (error) { toast(`导入失败：${error.message}`); }
  event.target.value = '';
});

$('#binding-entry').addEventListener('change', event => { state.selectedEntry = event.target.value || null; renderEntries(); renderEntryEditor(); renderConditions(); });
$('#binding-mode').addEventListener('change', event => { if (state.selectedEntry) { bindingFor(state.selectedEntry).mode = event.target.value; markDirty(); } });
$('#add-condition').addEventListener('click', () => {
  const entryId = $('#binding-entry').value;
  if (!entryId) { toast('先去编写一个世界书条目'); return; }
  const availableFields = zodCatalog.conditionFields || zodCatalog.fields;
  const preferred = availableFields.find(item => item.path.join('.') === '世界阶段') || availableFields[0];
  const condition = { path: [...preferred.path], __catalogPath: [...preferred.path], operator: operatorsFor(preferred)[0], value: preferred.options?.[0] ?? '' };
  bindingFor(entryId).conditions.push(condition);
  const index = bindingFor(entryId).conditions.length - 1;
  renderConditions(); renderEntries(); markDirty(); openVariablePicker(entryId, index);
});

$('#variable-search').addEventListener('input', renderVariablePicker);

$('#run-test').addEventListener('click', () => {
  try {
    const gameData = JSON.parse($('#test-data').value);
    const registry = { protocolVersion: PROTOCOL_VERSION, packages: [registryPackage()] };
    const result = buildEntryStates(registry, gameData);
    const enabled = [...result.states].filter(([, value]) => value).map(([name]) => stripNamespace(name));
    $('#test-result').textContent = JSON.stringify({ 会启用的条目: enabled, 问题: result.errors }, null, 2);
  } catch (error) { $('#test-result').textContent = `预演失败：${error.message}`; }
});

$('#deep-files').addEventListener('change', async event => {
  for (const file of event.target.files) {
    state.deepFiles.push({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, sha256: await sha256(file), base64: await fileToBase64(file) });
  }
  renderDeepFiles(); event.target.value = ''; markDirty();
});

$('#save-draft').addEventListener('click', () => saveDraft(true));
$('#export-package').addEventListener('click', downloadPackage);
$('#publish-export').addEventListener('click', downloadPackage);
$('#validate-package').addEventListener('click', () => { renderValidation(); toast(validationErrors().length ? '检查发现需要补全的内容' : '检查通过'); });
$('#open-submission').addEventListener('click', () => {
  const errors = renderValidation(); if (errors.length) { toast('先按检查结果补全作品'); return; }
  const manifest = currentManifest();
  const title = `[投稿] ${manifest.name} ${manifest.version}`;
  const body = `作品 ID：${manifest.id}\n作品类型：${manifest.kind === 'compatible' ? '轻量扩展' : '完整改造'}\n作者：${manifest.author}\n\n请把编辑器导出的 .jmzqpack.json 文件拖到这里，并补充测试说明。`;
  window.open(`${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('submission')}`, '_blank', 'noopener');
});

$('#package-import').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { importPackage(JSON.parse(await file.text())); } catch (error) { toast(`导入失败：${error.message}`); }
  event.target.value = '';
});

for (const id of ['name','id','version','author','summary','base-version','install-guide','uninstall-guide','deep-dependencies','deep-conflicts']) {
  $(`#${id}`).addEventListener('input', () => updateStepCompletion());
}

document.addEventListener('input', event => { if (!event.target.closest('#variable-picker')) markDirty(); });
document.addEventListener('change', event => { if (!event.target.closest('#variable-picker')) markDirty(); });
window.addEventListener('beforeunload', () => saveDraft(false));
setInterval(() => saveDraft(false), 30000);

try {
  const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
  if (draft) loadDraft(draft);
  else {
    refreshKind(); renderEntries(); renderEntryEditor(); renderDeepFiles(); renderValidation(); renderVariablePicker(); showPanel('kind', false);
  }
} catch {
  refreshKind(); renderEntries(); renderEntryEditor(); renderDeepFiles(); renderValidation(); renderVariablePicker(); showPanel('kind', false);
}
