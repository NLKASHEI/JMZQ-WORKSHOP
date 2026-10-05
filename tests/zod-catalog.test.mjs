import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const catalog = JSON.parse(fs.readFileSync(new URL('../data/zod-variable-catalog.json', import.meta.url), 'utf8'));

test('变量目录由本体 ZOD 生成并包含主要游戏状态', () => {
  assert.ok(catalog.fieldCount >= 300);
  assert.equal(catalog.sourceSha256.length, 64);
  const byPath = new Map(catalog.fields.map(field => [field.path.join('.'), field]));
  assert.equal(byPath.get('世界阶段')?.type, 'enum');
  assert.equal(byPath.get('环境.天气')?.type, 'string');
  assert.equal(byPath.get('核心状态.hp_current')?.type, 'number');
  assert.equal(byPath.get('扩展内容.质形重构')?.type, 'boolean');
});

test('动态记录使用可替换的中文占位位置', () => {
  const dynamicField = catalog.fields.find(field => field.dynamic && field.path.some(segment => /^\{.+\}$/.test(segment)));
  assert.ok(dynamicField);
  assert.ok(dynamicField.path.every(segment => typeof segment === 'string'));
});
