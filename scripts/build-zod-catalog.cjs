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

const output = {
  generatedFrom: path.relative(path.resolve(repositoryRoot, '..'), zodSourcePath).replaceAll('\\', '/'),
  sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(zodSourcePath)).digest('hex'),
  generatedAt: new Date().toISOString(),
  fieldCount: fields.length,
  fields,
};

const outputPath = path.join(repositoryRoot, 'data', 'zod-variable-catalog.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
const modulePath = path.join(repositoryRoot, 'src', 'zod-variable-catalog.js');
fs.writeFileSync(modulePath, `// 此文件由 scripts/build-zod-catalog.cjs 从本体 ZOD 自动生成。\nexport default ${JSON.stringify(output, null, 2)};\n`);
console.log(`Generated ${fields.length} fields from ${zodSourcePath}`);
