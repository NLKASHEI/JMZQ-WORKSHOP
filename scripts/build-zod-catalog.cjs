const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const repositoryRoot = path.resolve(__dirname, '..');
const zodSourcePath = process.env.JMZQ_ZOD_PATH
  ? path.resolve(process.env.JMZQ_ZOD_PATH)
  : path.resolve(repositoryRoot, '..', '缄默之秋3.0', 'MVU变量', 'ZOD.js');
const dependencyRoot = process.env.JMZQ_NODE_MODULES
  ? path.resolve(process.env.JMZQ_NODE_MODULES)
  : path.resolve(repositoryRoot, '..', 'JMZQFarm', 'node_modules');

const { z } = require(path.join(dependencyRoot, 'zod'));
const lodash = require(path.join(dependencyRoot, 'lodash'));

let source = fs.readFileSync(zodSourcePath, 'utf8')
  .replace(/^import[^\n]+\n/, '')
  .replace('export const Schema =', 'const Schema =');
source += '\nglobalThis.__jmzqSchema = Schema;';

const context = {
  z,
  _: lodash,
  console,
  eventOn() {},
  registerMvuSchema() {},
  $: callback => callback(),
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: zodSourcePath });

const dynamicLabels = {
  队友: '队友名', 人物: '人物名', 通讯: '联系人', 世界事件: '事件名', 势力发展: '势力名',
  附近地点: '地点名', 物品: '物品名', 载具: '载具名', 营地成员: '成员名', 营地建筑: '建筑名',
  生理追踪: '角色名', 图谱库: '图谱名', 工坊扩展: '作品ID', 产物: '配方名', 材料: '材料名',
};

function unwrap(schema) {
  let current = schema;
  const visited = new Set();
  while (current && current._def && !visited.has(current)) {
    visited.add(current);
    const def = current._def;
    if (def.type === 'pipe') {
      if (def.out?._def?.type !== 'transform') current = def.out;
      else current = def.in;
      continue;
    }
    if (['optional', 'nullable', 'default', 'prefault', 'catch', 'readonly', 'nonoptional'].includes(def.type) && def.innerType) {
      current = def.innerType;
      continue;
    }
    break;
  }
  return current;
}

function typeInfo(schema) {
  const node = unwrap(schema);
  const def = node?._def || {};
  if (def.type === 'enum') return { type: 'enum', options: Object.values(def.entries || {}) };
  if (def.type === 'literal') return { type: 'literal', options: Array.isArray(def.values) ? def.values : [def.value] };
  if (def.type === 'boolean') return { type: 'boolean' };
  if (['number', 'int', 'bigint'].includes(def.type)) return { type: 'number' };
  if (def.type === 'string') return { type: 'string' };
  if (def.type === 'array') return { type: 'array' };
  if (def.type === 'record') return { type: 'record' };
  if (def.type === 'object') return { type: 'object' };
  return { type: def.type || 'unknown' };
}

const fields = [];
const seen = new Set();

function addField(schema, segments, dynamic = false) {
  const key = segments.join('.');
  if (!key || seen.has(key)) return;
  seen.add(key);
  const info = typeInfo(schema);
  fields.push({
    path: segments,
    label: segments.join(' › '),
    group: segments[0],
    description: String(schema?.description || unwrap(schema)?.description || ''),
    dynamic,
    ...info,
  });
}

function walk(schema, segments = [], depth = 0, dynamic = false) {
  if (!schema || depth > 7) return;
  const node = unwrap(schema);
  const def = node?._def || {};
  if (def.type === 'object') {
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
    if (!shape || typeof shape !== 'object') return;
    for (const [name, child] of Object.entries(shape)) walk(child, [...segments, name], depth + 1, dynamic);
    return;
  }
  if (def.type === 'record') {
    addField(schema, segments, dynamic);
    const parent = segments.at(-1) || '记录';
    const placeholder = `{${dynamicLabels[parent] || '名称'}}`;
    walk(def.valueType, [...segments, placeholder], depth + 1, true);
    return;
  }
  if (def.type === 'array') {
    addField(schema, segments, dynamic);
    return;
  }
  if (def.type === 'union') {
    addField(schema, segments, dynamic);
    return;
  }
  addField(schema, segments, dynamic);
}

walk(context.__jmzqSchema);
fields.sort((a, b) => a.path.join('.').localeCompare(b.path.join('.'), 'zh-CN'));

// 编辑器只展示适合长期逻辑判断的稳定状态。自由文本、人物内心、装备描述、动态记录等
// 虽然属于 ZOD，但值不稳定且通常没有可靠比较意义，不应让普通作者误当成开关。
const exactConditionFields = new Map(Object.entries({
  '世界阶段': ['剧情进度', '世界阶段'],
  '当前活动': ['剧情进度', '当前正在结算的活动'],
  '超事件.事件ID': ['剧情进度', '当前超事件'],
  '超事件.进展': ['剧情进度', '超事件进展'],
  '超事件.已解决': ['剧情进度', '超事件是否解决'],
  '叙事模式': ['模式与开关', '叙事难度或契约模式'],
  '感染者行为模式': ['模式与开关', '感染者行为模式'],
  'NPC行为模式': ['模式与开关', 'NPC行为模式'],
  '无定义角色模式': ['模式与开关', '是否使用无定义角色模式'],
  '衍生状态.bmi': ['身份与名声', '体型'],
  '衍生状态.nationality': ['身份与名声', '国籍'],
  '衍生状态.reputation': ['身份与名声', '名声'],
  '衍生状态.camp': ['身份与名声', '所属营地'],
  '环境.时间': ['时间与环境', '当前时间'],
  '环境.天气': ['时间与环境', '当前天气'],
  '环境.location': ['时间与环境', '当前地点'],
  '环境.comfort': ['时间与环境', '环境舒适度'],
  '环境.hatred': ['时间与环境', '世界仇恨值'],
  '环境.radiation': ['时间与环境', '辐射指数'],
  '环境.threat_level': ['时间与环境', '威胁等级'],
  '营地.已建立': ['营地', '是否已经建立营地'],
  '营地.可访问': ['营地', '当前是否能使用营地'],
  '营地.人数': ['营地', '营地人数'],
  '营地.士气': ['营地', '营地士气'],
  '可制造.科技树进度': ['制造与研究', '科技树总体进度'],
  '业火记录.路线阶段': ['特殊玩法', '业火归途路线阶段'],
  '业火记录.默示录接触度': ['特殊玩法', '默示录接触度'],
  '业火记录.杀戮压力': ['特殊玩法', '杀戮压力'],
  '金手指.已觉醒': ['特殊玩法', '质形重构是否觉醒'],
}));

const coreLabels = {
  hp_current: '当前生命值', hunger_current: '当前饱食度', thirst_current: '当前饱水度',
  stamina_current: '当前体力', morale_current: '当前情绪值', infection_current: '当前感染值',
};
const specialLabels = { S: '力量 S', P: '感知 P', E: '耐力 E', C: '魅力 C', I: '智力 I', A: '敏捷 A', L: '运气 L' };
const campOperatingFields = new Set(['方针', '警戒', '配给', '生产重点', '床位', '可用劳动力', '连续稳定天数', '燃料日净值', '食水日净值', '医疗日净值', '维护压力', '稳定度', '噪音风险']);

function conditionFieldMeta(field) {
  const key = field.path.join('.');
  if (exactConditionFields.has(key)) {
    const [group, label] = exactConditionFields.get(key);
    return { group, label };
  }
  if (field.path[0] === '核心状态' && coreLabels[field.path[1]]) return { group: '生存状态', label: coreLabels[field.path[1]] };
  if (field.path[0] === 'SPECIAL' && specialLabels[field.path[1]]) return { group: '角色属性', label: specialLabels[field.path[1]] };
  if (field.path[0] === '扩展内容' && field.type === 'boolean') return { group: '模式与开关', label: `是否启用${field.path[1]}` };
  if (field.path[0] === '特质' && field.type === 'array') return { group: '身份与名声', label: `${field.path[1]}特质中包含` };
  if (field.path[0] === '营地' && field.path[1] === '资源' && field.type === 'number') return { group: '营地', label: `${field.path[2]}资源` };
  if (field.path[0] === '营地' && field.path[1] === '经营' && campOperatingFields.has(field.path[2])) return { group: '营地', label: `营地${field.path[2]}` };
  if (field.path[0] === '金手指' && field.path[1] === '永久增幅记录' && field.type === 'boolean') return { group: '特殊玩法', label: `${specialLabels[field.path[2]] || field.path[2]}是否已永久增幅` };
  return null;
}

const conditionGroupOrder = ['剧情进度', '模式与开关', '生存状态', '角色属性', '身份与名声', '时间与环境', '营地', '制造与研究', '特殊玩法'];
const conditionFields = fields.flatMap((field) => {
  const meta = field.dynamic ? null : conditionFieldMeta(field);
  return meta ? [{ ...field, ...meta, sourceLabel: field.label }] : [];
}).sort((a, b) => {
  const groupDifference = conditionGroupOrder.indexOf(a.group) - conditionGroupOrder.indexOf(b.group);
  return groupDifference || a.label.localeCompare(b.label, 'zh-CN');
});

const output = {
  generatedFrom: path.relative(path.resolve(repositoryRoot, '..'), zodSourcePath).replaceAll('\\', '/'),
  sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(zodSourcePath)).digest('hex'),
  generatedAt: new Date().toISOString(),
  fieldCount: fields.length,
  conditionFieldCount: conditionFields.length,
  conditionGroupOrder,
  conditionFields,
  fields,
};

const outputPath = path.join(repositoryRoot, 'data', 'zod-variable-catalog.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
const modulePath = path.join(repositoryRoot, 'src', 'zod-variable-catalog.js');
fs.writeFileSync(modulePath, `// 此文件由 scripts/build-zod-catalog.cjs 从本体 ZOD 自动生成。\nexport default ${JSON.stringify(output, null, 2)};\n`);
console.log(`Generated ${fields.length} fields from ${zodSourcePath}`);
