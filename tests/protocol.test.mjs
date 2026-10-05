import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntryStates, evaluateCondition, readPath } from '../src/protocol.js';

const statData = {
  世界阶段: '末世期',
  环境: { 天气: '终年暴雨' },
  核心状态: { infection_current: 65 },
  工坊扩展: {
    'example.weather-story': { 启用: true, 版本: '1.0.0', 数据: {} },
  },
};

test('读取数组路径并阻止原型链路径', () => {
  assert.equal(readPath(statData, ['环境', '天气']), '终年暴雨');
  assert.equal(readPath(statData, ['__proto__', 'polluted']), undefined);
});

test('组合条件能够连接原版变量', () => {
  assert.equal(evaluateCondition({
    all: [
      { path: ['世界阶段'], operator: 'in', value: ['爆发期', '末世期'] },
      { path: ['环境', '天气'], operator: 'contains', value: '暴雨' },
      { path: ['核心状态', 'infection_current'], operator: 'gte', value: 60 },
    ],
  }, statData), true);
});

test('作品开关控制自己的全部条目', () => {
  const registry = {
    protocolVersion: 1,
    packages: [{
      id: 'example.weather-story',
      enabled: true,
      entries: [{
        name: '[jmzq_ext:example.weather-story] 暴雨求生',
        activeWhen: { path: ['环境', '天气'], operator: 'contains', value: '暴雨' },
      }],
    }],
  };
  const active = buildEntryStates(registry, statData);
  assert.equal(active.states.get('[jmzq_ext:example.weather-story] 暴雨求生'), true);

  const disabled = structuredClone(statData);
  disabled.工坊扩展['example.weather-story'].启用 = false;
  assert.equal(buildEntryStates(registry, disabled).states.get('[jmzq_ext:example.weather-story] 暴雨求生'), false);
});

test('重复接管同名条目会报告冲突', () => {
  const registry = {
    protocolVersion: 1,
    packages: [
      { id: 'example.one', entries: [{ name: '重复条目', enabledByDefault: true }] },
      { id: 'example.two', entries: [{ name: '重复条目', enabledByDefault: true }] },
    ],
  };
  const result = buildEntryStates(registry, statData);
  assert.equal(result.errors.length, 1);
});

