/**
 * KSTAR 可关闭／认知资产独立（FR-001/CA-FR-007、AC-011/CA-AC-005）的结构钉子：
 *
 *   ① 认知资产权威层（features/cognition/**、features/cognition_kernel/**）不得
 *      import features/kstar/**——依赖方向只能是 KSTAR→认知（子线程/适配器），
 *      反向一出现，"关闭 KSTAR 后认知资产仍能保存/整理/查询/被任务引用"就破功。
 *   ② recall→kstar 的既有反向依赖只有冻结清单里的 3 个符号引用（2026-10-07
 *      收敛轮登记的内部复用耦合：scopeForTask/experienceTypeOf），新增即红——
 *      待下沉共享层时清单清空，而不是继续长。
 *
 * 源码级扫描（同 improvement-admission-guard 口径）：import 声明与动态 import 都算。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..', 'src', 'main', 'features');
const COGNITION_DIRS = ['cognition', 'cognition_kernel'] as const;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** 抽掉块/行注释，避免注释里的路径误报。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 文件里引用 kstar 模块路径的 import（静态 + 动态）。 */
function kstarImports(code: string): string[] {
  const pattern = /(?:from\s+'|import\(\s*['"])([^'"]*features\/kstar\/[^'"]+)/g;
  const hits: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) hits.push(match[1]);
  return hits;
}

// recall→kstar 已知反向依赖（符号级）：文件 → 允许引用的 kstar 符号。
// 2026-10-07 收敛轮登记：experience 系经验目录/迁移/工具复用 kstar/extraction-service
// 的 scopeForTask/experienceTypeOf。属内部复用耦合，不产生第二条提取→发布链路。
const RECALL_KSTAR_ALLOWLIST: Record<string, readonly string[]> = {
  'experience-catalog.ts': ['scopeForTask', 'experienceTypeOf'],
  'experience-migration.ts': ['scopeForTask', 'experienceTypeOf'],
};

describe('KSTAR 可关闭：认知资产层依赖方向钉子（AC-011）', () => {
  it('cognition/cognition_kernel 不得 import features/kstar（KSTAR 只能是消费者）', () => {
    const offenders: string[] = [];
    for (const dir of COGNITION_DIRS) {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) continue;
      for (const file of listTsFiles(full)) {
        const code = stripComments(fs.readFileSync(file, 'utf8'));
        const hits = kstarImports(code);
        if (hits.length) offenders.push(`${path.relative(ROOT, file)} -> ${hits.join(', ')}`);
      }
    }
    expect(offenders, `认知资产权威层反向依赖 KSTAR：${offenders.join(' ; ')}——关闭 KSTAR 即断链（FR-001/AC-011）；KSTAR 只能作为统一提取管线的适配器单向依赖认知层`).toEqual([]);
  });

  it('recall→kstar 的反向依赖冻结在已知清单（新增即红，防蔓延）', () => {
    const offenders: string[] = [];
    const recallDir = path.join(ROOT, 'recall');
    for (const file of listTsFiles(recallDir)) {
      const base = path.basename(file);
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      const imports = kstarImports(code);
      if (!imports.length) continue;
      const allowed = RECALL_KSTAR_ALLOWLIST[base];
      if (!allowed) {
        offenders.push(`${base}: 新增 kstar import（${imports.join(', ')}）——recall 不应扩大对 kstar 的依赖`);
        continue;
      }
      for (const symbol of allowed) {
        if (!code.includes(symbol)) {
          offenders.push(`${base}: 清单符号 ${symbol} 不再使用——从冻结清单移除`);
        }
      }
      const kstarImportLines = code.split('\n').filter((line) => kstarImports(line).length > 0);
      for (const symbol of kstarImportLines.join('\n').match(/\{[^}]*\}/g)?.map((block) => block) ?? []) {
        for (const name of symbol.replace(/[{}]/g, '').split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
          if (!allowed.includes(name)) {
            offenders.push(`${base}: 从 kstar 引入了清单外符号 ${name}`);
          }
        }
      }
    }
    expect(offenders, `recall→kstar 依赖蔓延：${offenders.join(' ; ')}——经验系符号应下沉共享层（2026-10-07 登记待办），而不是继续从 kstar 拉取`).toEqual([]);
  });
});
