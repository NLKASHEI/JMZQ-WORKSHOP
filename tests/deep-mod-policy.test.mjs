import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifestSchema = JSON.parse(fs.readFileSync(new URL('../schemas/manifest.schema.json', import.meta.url), 'utf8'));

test('完整改造固定为人工安装并禁止小助手自动覆盖核心文件', () => {
  assert.equal(manifestSchema.properties.installMode.const, 'manual');
  assert.equal(manifestSchema.properties.helperSupport.properties.automaticInstall.const, false);
  const deepRule = manifestSchema.allOf.find(rule => rule.if?.properties?.kind?.const === 'deep');
  for (const field of ['baseVersion', 'installMode', 'installGuide', 'uninstallGuide', 'replaces', 'helperSupport']) {
    assert.ok(deepRule.then.required.includes(field));
  }
});
