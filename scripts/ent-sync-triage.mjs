#!/usr/bin/env node
/**
 * 企业版同步冲突分诊器（只读）
 *
 * 目的：在解决冲突之前，先把每个冲突文件按「功能改动 / UI 改动」量化，
 *       回答「只吸收功能、不吸收 UI」时每个文件该怎么处置。
 *
 * 判据（词法级，不依赖 AST；renderer 是 classic script，无类型信息）：
 *   - UI 信号：CSS 类/属性选择器、style 赋值、classList、DOM 结构创建、
 *             内联样式、querySelector 的类选择器
 *   - 功能信号：IPC 调用（window.cogseed.invoke/stream）、IPC 通道字符串、
 *             fetch/HTTP、状态与数据流、业务事件名
 *
 * 用法：
 *   node scripts/ent-sync-triage.mjs                 # 预演并分诊 gitlab/develop-ent += origin/develop
 *   node scripts/ent-sync-triage.mjs --left <ref> --right <ref>
 *   node scripts/ent-sync-triage.mjs --json          # 机器可读输出
 *   node scripts/ent-sync-triage.mjs --save          # 写入 docs/ent-sync-triage-<date>.json
 *
 * 只读：仅调用 git 只读命令（merge-tree / diff / show），不改工作区、不建提交。
 *
 * 注意：本机没有本地 develop-ent 分支，默认用远端跟踪引用 gitlab/develop-ent。
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 政策表：只吸收功能，不吸收 UI ----------
// keep-ours  = 整文件取企业侧（纯 UI 资产）
// merge      = 必须并集/人工解决
// theirs+    = 取上游为基底，但必须回补企业钩子
const POLICY = [
  { match: /\.css$/,                          action: 'keep-ours', why: '纯样式资产，本次不吸收上游 UI' },
  { match: /\.html$/,                         action: 'merge',     why: '企业为基底 + 回补上游新增 script/link 引用' },
  { match: /^src\/renderer\/locales\/.*\.json$/, action: 'merge',  why: '上游为基底 + 企业同名键覆盖（含 i18n key 化 breaking）' },
  { match: /^src\/main\//,                    action: 'merge',     why: '主进程=功能主干，必须并集（含企业门禁接线）' },
  { match: /^test\//,                         action: 'merge',     why: '渠道化测试，两线同一套必须都过' },
  { match: /^(package\.json|package-lock\.json|run\.sh)$/, action: 'merge', why: '通道/身份/脚本并集' },
  { match: /^scripts\//,                      action: 'merge',     why: '构建与运维脚本并集' },
  { match: /^src\/renderer\/modules\//,       action: 'triage',    why: '按功能/UI 占比判定（见 triage 字段）' },
];

// 纯演示层文件：即使没有 CSS 后缀，也不参与功能同步
const PRESENTATION_ONLY = [
  /(^|\/)component-gallery\.(js|html)$/,
];

// ---------- 词法信号 ----------
const UI_SIGNALS = [
  [/^\s*[+-]?\s*[.#][A-Za-z][\w-]*\s*\{/, 'CSS 规则块'],
  [/^\s*[+-]?\s*@media/, 'CSS @media'],
  [/\bclassList\.(add|remove|toggle|contains)\b/, 'classList 操作'],
  [/\.style\.[a-zA-Z]+\s*=/, '内联样式赋值'],
  [/\bsetAttribute\(\s*['"](class|style)['"]/, 'class/style 属性写入'],
  [/\bquerySelector(All)?\(\s*['"][.#]/, '类/ID 选择器查询'],
  [/\bcreateElement\(/, 'DOM 结构创建'],
  [/\b(innerHTML|outerHTML|insertAdjacentHTML)\s*=/, 'DOM 结构写入'],
  [/--[a-z][\w-]*\s*:/, 'CSS 变量定义'],
  [/\b(uiIconHtml|hydrateUiIcons|uiButton|uiCard|uiTag|uiChip|uiBadge)\b/, '共享 UI 组件调用'],
];

const FEATURE_SIGNALS = [
  [/window\.cogseed\.(invoke|stream)\s*\(/, 'IPC 调用'],
  [/['"][a-z][\w-]*\.[a-z][\w.-]*['"]/, 'IPC 通道字符串'],
  [/\b(fetch|axios)\s*\(/, 'HTTP 调用'],
  [/\bawait\s+window\.cogseed/, 'IPC await'],
  [/\b(state|store|reducer|dispatch)\b/, '状态/数据流'],
  [/\b(features?|services?)\.[a-z]/i, 'feature/service 调用'],
  [/\b(createLogger|logger)\.(info|warn|error)\b/, '日志'],
];

function sh(args, { allowFail = false } = {}) {
  // 用 spawnSync 而非 execFileSync：merge-tree 有冲突时退出码为 1，
  // execFileSync 会抛异常并丢掉我们已经需要的 stdout。
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`git ${args.join(' ')} 无法执行: ${r.error.message}`);
  const out = r.stdout ?? '';
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} 失败 (exit ${r.status}): ${(r.stderr ?? '').trim()}`);
  }
  return out;
}

function parseArgs(argv) {
  const out = { left: 'gitlab/develop-ent', right: 'origin/develop', json: false, save: false, limit: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--left') out.left = argv[++i];
    else if (a === '--right') out.right = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--save') out.save = true;
    else if (a === '--limit') out.limit = Number(argv[++i]);
  }
  return out;
}

/** 用 merge-tree 预演，拿到真冲突文件（严格排除 Auto-merging / CONFLICT 提示行） */
function dryRunConflicts(left, right) {
  const raw = sh(['merge-tree', '--write-tree', '--name-only', '--messages', left, right], { allowFail: true });
  const lines = raw.split('\n');
  const tree = lines[0]?.trim() ?? '';
  const files = lines
    .slice(1)
    .filter((l) => l && !/^(CONFLICT|Auto-merging|warning|Merge|usage)/i.test(l))
    .map((l) => l.trim())
    .sort();
  const conflicted = new Set(files);
  return { tree, conflicted, conflictedCount: conflicted.size };
}

function policyFor(file) {
  if (PRESENTATION_ONLY.some((re) => re.test(file))) {
    return { action: 'keep-ours', why: '组件演示页，非功能路径' };
  }
  for (const p of POLICY) if (p.match.test(file)) return { action: p.action, why: p.why };
  return { action: 'merge', why: '未分类，默认人工并集' };
}

/** 分析某个文件在两侧各自相对 merge-base 的改动，输出功能/UI 计数 */
function analyzeFile(file, base, left, right) {
  const collect = (from, to) => {
    const d = sh(['diff', '-U0', from, to, '--', file], { allowFail: true });
    return d
      .split('\n')
      .filter((l) => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---'));
  };
  const ours = collect(base, left);
  const theirs = collect(base, right);

  const score = (lines) => {
    let ui = 0;
    let feat = 0;
    const uiHits = new Set();
    const featHits = new Set();
    for (const line of lines) {
      for (const [re, label] of UI_SIGNALS) if (re.test(line)) { ui += 1; uiHits.add(label); break; }
      for (const [re, label] of FEATURE_SIGNALS) if (re.test(line)) { feat += 1; featHits.add(label); break; }
    }
    return { ui, feat, uiHits: [...uiHits], featHits: [...featHits] };
  };

  const o = score(ours);
  const t = score(theirs);
  const total = o.feat + t.feat;
  const uiTotal = o.ui + t.ui;

  // 判定：上游改动以功能为主 → 需要吸收；否则按 UI 处置
  let triage;
  if (total === 0 && uiTotal === 0) triage = 'noise';            // 纯空行/格式
  else if (t.feat === 0) triage = 'upstream-ui-only';            // 上游只动 UI → 可整体放弃
  else if (t.feat >= t.ui * 2) triage = 'absorb';                // 上游以功能为主（含纯功能、我方全是 UI 钩子）
  else triage = 'mixed';                                         // 功能/UI 混杂 → 人工

  return {
    file,
    oursLines: ours.length,
    theirsLines: theirs.length,
    ours: { ui: o.ui, feat: o.feat },
    theirs: { ui: t.ui, feat: t.feat },
    triage,
  };
}

/**
 * IPC 契约校验：抽取指定文件中引用的 IPC 通道，报告哪些在 src/main 侧找不到。
 * 依据 AGENTS.md：IPC 是唯一应用通信路径；渲染层残留未实现通道 = 运行时静默失败。
 *
 * 注意：handler 分散在 src/main/ipc/*.ts 多个文件（如 `...connectorsHandlers` 对象展开），
 * 只扫 index.ts 会产生大量假阳性，必须扫整个 src/main/ipc/ 目录。
 */
function ipcContractCheck(files, ref) {
  const CHANNEL_RE = /window\.cogseed\.(?:invoke|stream)\(\s*['"]([a-z][\w.-]*)['"]/g;
  // 剔除注释行，避免把文档/说明里的示例通道当成真实引用
  const stripComments = (text) => text
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n');
  const referenced = new Map(); // channel -> Set(file)
  for (const file of files) {
    const text = stripComments(sh(['show', `${ref}:${file}`], { allowFail: true }));
    if (!text) continue;
    for (const line of text.split('\n')) {
      // 跳过否定断言（expect(...).not.toContain('通道')），它不是在调用通道
      if (/\.not\.toContain\s*\(/.test(line)) continue;
      for (const m of line.matchAll(CHANNEL_RE)) {
        if (!referenced.has(m[1])) referenced.set(m[1], new Set());
        referenced.get(m[1]).add(file);
      }
    }
  }
  // 主进程已注册的通道：扫整个 ipc 目录下所有文件里的引号字符串
  const ipcFiles = sh(['ls-tree', '-r', '--name-only', ref, '--', 'src/main/ipc/'])
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const registered = new Set();
  for (const f of ipcFiles) {
    const text = stripComments(sh(['show', `${ref}:${f}`], { allowFail: true }));
    for (const m of text.matchAll(/['"`]([a-z][\w.-]*\.[\w.-]+)['"`]/g)) registered.add(m[1]);
  }
  const missing = [...referenced.entries()]
    .filter(([ch]) => !registered.has(ch))
    .map(([ch, fs]) => ({ channel: ch, files: [...fs] }));
  return { referencedCount: referenced.size, registeredCount: registered.size, ipcFilesScanned: ipcFiles.length, missing };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = sh(['merge-base', args.left, args.right]).trim();
  const { tree, conflicted } = dryRunConflicts(args.left, args.right);

  const rows = [];
  for (const file of [...conflicted].slice(0, args.limit)) {
    const policy = policyFor(file);
    const stats = analyzeFile(file, base, args.left, args.right);
    let verdict = policy.action;
    if (policy.action === 'triage') {
      verdict = stats.triage === 'absorb' ? 'theirs+'
        : stats.triage === 'upstream-ui-only' ? 'keep-ours'
          : stats.triage === 'noise' ? 'either'
            : 'mixed';
    }
    rows.push({ ...stats, policy: policy.action, why: policy.why, verdict });
  }

  const summary = {
    left: args.left,
    right: args.right,
    mergeBase: base.slice(0, 8),
    mergedTree: tree.slice(0, 12),
    conflictedCount: rows.length,
    byVerdict: rows.reduce((acc, r) => ((acc[r.verdict] = (acc[r.verdict] || 0) + 1), acc), {}),
    rows,
    ipc: ipcContractCheck(rows.map((r) => r.file), args.left),
  };

  if (args.json || args.save) {
    const text = JSON.stringify(summary, null, 2);
    if (args.save) {
      const out = path.join(ROOT, 'docs', `ent-sync-triage-${new Date().toISOString().slice(0, 10)}.json`);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, text);
      process.stderr.write(`已写入 ${out}\n`);
    }
    if (args.json) process.stdout.write(`${text}\n`);
  }

  if (!args.json) {
    const pad = (s, n) => String(s).padEnd(n);
    const rpad = (s, n) => String(s).padStart(n);
    console.log(`\n合并基 ${summary.mergeBase}  预演结果树 ${summary.mergedTree}`);
    console.log(`冲突文件 ${summary.conflictedCount} 个\n`);
    console.log(`${pad('判定', 10)} ${pad('文件', 46)} ${rpad('我方', 14)} ${rpad('上游', 14)}`);
    console.log(`${pad('', 10)} ${pad('', 46)} ${rpad('UI/功能', 14)} ${rpad('UI/功能', 14)}`);
    console.log('-'.repeat(92));
    const order = { mixed: 0, 'theirs+': 1, merge: 2, 'keep-ours': 3, either: 4 };
    for (const r of [...rows].sort((a, b) => (order[a.verdict] ?? 9) - (order[b.verdict] ?? 9))) {
      console.log(
        `${pad(r.verdict, 10)} ${pad(r.file.length > 45 ? `…${r.file.slice(-44)}` : r.file, 46)} `
        + `${rpad(`${r.ours.ui}/${r.ours.feat}`, 14)} ${rpad(`${r.theirs.ui}/${r.theirs.feat}`, 14)}`,
      );
    }
    console.log('-'.repeat(92));
    console.log('判定统计:', JSON.stringify(summary.byVerdict));
    console.log('\n判定含义：');
    console.log('  mixed     = 上游改动功能/UI 混杂，必须人工逐块解决（优先做）');
    console.log('  theirs+   = 取上游为基底，但必须回补企业钩子');
    console.log('  merge     = 按政策表并集解决');
    console.log('  keep-ours = 整文件取企业侧（纯 UI 资产，本次不吸收）');
    console.log('  either    = 两侧均无实质改动（格式/空行）');

    console.log(`\n【IPC 契约校验】扫主进程 ${summary.ipc.ipcFilesScanned} 个 ipc 文件、`
      + `注册通道 ${summary.ipc.registeredCount} 个；冲突文件引用 ${summary.ipc.referencedCount} 个，`
      + `未匹配 ${summary.ipc.missing.length} 个`);
    if (summary.ipc.missing.length) {
      for (const { channel, files } of summary.ipc.missing.slice(0, 20)) {
        console.log(`  ✗ ${channel}    <- ${files.join(', ')}`);
      }
      console.log('  说明：这些通道在合并后可能运行时报错，解决冲突时必须确认主进程侧是否需同步实现。');
    } else {
      console.log('  ✓ 全部通道均已在主进程注册');
    }

    console.log('\n只读运行：未修改工作区、未创建提交。');
  }
}

main();
