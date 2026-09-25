/**
 * M4 命名防漂移（specs/009）：「记忆分组」族旧命名已统一为「本体分组」，
 * 用机械断言钉住，防止后续改动把旧说法写回来。
 *
 * 背景：Backlog v2.6 第 55 行授权的命名治理。统一前同一事物有两套说法
 * （导航「记忆分组」 vs 详情「本体分组」），四语各有一套旧词形。治理口径：
 * 只改界面词条与代码注释；`personal_ontology_groups.ts` 生成 `groups.md` 的
 * `# 记忆分组` 文件头**刻意保留**（数据文件内容，见 specs/009 待总控确认第 9 条），
 * 因此源码扫描只覆盖渲染层 modules，不扫生成内容。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.join(__dirname, '../..');
const LOCALES = ['zh', 'en', 'ja', 'pt'] as const;

/** 旧命名的四语词形——任何语言文件的任何词条值里再出现即为回退。 */
const STALE_TERMS = ['记忆分组', 'Memory Groups', 'メモリグループ', 'Grupos de memória'];

/** 同一事物在导航与详情两处必须用同一词形（每语内部一致，非跨语相等）。 */
const SAME_TERM_KEYS = ['personalOntology.nav_groups', 'personalOntology.groups_title'] as const;

function loadLocale(name: typeof LOCALES[number]): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, `src/renderer/locales/${name}.json`), 'utf8')) as Record<string, unknown>;
}

function listRendererModules(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor') out.push(...listRendererModules(full));
      continue;
    }
    if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('M4 命名一致性（本体分组）', () => {
  it('四语词条值中不再出现「记忆分组」族的任何旧说法', () => {
    const offenders: string[] = [];
    for (const name of LOCALES) {
      const table = loadLocale(name);
      for (const [key, value] of Object.entries(table)) {
        if (typeof value === 'string' && STALE_TERMS.some((term) => value.includes(term))) {
          offenders.push(`${name}:${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nav_groups / dest_no_groups / groups_title 三键四语齐全，且导航与详情同词形', () => {
    for (const name of LOCALES) {
      const table = loadLocale(name);
      for (const key of [...SAME_TERM_KEYS, 'personalOntology.dest_no_groups']) {
        expect(typeof table[key], `${name}:${key} 应存在`).toBe('string');
      }
      expect(table[SAME_TERM_KEYS[0]], `${name}: 导航与详情应同词形`).toBe(table[SAME_TERM_KEYS[1]]);
    }
  });

  it('渲染层 modules 源码（含注释）不再出现「记忆分组」', () => {
    const offenders: string[] = [];
    for (const file of listRendererModules(path.join(root, 'src/renderer/modules'))) {
      if (fs.readFileSync(file, 'utf8').includes('记忆分组')) offenders.push(path.relative(root, file));
    }
    expect(offenders).toEqual([]);
  });
});
