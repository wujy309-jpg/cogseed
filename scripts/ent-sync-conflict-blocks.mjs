#!/usr/bin/env node
/**
 * 冲突块提取器（只读）
 *
 * 从处于冲突状态的工作区中提取每个文件的冲突块，按「功能/UI」标注，
 * 输出人类可读的 Markdown 或机器可读的 JSON。用于同步前评估人工工作量。
 *
 * 用法（需在冲突合并状态的工作区内运行）：
 *   node scripts/ent-sync-conflict-blocks.mjs                     # 全部文件摘要
 *   node scripts/ent-sync-conflict-blocks.mjs --file <path>       # 单文件详情
 *   node scripts/ent-sync-conflict-blocks.mjs --file <path> --md  # 输出 Markdown
 *   node scripts/ent-sync-conflict-blocks.mjs --json
 *   node scripts/ent-sync-conflict-blocks.mjs --only-functional   # 只看功能文件
 *
 * 只读：不修改任何文件、不执行 git add。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const UI_SIGNALS = [
  [/^\s*[.#][A-Za-z][\w-]*\s*\{/, 'CSS'],
  [/\bclassList\.(add|remove|toggle|contains)\b/, 'classList'],
  [/\.style\.[a-zA-Z]+\s*=/, '内联样式'],
  [/\bquerySelector(All)?\(\s*['"][.#]/, '类选择器'],
  [/\b(innerHTML|outerHTML|insertAdjacentHTML)\s*=/, 'DOM 写入'],
  [/\b(uiIconHtml|hydrateUiIcons|uiButton|uiCard|uiTag|uiChip|uiBadge)\b/, '共享 UI'],
];
const FEATURE_SIGNALS = [
  [/window\.cogseed\.(invoke|stream)\s*\(/, 'IPC'],
  [/\b(fetch|axios)\s*\(/, 'HTTP'],
  [/\bawait\s+window\.cogseed/, 'IPC'],
  [/\b(state|store|reducer|dispatch)\b/, '状态流'],
  [/\b(createLogger|logger)\.(info|warn|error)\b/, '日志'],
];

const FUNCTIONAL_HINT = /^(src\/main\/|test\/|scripts\/)|(^|\/)(api_base|build-identity|client|index)\.(ts|js)$|locales\//;

function sh(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.stdout ?? '';
}

/** 切分冲突块：返回 [{startLine, ours:[], theirs:[], base:[]}] */
function parseConflicts(text) {
  const lines = text.split('\n');
  const blocks = [];
  let cur = null;
  let mode = null; // 'ours' | 'base' | 'theirs'
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('<<<<<<<')) { cur = { startLine: i + 1, ours: [], base: [], theirs: [] }; mode = 'ours'; continue; }
    if (line.startsWith('|||||||')) { mode = 'base'; continue; }
    if (line.startsWith('=======') && cur) { mode = 'theirs'; continue; }
    if (line.startsWith('>>>>>>>') && cur) { blocks.push(cur); cur = null; mode = null; continue; }
    if (cur) cur[mode].push(line);
  }
  return blocks;
}

function classify(lines) {
  let ui = 0;
  let feat = 0;
  const tags = new Set();
  for (const l of lines) {
    for (const [re, tag] of UI_SIGNALS) if (re.test(l)) { ui += 1; tags.add(`UI:${tag}`); break; }
    for (const [re, tag] of FEATURE_SIGNALS) if (re.test(l)) { feat += 1; tags.add(`功能:${tag}`); break; }
  }
  const kind = feat > ui ? '功能' : ui > feat ? 'UI' : feat === 0 && ui === 0 ? '中性' : '混合';
  return { ui, feat, kind, tags: [...tags] };
}

function conflictedFiles() {
  return sh(['diff', '--name-only', '--diff-filter=U']).split('\n').map((s) => s.trim()).filter(Boolean);
}

function main() {
  const argv = process.argv.slice(2);
  const opt = { file: null, json: false, md: false, onlyFunctional: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file') opt.file = argv[++i];
    else if (argv[i] === '--json') opt.json = true;
    else if (argv[i] === '--md') opt.md = true;
    else if (argv[i] === '--only-functional') opt.onlyFunctional = true;
  }

  if (!existsSync(path.join(ROOT, '.git'))) {
    console.error('错误：当前目录不是 git 工作区');
    process.exit(1);
  }
  const all = conflictedFiles();
  if (!all.length) {
    console.error('当前没有冲突文件（是否处于合并冲突状态？）');
    process.exit(1);
  }

  const targets = opt.file ? [opt.file] : all;
  const results = [];

  for (const file of targets) {
    const abs = path.join(ROOT, file);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const blocks = parseConflicts(text);
    if (!blocks.length) continue;
    const enriched = blocks.map((b) => ({
      startLine: b.startLine,
      oursLines: b.ours.length,
      theirsLines: b.theirs.length,
      ours: classify(b.ours),
      theirs: classify(b.theirs),
      oursPreview: b.ours.slice(0, 6),
      theirsPreview: b.theirs.slice(0, 6),
    }));
    const isFunctional = FUNCTIONAL_HINT.test(file);
    if (opt.onlyFunctional && !isFunctional) continue;
    results.push({
      file,
      functional: isFunctional,
      blockCount: blocks.length,
      totalOurs: enriched.reduce((a, b) => a + b.oursLines, 0),
      totalTheirs: enriched.reduce((a, b) => a + b.theirsLines, 0),
      blocks: enriched,
    });
  }

  if (opt.json) {
    console.log(JSON.stringify({ conflictedTotal: all.length, analyzed: results.length, files: results }, null, 2));
    return;
  }

  if (opt.file) {
    const r = results[0];
    if (!r) { console.log(`文件 ${opt.file} 无冲突块`); return; }
    console.log(`\n# ${r.file}\n`);
    console.log(`冲突块 ${r.blockCount} 个   我方 ${r.totalOurs} 行 / 上游 ${r.totalTheirs} 行\n`);
    for (const [i, b] of r.blocks.entries()) {
      console.log(`## 冲突 ${i + 1}  (第 ${b.startLine} 行起)`);
      console.log(`   我方 ${b.oursLines} 行 [${b.ours.kind}]${b.ours.tags.length ? ` {${b.ours.tags.join(', ')}}` : ''}`);
      console.log(`   上游 ${b.theirsLines} 行 [${b.theirs.kind}]${b.theirs.tags.length ? ` {${b.theirs.tags.join(', ')}}` : ''}`);
      if (opt.md) {
        console.log('\n**我方（企业侧）**\n```js');
        for (const l of b.oursPreview) console.log(l);
        if (b.oursLines > b.oursPreview.length) console.log(`// … 省略 ${b.oursLines - b.oursPreview.length} 行`);
        console.log('```');
        console.log('\n**上游（开源侧）**\n```js');
        for (const l of b.theirsPreview) console.log(l);
        if (b.theirsLines > b.theirsPreview.length) console.log(`// … 省略 ${b.theirsLines - b.theirsPreview.length} 行`);
        console.log('```\n');
      }
      console.log('');
    }
    return;
  }

  // 摘要模式
  console.log(`\n冲突文件 ${all.length} 个，分析 ${results.length} 个\n`);
  const pad = (s, n) => String(s).padEnd(n);
  const rp = (s, n) => String(s).padStart(n);
  console.log(`${pad('文件', 46)} ${rp('冲突块', 6)} ${rp('我方行', 7)} ${rp('上游行', 7)}  类型`);
  console.log('-'.repeat(88));
  for (const r of results.sort((a, b) => b.totalTheirs - a.totalTheirs)) {
    const kind = r.blocks.some((b) => b.theirs.kind === '功能') ? '功能' : 'UI/中性';
    console.log(`${pad(r.file.length > 45 ? `…${r.file.slice(-44)}` : r.file, 46)} ${rp(r.blockCount, 6)} ${rp(r.totalOurs, 7)} ${rp(r.totalTheirs, 7)}  ${kind}`);
  }
  console.log('-'.repeat(88));
  console.log(`合计冲突块 ${results.reduce((a, r) => a + r.blockCount, 0)} 个，`
    + `我方 ${results.reduce((a, r) => a + r.totalOurs, 0)} 行 / 上游 ${results.reduce((a, r) => a + r.totalTheirs, 0)} 行`);
  console.log('\n单文件详情: node scripts/ent-sync-conflict-blocks.mjs --file <path> --md');
}

main();
