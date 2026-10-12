import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AGENT_CATEGORIES, AGENT_COLORS, AGENT_ICONS, AGENT_INPUT_TYPES, AGENT_OUTPUT_FORMATS,
  DEFAULT_PACKAGE_LIMITS, checkAgentName, checkPackageLimits, classifySkillRef, displayWidth,
  splitSkillRefs, toDistributableAgent, validateAgentJson,
} from '../../../../src/main/features/contribution/agent-package-rules';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/hub-agent-contributions');
const SCHEMA = path.resolve(__dirname, '../../../../specs/008-hub-agent-distribution/contracts/agent-package.schema.json');

const readFixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const fixtureNames = (prefix: string): string[] =>
  fs.readdirSync(FIXTURES).filter((f) => f.startsWith(prefix) && f.endsWith('.agent.json')).sort();

/**
 * 契约夹具：`pos-*` 必须通过，`neg-*` 必须被拒。
 * 夹具与 `specs/008-hub-agent-distribution/contracts/fixtures/agent-package/` 同源；Hub 侧读同一组。
 */
describe('Agent 包夹具', () => {
  // pos-builtin-ref 在契约层是合法的（Hub 定的第二类），客户端本期明确不实现，单独断言
  const clientPositive = fixtureNames('pos-').filter((n) => n !== 'pos-builtin-ref.agent.json');
  it.each(clientPositive)('%s 通过', (name) => {
    const result = validateAgentJson(readFixture(name));
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it.each(fixtureNames('neg-'))('%s 被拒', (name) => {
    expect(validateAgentJson(readFixture(name)).ok).toBe(false);
  });

  it('多余字段被拒而不是忽略，规则名为 agent.field.unexpected', () => {
    const r = validateAgentJson(readFixture('neg-extra-field-version.agent.json'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => i.rule)).toContain('agent.field.unexpected');
      expect(r.issues.find((i) => i.rule === 'agent.field.unexpected')?.path).toBe('version');
    }
  });

  it('builtin:<name> 本期不支持，不是被当成私有 Skill', () => {
    const r = validateAgentJson(readFixture('pos-builtin-ref.agent.json'));
    // 夹具名为 pos- 是契约层（Hub 定的三类）；客户端本期明确不实现该类
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.rule)).toContain('skill_ref.builtin_unsupported');
  });
});

describe('schema 枚举不漂移', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8')) as {
    properties: Record<string, { enum?: string[] }>;
    definitions: { AgentInput: { properties: { type: { enum: string[] } } } };
  };
  const same = (a: readonly string[], b: readonly string[]): void => expect([...a].sort()).toEqual([...b].sort());

  it('icon / color / category / output_format / input type 与 agent-package.schema.json 一致', () => {
    same(AGENT_ICONS, schema.properties.icon.enum ?? []);
    same(AGENT_COLORS, schema.properties.color.enum ?? []);
    same(AGENT_CATEGORIES, schema.properties.category.enum ?? []);
    same(AGENT_OUTPUT_FORMATS, schema.properties.output_format.enum ?? []);
    same(AGENT_INPUT_TYPES, schema.definitions.AgentInput.properties.type.enum);
  });

  it('crown 不在可分发图标里', () => {
    expect((AGENT_ICONS as readonly string[]).includes('crown')).toBe(false);
  });
});

/** 共用名称向量：Hub 与客户端各自实现，读同一个文件。 */
describe('名称规则向量', () => {
  const vectors = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'name-rule-vectors.json'), 'utf8')) as {
    vectors: Array<{ case: string; name: string; valid: boolean; reason: string | null }>;
  };

  it.each(vectors.vectors.map((v) => [v.case, v] as const))('%s', (_label, v) => {
    const rule = checkAgentName(v.name);
    expect(rule === null).toBe(v.valid);
    if (!v.valid) expect(rule).toBe(v.reason);
  });

  it('宽度：汉字计 2，其余计 1', () => {
    expect(displayWidth('会议纪要')).toBe(8);
    expect(displayWidth('abc')).toBe(3);
  });
});

describe('skill_list 分类', () => {
  it('12 位小写十六进制 = Hub；其余名字 = 随包；builtin: = 本期不支持', () => {
    expect(classifySkillRef('a3f09c21b7e4')).toBe('hub');
    expect(classifySkillRef('my-ocr-helper')).toBe('bundled');
    expect(classifySkillRef('builtin:grounded-material-qa')).toBe('builtin');
  });

  it('大写十六进制不是 Hub ID，而是合法的随包名字', () => {
    expect(classifySkillRef('A3F09C21B7E4')).toBe('bundled');
  });

  it('形态不合法被判 invalid', () => {
    expect(classifySkillRef('')).toBe('invalid');
    expect(classifySkillRef('-lead')).toBe('invalid');
    expect(classifySkillRef('has space')).toBe('invalid');
    expect(classifySkillRef('a/b')).toBe('invalid');
  });

  it('splitSkillRefs 只分出两类可用依赖', () => {
    expect(splitSkillRefs(['a3f09c21b7e4', 'my-ocr-helper', 'builtin:x'])).toEqual({
      hub: ['a3f09c21b7e4'], bundled: ['my-ocr-helper'],
    });
    expect(splitSkillRefs(undefined)).toEqual({ hub: [], bundled: [] });
  });

  it('重复条目被拒', () => {
    const r = validateAgentJson({
      name: '重复', description_zh: 'x', workflow: '1', category: 'office',
      skill_list: ['a3f09c21b7e4', 'a3f09c21b7e4'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.rule)).toContain('skill_ref.duplicate');
  });
});

describe('本机处理（toDistributableAgent）', () => {
  // 真实官方市场 Agent 的形态：作者原文 + created_at/updated_at
  const real = readFixture('pos-real-merch-researcher.agent.json') as Record<string, unknown>;

  it('剥掉三个生命周期字段后，真实市场 Agent 通过校验', () => {
    const withLifecycle = { ...real, version: '1.0.2', created_at: '2026-08-12T02:57:00Z', updated_at: '2026-08-12T02:58:00Z' };
    const out = toDistributableAgent(withLifecycle);
    expect(out.agent).not.toHaveProperty('version');
    expect(out.agent).not.toHaveProperty('created_at');
    expect(out.agent).not.toHaveProperty('updated_at');
    expect(out.handled.map((h) => h.field).sort()).toEqual(['created_at', 'updated_at', 'version']);
    expect(validateAgentJson(out.agent).ok).toBe(true);
  });

  it('不修改入参', () => {
    const input = { ...real, created_at: 'x', enabled_connectors: ['c1'] };
    const snapshot = JSON.stringify(input);
    toDistributableAgent(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('本机偏好与运行时派生字段被剥离并登记，仅用于本机预览', () => {
    const out = toDistributableAgent({
      ...real,
      enabled_connectors: ['conn-1'], default_model: { provider: 'p', model: 'm' }, default_thinking: 'low', create_uid: '42',
      enabled: true, source: 'custom', status: 'approved', runtime_stats: { runs: 3 }, profile: { x: 1 },
    });
    const kinds = Object.fromEntries(out.handled.map((h) => [h.field, h.kind]));
    expect(kinds.enabled_connectors).toBe('local_pref');
    expect(kinds.default_model).toBe('local_pref');
    expect(kinds.create_uid).toBe('local_pref');
    expect(kinds.enabled).toBe('derived');
    expect(kinds.runtime_stats).toBe('derived');
    expect(validateAgentJson(out.agent).ok).toBe(true);
  });

  it('宿主专有字段、外接运行时、crown 图标都是阻断项，不是静默剥离', () => {
    const host = toDistributableAgent({ ...real, management_surface: 'expense' });
    expect(host.blockers.map((b) => b.rule)).toContain('agent.host_only');
    expect(host.agent).toHaveProperty('management_surface');

    const cli = toDistributableAgent({ ...real, runtime: { kind: 'cli' } });
    expect(cli.blockers.map((b) => b.rule)).toContain('agent.runtime_not_distributable');

    const crown = toDistributableAgent({ ...real, icon: 'crown' });
    expect(crown.blockers.map((b) => b.rule)).toContain('agent.icon_not_distributable');
  });

  it('未知字段不被静默丢弃，由校验拒绝', () => {
    const out = toDistributableAgent({ ...real, brand_new_field: 1 });
    expect(out.agent).toHaveProperty('brand_new_field');
    const r = validateAgentJson(out.agent);
    expect(r.ok).toBe(false);
  });
});

describe('包上限（四段，走配置）', () => {
  it('默认值取自契约四段', () => {
    expect(DEFAULT_PACKAGE_LIMITS).toEqual({
      maxCompressedBytes: 8 * 1024 * 1024, maxFiles: 200, maxUnpackedBytes: 10 * 1024 * 1024, maxEntryCompressionRatio: 100,
    });
  });

  it('恰在上限内不报，超出才报', () => {
    expect(checkPackageLimits({ fileCount: 200, unpackedBytes: 10 * 1024 * 1024 })).toEqual([]);
    expect(checkPackageLimits({ fileCount: 201, unpackedBytes: 1 }).map((v) => v.kind)).toEqual(['too_many_files']);
    expect(checkPackageLimits({ fileCount: 1, unpackedBytes: 10 * 1024 * 1024 + 1 }).map((v) => v.kind)).toEqual(['unpacked_too_large']);
  });

  it('压缩后与压缩比只在已知时判定，未压缩不误报', () => {
    expect(checkPackageLimits({ fileCount: 1, unpackedBytes: 1 })).toEqual([]);
    expect(checkPackageLimits({ fileCount: 1, unpackedBytes: 1, compressedBytes: 8 * 1024 * 1024 + 1 }).map((v) => v.kind)).toEqual(['compressed_too_large']);
    expect(checkPackageLimits({ fileCount: 1, unpackedBytes: 1, maxEntryCompressionRatio: 101 }).map((v) => v.kind)).toEqual(['compression_ratio_too_high']);
  });

  it('上限可由契约覆盖，不依赖写死的常量', () => {
    const limits = { ...DEFAULT_PACKAGE_LIMITS, maxFiles: 300 };
    expect(checkPackageLimits({ fileCount: 250, unpackedBytes: 1 }, limits)).toEqual([]);
  });
});
