/**
 * 提交资料补齐：写副本、不碰原件、不静默选值。
 *
 * 三条不变量各有用例：
 * 1. 补齐只作用于副本（`C-FR-004b`）——原件字节不变；
 * 2. 补齐写进包内规范位置（Hub c02：「只补 manifest 而不补包，不能通过」）；
 * 3. 多来源冲突全部列出，不自动取一个（`C-FR-004b`：「不得静默取一个值覆盖另一个值」）。
 *
 * 用真实临时目录：要测的正是"写到盘上什么位置"，mock fs 会把结论假设掉。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  inspectCompletion, applyCompletion, isSemver,
} from '../../../../src/main/features/contribution/completion';
import { parseSkillFrontmatter } from '../../../../src/main/features/skills';

let tmp: string;
const staging = () => ({ dir: tmp, sourceSkillId: 'demo', token: 'cafebabe' });

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contrib-completion-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const write = (rel: string, c: string) => {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, c);
};

describe('SemVer 校验', () => {
  it.each(['1.0.0', '0.1.2', '2.3.4-beta.1', '1.0.0+build.5'])('接受 %s', (v) => {
    expect(isSemver(v)).toBe(true);
  });
  it.each(['1.0', 'v1.0.0', '', '  ', 'latest', '1.0.0.0'])('拒绝 %s', (v) => {
    expect(isSemver(v)).toBe(false);
  });
});

describe('盘点缺失项', () => {
  it('本机自定义 Skill 无版本字段 —— 版本是必经补齐项', () => {
    write('SKILL.md', '---\nname: demo\ndescription: d\n---\n\n# body');
    const s = inspectCompletion(staging());
    expect(s.missing).toContain('version');
    expect(s.present.name).toBe('demo');
  });

  it('缺 SKILL.md 时元信息与安全声明均明确列为缺失', () => {
    const s = inspectCompletion(staging());
    expect(s.missing).toEqual(['skill_md', 'name', 'description', 'version', 'security_manifest']);
  });

  it('description 可由双语字段之一满足', () => {
    write('SKILL.md', '---\nname: demo\ndescription_zh: 中文说明\n---\n');
    expect(inspectCompletion(staging()).missing).not.toContain('description');
  });
});

describe('冲突不自动取值', () => {
  it('frontmatter 与 _meta.json 的名称不一致 → 列成冲突并给出两个来源', () => {
    write('SKILL.md', '---\nname: from-skill-md\ndescription: d\n---\n');
    write('_meta.json', JSON.stringify({ name: 'from-meta', version: '1.0.0' }));
    const c = inspectCompletion(staging()).conflicts;
    expect(c).toHaveLength(1);
    expect(c[0].field).toBe('name');
    expect(c[0].values.map((v) => v.value).sort()).toEqual(['from-meta', 'from-skill-md']);
  });

  it('一致时不报冲突', () => {
    write('SKILL.md', '---\nname: same\ndescription: d\n---\n');
    write('_meta.json', JSON.stringify({ name: 'same', version: '1.0.0' }));
    expect(inspectCompletion(staging()).conflicts).toEqual([]);
  });
});

describe('补齐写进包内规范位置', () => {
  it('名称与说明写 SKILL.md frontmatter —— 不是只写 manifest', () => {
    write('SKILL.md', '---\nname: old\n---\n\n# body');
    applyCompletion(staging(), { name: 'new-name', description: '新说明' });
    const text = fs.readFileSync(path.join(tmp, 'SKILL.md'), 'utf8');
    const fm = parseSkillFrontmatter(text);
    expect(fm.name).toBe('new-name');
    expect(fm.description).toBe('新说明');
    expect(text).toContain('# body'); // 正文保留
  });

  it('版本写 _meta.json', () => {
    write('SKILL.md', '---\nname: d\n---\n');
    applyCompletion(staging(), { version: '1.2.3' });
    expect(JSON.parse(fs.readFileSync(path.join(tmp, '_meta.json'), 'utf8')).version).toBe('1.2.3');
  });

  it('非法 SemVer 直接抛错，不写入半成品', () => {
    write('SKILL.md', '---\nname: d\n---\n');
    expect(() => applyCompletion(staging(), { version: 'v1' })).toThrow('invalid_semver');
    expect(fs.existsSync(path.join(tmp, '_meta.json'))).toBe(false);
  });

  it('保留 frontmatter 里解析器不认识的结构 —— 那是贡献者的内容', () => {
    write('SKILL.md', '---\nname: old\nallowed-tools:\n  - read\n  - write\n---\n\n# body');
    applyCompletion(staging(), { name: 'new' });
    const text = fs.readFileSync(path.join(tmp, 'SKILL.md'), 'utf8');
    expect(text).toContain('allowed-tools:');
    expect(text).toContain('- read');
    expect(text).toContain('- write');
    expect(parseSkillFrontmatter(text).name).toBe('new');
  });

  it('_meta.json 既有字段不被覆盖', () => {
    write('SKILL.md', '---\nname: d\n---\n');
    write('_meta.json', JSON.stringify({ category: 'writing', forked_from: { content_id: 'abc', version: '1.0.0' } }));
    applyCompletion(staging(), { version: '2.0.0' });
    const meta = JSON.parse(fs.readFileSync(path.join(tmp, '_meta.json'), 'utf8'));
    expect(meta.category).toBe('writing');
    expect(meta.forked_from).toEqual({ content_id: 'abc', version: '1.0.0' });
    expect(meta.version).toBe('2.0.0');
  });

  it('安全声明只写入提交副本的规范路径并可再次盘点', () => {
    const manifest = 'manifest_version: "1.1.1"\nsecurity_ontology:\n  id: cogseed.security.skill\n  version: "1.1.1"';
    applyCompletion(staging(), { security_manifest: manifest });
    expect(fs.readFileSync(path.join(tmp, 'references/security-manifest.yaml'), 'utf8')).toBe(`${manifest}\n`);
    const state = inspectCompletion(staging());
    expect(state.missing).not.toContain('security_manifest');
    expect(state.present.security_manifest).toBe(`${manifest}\n`);
  });

  it('拒绝无效或非对象 YAML，不创建声明文件', () => {
    expect(() => applyCompletion(staging(), { security_manifest: 'a: [broken' })).toThrow('invalid_security_manifest_yaml');
    expect(() => applyCompletion(staging(), { security_manifest: '- list' })).toThrow('invalid_security_manifest_yaml');
    expect(fs.existsSync(path.join(tmp, 'references/security-manifest.yaml'))).toBe(false);
  });
});
