#!/usr/bin/env node
/**
 * 企业版同步「只吸收功能、不吸收 UI」执行计划生成器
 *
 * 读取 ent-sync-triage 的分诊结果，生成**按顺序执行**的命令序列。
 * 本脚本默认只打印命令，不执行；加 --run 才真正执行（且只执行安全的自动步骤）。
 *
 * 用法：
 *   node scripts/ent-sync-apply-plan.mjs                       # 打印计划
 *   node scripts/ent-sync-apply-plan.mjs --out plan.sh         # 生成脚本文件
 *   node scripts/ent-sync-apply-plan.mjs --run                 # 执行（需已在合并冲突状态）
 *
 * 设计原则：
 *   - keep-ours 文件：git checkout --ours（企业侧），本次不吸收上游 UI
 *   - theirs+ / mixed 文件：**不自动处理**，只列出并提示人工解决
 *   - merge 文件：按政策表人工解决（locales 并集 / html 回补）
 *   - either 文件：无实质差异，可直接取任一侧
 *
 * 安全约束：绝不自动解决 mixed 文件；绝不 push；不修改工作区以外的东西。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');

function latestTriage() {
  if (!existsSync(DOCS)) throw new Error(`找不到 ${DOCS}`);
  const files = readdirSync(DOCS)
    .filter((f) => /^ent-sync-triage-.*\.json$/.test(f))
    .sort();
  if (!files.length) throw new Error('找不到分诊结果。请先运行: node scripts/ent-sync-triage.mjs --save');
  return path.join(DOCS, files[files.length - 1]);
}

function parseArgs(argv) {
  const out = { triage: null, out: null, run: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--triage') out.triage = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--run') out.run = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const triagePath = args.triage ?? latestTriage();
  const triage = JSON.parse(readFileSync(triagePath, 'utf8'));

  const ours = triage.rows.filter((r) => r.verdict === 'keep-ours').map((r) => r.file);
  const either = triage.rows.filter((r) => r.verdict === 'either').map((r) => r.file);
  const manual = triage.rows.filter((r) => r.verdict === 'theirs+' || r.verdict === 'mixed');
  const policyMerge = triage.rows.filter((r) => r.verdict === 'merge').map((r) => r.file);

  const L = [];
  const p = (s = '') => L.push(s);

  p('#!/usr/bin/env bash');
  p('# 由 scripts/ent-sync-apply-plan.mjs 生成 —— 只吸收功能、不吸收 UI');
  p(`# 分诊来源: ${path.relative(ROOT, triagePath)}`);
  p(`# 合并基: ${triage.mergeBase}   预演树: ${triage.mergedTree}   冲突: ${triage.conflictedCount}`);
  p('set -euo pipefail');
  p('');
  p('echo "==> 校验当前处于冲突合并状态"');
  p('test -f .git/MERGE_HEAD || { echo "错误：当前不在合并冲突状态，请先执行 git merge"; exit 1; }');
  p('');
  p('# 本机 node 由 nvm 管理，不在默认 PATH 里，这里显式补上');
  p('if ! command -v node >/dev/null 2>&1; then');
  p('  for d in "$HOME"/.nvm/versions/node/*/bin; do [ -x "$d/node" ] && export PATH="$d:$PATH"; done');
  p('fi');
  p('command -v node >/dev/null 2>&1 || { echo "错误：找不到 node"; exit 1; }');
  p('');
  p('# ---------------------------------------------------------------');
  p(`# 第 1 步：不吸收 UI —— ${ours.length} 个文件整文件取企业侧`);
  p('# ---------------------------------------------------------------');
  p('echo "==> [1/4] 取企业侧（纯 UI 资产，本次不吸收上游 UI）"');
  for (const f of ours) p(`git checkout --ours -- ${JSON.stringify(f)}`);
  p('');
  p('# ---------------------------------------------------------------');
  p(`# 第 2 步：无实质差异 —— ${either.length} 个文件`);
  p('# ---------------------------------------------------------------');
  for (const f of either) p(`git checkout --ours -- ${JSON.stringify(f)}`);
  p('');
  p('# ---------------------------------------------------------------');
  p(`# 第 3 步：必须人工解决 —— ${manual.length} 个文件（脚本不代劳）`);
  p('# ---------------------------------------------------------------');
  p('echo "==> [3/4] 以下文件需人工解决，请逐个处理后再继续"');
  for (const r of manual) {
    p(`#   [${r.verdict}] ${r.file}`);
    p(`#        我方 UI/功能=${r.ours.ui}/${r.ours.feat}  上游 UI/功能=${r.theirs.ui}/${r.theirs.feat}`);
  }
  p(`MANUAL_COUNT=${manual.length}`);
  p('read -r -p "已完成人工解决？输入 yes 继续: " ok');
  p('test "$ok" = "yes" || { echo "已中止"; exit 1; }');
  p('');
  p('# ---------------------------------------------------------------');
  p(`# 第 4 步：政策合并 —— ${policyMerge.length} 个文件（locales 并集 / html 回补 / 配置身份并集）`);
  p('# ---------------------------------------------------------------');
  p('# 这些文件必须并集解决，不能整文件取一侧：');
  for (const f of policyMerge) p(`#   ${f}`);
  p('');
  p('echo "==> [4/4] 标记已解决并校验"');
  p('git add -A');
  p('# 残留冲突标记检查');
  p('if git diff --cached --check | grep -q "conflict marker"; then');
  p('  echo "错误：仍存在冲突标记"; exit 1;');
  p('fi');
  p('');
  p('# ---------------- 强制校验（同步后必须全绿）----------------');
  p('echo "==> 企业专有回归校验"');
  p('fail=0');
  p('chk() { # chk <描述> <实际> <期望>');
  p('  if [ "$2" = "$3" ]; then echo "  ✓ $1 ($2)"; else echo "  ✗ $1 实际=$2 期望=$3"; fail=1; fi');
  p('}');
  p('chk "企业 appId"        "$(node -e "console.log(require(\'./src/resources/identity.json\').appId)")" "com.cogseed.enterprise"');
  p('chk "门禁断言数"        "$(grep -c assertEnterpriseSession src/main/ipc/index.ts)" "9"');
  p('chk "hub_account 模块数" "$(ls src/main/features/hub_account/*.ts | wc -l | tr -d \' \')" "10"');
  p('chk "企业文案键"        "$(grep -c enterprise_login src/renderer/locales/zh.json)" "6"');
  p('chk "内部域名残留"      "$(grep -rl "bonc.com.cn" src/ 2>/dev/null | wc -l | tr -d \' \')" "0"');
  p('test "$fail" = "0" || { echo "错误：企业专有回归校验未通过，不要提交"; exit 1; }');
  p('');
  p('echo "==> typecheck 与测试"');
  p('npm run typecheck');
  p('npm test');
  p('');
  p('echo "全部通过。请真机验证后再提交：bash scripts/restart-cogseed.sh"');
  p('# 注意：本脚本不提交、不 push');

  const text = L.join('\n');
  if (args.out) {
    // 绝对路径原样使用；相对路径按仓库根解析，避免落到 cwd
    const target = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
    writeFileSync(target, text, { mode: 0o755 });
    console.log(`已生成 ${target}`);
    console.log(`  不吸收 UI: ${ours.length} 个  无差异: ${either.length} 个  人工: ${manual.length} 个  政策合并: ${policyMerge.length} 个`);
  } else {
    console.log(text);
  }
}

main();
