// ─────────────────────────────────────────────────────────────────────────────
// 安全与信任 v2 · 设计稿构建（纯 Node，无窗口）
// ─────────────────────────────────────────────────────────────────────────────
// 这个脚本**不启动 Electron**，因此不会出现任何窗口、Dock 图标或焦点抢占。
// 它只做两件事：写一个 HTML，然后调用系统 Chrome 的 headless 模式截图。
//
// Chrome 的 --screenshot 只能截 --window-size 指定的视口，页面更高会被裁掉。
// 所以每个场景跑两次：先 --dump-dom 读回真实 scrollHeight，再按该高度截图。
//
//   node design/security-redesign/v2/build.mjs
//   SCENARIOS=blocked,skills-open node .../build.mjs   # 只跑部分场景
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const RENDERER = path.join(REPO, 'src/renderer');
const OUT = path.join(HERE, 'shots');
const PROFILE = path.join(os.tmpdir(), 'cogseed-design-headless');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 真实共享样式。刻意不含 style.css（生产页面自有样式），避免把 v3 的
// sec-* 规则混进设计稿。
const STYLE_HREFS = [
  path.join(RENDERER, 'tokens.css'),
  path.join(RENDERER, 'ui-components.css'),
  path.join(HERE, 'draft.css'),
];

// 与 index.html 相同的依赖顺序；uiDrawer 依赖 uiModalController。
const SCRIPT_SRCS = [
  'modules/icons.js',
  'modules/ui-button.js',
  'modules/ui-form.js',
  'modules/ui-status.js',
  'modules/ui-structure.js',
  'modules/ui-card.js',
  'modules/ui-empty.js',
  'modules/ui-modal.js',
  'modules/ui-drawer.js',
  'modules/ui-segmented-control.js',
];

const rel = (p) => path.relative(HERE, p).split(path.sep).join('/');

// ── 夹具（与 v1 同场景，便于三版横向对比） ───────────────────────────────────
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

const STATUS = {
  scanner: 'present',
  scannerIntegrity: 'verified',
  sentryEngineVersion: '2.2.0',
  sentryRulesetVersion: 'v1.1.0',
  declarationIntegrity: 'verified',
  rules: { total: 181, hardBlock: 2, groups: ['credential_expansion', 'dangerous_commands'] },
  interpreter: 'python3',
  externalTools: [{ id: 'gitleaks', available: false }, { id: 'osv-scanner', available: false }],
  capabilities: [
    { id: 'text_static_analysis', status: 'implemented' },
    { id: 'instruction_analysis', status: 'implemented' },
    { id: 'supply_chain_analysis', status: 'implemented' },
    { id: 'framework_mapping', status: 'implemented' },
    { id: 'context_awareness', status: 'implemented' },
    { id: 'hidden_content_detection', status: 'implemented' },
    { id: 'structural_analysis', status: 'implemented' },
    { id: 'obfuscation_detection', status: 'implemented' },
    { id: 'negative_example_recognition', status: 'implemented' },
    { id: 'binary_static_analysis', status: 'implemented' },
    { id: 'sarif_export', status: 'implemented' },
    { id: 'scoring_explainability', status: 'implemented' },
    { id: 'risk_acceptance', status: 'implemented' },
    { id: 'secret_detection', status: 'degraded', reason: 'no_gitleaks' },
    { id: 'dependency_vulnerability_scan', status: 'degraded', reason: 'no_osv_scanner' },
    { id: 'malware_signature_matching', status: 'partial', reason: 'no_yara_engine' },
  ],
};

const RECEIPTS = [
  { skillId: 'skill-creator', decision: 'pass', securityScore: 100, violationCount: 0, scannedAt: ago(6), scanner: 'deep', isolated: false, rulesDegraded: false },
  { skillId: 'integration-map', decision: 'pass', securityScore: 97, violationCount: 2, scannedAt: ago(41), scanner: 'deep', isolated: false, rulesDegraded: false },
  { skillId: 'e7f5c0e6f1be', decision: 'risk', securityScore: 62, violationCount: 7, scannedAt: ago(180), scanner: 'deep', isolated: false, rulesDegraded: false },
  { skillId: 'social-data', decision: 'risk', securityScore: 74, violationCount: 3, scannedAt: ago(1440), scanner: 'local', isolated: false, rulesDegraded: true },
  { skillId: 'agent-creator', decision: 'blocked', securityScore: 25, violationCount: 11, scannedAt: ago(2880), scanner: 'deep', isolated: false, rulesDegraded: false },
];

const SKILLS = [
  { id: 'skill-creator', name: '技能创建器' },
  { id: 'integration-map', name: '集成关系图' },
  { id: 'e7f5c0e6f1be', name: '发布说明生成' },
  { id: 'social-data', name: '社媒数据抓取' },
  { id: 'agent-creator', name: '智能体创建器' },
  { id: 'release-notes', name: '版本说明' },
  { id: 'kb-indexer', name: '知识库索引' },
];

const FINDINGS = [
  {
    ruleId: 'curl_pipe_shell', severity: 'critical', originalSeverity: 'critical', demoted: false,
    confidence: 'medium', category: 'unauthorized_download', file: 'scripts/bootstrap.sh', line: 14,
    description: 'shell 中「下载后管道给 shell 执行」：载荷不落盘，无法审计',
    remediation: '不要 curl|sh。改为固定版本 + 校验哈希后下载，再由用户确认安装。',
    hardBlock: false, context: 'source', cwe: ['CWE-494', 'CWE-78'], owaspLlm: ['LLM05', 'LLM06'],
    owaspAst: ['AST01', 'AST02'], references: [], fingerprint: 'a1b2', suppressed: false, derived: 'b64',
  },
  {
    ruleId: 'credential_path_read', severity: 'high', originalSeverity: 'critical', demoted: true,
    confidence: 'high', category: 'credential_access', file: 'SKILL.md', line: 51,
    description: '命中规则 credential_path_read（network_egress）',
    remediation: '不要读取用户凭据文件；改由用户显式提供所需的值。',
    hardBlock: false, context: 'doc', cwe: ['CWE-522'], owaspLlm: ['LLM02'],
    owaspAst: ['AST01'], references: [], fingerprint: 'b2c3', suppressed: false, derived: 'normalized',
  },
  {
    ruleId: 'agent_config_write', severity: 'high', originalSeverity: 'high', demoted: false,
    confidence: 'high', category: 'mcp_config', file: 'SKILL.md', line: 88,
    description: '写入宿主代理（Claude/Cursor/Codex 等）的配置目录',
    remediation: '不要改写宿主或其它 Agent 的 MCP/工具配置；连接器应由用户在应用界面里显式添加。',
    hardBlock: false, context: 'source', cwe: ['CWE-506'], owaspLlm: ['LLM03'],
    owaspAst: ['AST05'], references: [], fingerprint: 'c3d4', suppressed: false,
  },
  {
    ruleId: 'unpinned_runtime_install', severity: 'medium', originalSeverity: 'medium', demoted: false,
    confidence: 'medium', category: 'supply_chain', file: 'SKILL.md', line: 132,
    description: '运行时安装未固定版本：npx some-helper',
    remediation: '固定依赖版本（tag/commit/digest）并提交 lockfile。',
    hardBlock: false, context: 'source', cwe: ['CWE-1357'], owaspLlm: ['LLM03'],
    owaspAst: ['AST02'], references: [], fingerprint: 'd4e5', suppressed: false,
  },
  {
    ruleId: 'raw_ip_url', severity: 'low', originalSeverity: 'medium', demoted: true,
    confidence: 'high', category: 'network', file: 'scripts/fetch.py', line: 27,
    description: '命中规则 raw_ip_url（suspicious_addresses）',
    remediation: '核对每个外部地址是否必要；把域名写入 allowlist 并在 SKILL.md 声明。',
    hardBlock: false, context: 'comment', cwe: ['CWE-200'], owaspLlm: ['LLM02'],
    owaspAst: ['AST03'], references: [], fingerprint: 'f607', suppressed: false,
  },
];

const EVIDENCE = {
  outcome: 'restricted', scanTier: 'static', score: 62, scannedAt: ago(180),
  scannerVersion: '2.2.0', rulesetVersion: 'v1.1.0', recommendation: 'CAUTION',
  isolated: false, rulesDegraded: false, hardBlocked: false, confirmedCritical: false,
  // 与 FINDINGS 实际分布一致：1 critical / 2 high / 1 medium / 1 low
  severityCounts: { critical: 1, high: 2, medium: 1, low: 1, info: 0 },
  findings: FINDINGS,
};

const COMPOSITION = {
  paths: [
    { id: 'credential_exfil', severity: 'high', participants: ['e7f5c0e6f1be', 'release-notes'], capabilities: ['read_credentials', 'egress'] },
    { id: 'untrusted_to_exec', severity: 'medium', participants: ['integration-map', 'agent-creator'], capabilities: ['ingest_untrusted', 'execute'] },
  ],
  coverage: { analyzedSkills: 48, resolvableSkills: 66 },
};

const HEALTHY_STATUS = {
  ...STATUS,
  capabilities: STATUS.capabilities.map((c) => ({ id: c.id, status: 'implemented' })),
  externalTools: [
    { id: 'gitleaks', available: true },
    { id: 'osv-scanner', available: true },
  ],
};

// ── 场景 ─────────────────────────────────────────────────────────────────────
// state.openRow 为 null 时四行全收起——这是主屏应有的默认样子。
const SCENARIOS = {
  blocked: {
    label: '拦截态 · 全部收起',
    height: 1180,
    state: { status: STATUS, receipts: RECEIPTS, skills: SKILLS, openRow: null, pickerOpen: false },
  },
  ok: {
    label: '健康态 · 全部收起',
    height: 1180,
    state: {
      status: HEALTHY_STATUS,
      receipts: RECEIPTS.map((r) => ({ ...r, decision: 'pass', securityScore: 98, violationCount: 0 })),
      skills: SKILLS,
      openRow: null,
      pickerOpen: false,
    },
  },
  warn: {
    label: '降级态 · 全部收起',
    height: 1180,
    state: {
      status: { ...STATUS, scanner: 'absent_by_build', scannerIntegrity: 'unreadable', sentryEngineVersion: '', sentryRulesetVersion: '', rules: { total: 0, groups: [], hardBlock: 0 }, externalTools: [], interpreter: '' },
      receipts: RECEIPTS.slice(0, 3),
      skills: SKILLS,
      openRow: null,
      pickerOpen: false,
    },
  },
  'skills-open': {
    label: '展开「技能检查」',
    height: 1280,
    state: { status: STATUS, receipts: RECEIPTS, skills: SKILLS, openRow: 'skills' },
  },
  'coverage-open': {
    label: '展开「检测能力」',
    height: 1280,
    state: { status: STATUS, receipts: RECEIPTS, skills: SKILLS, openRow: 'coverage' },
  },
  'composition-open': {
    label: '展开「组合风险」',
    height: 1280,
    state: { status: STATUS, receipts: RECEIPTS, skills: SKILLS, composition: COMPOSITION, openRow: 'composition' },
  },
  picker: {
    label: '展开「检查指定技能…」',
    state: { status: STATUS, receipts: RECEIPTS, skills: SKILLS, openRow: null, pickerOpen: true },
  },
  drawer: {
    label: '技能详情抽屉',
    // 遮罩铺满视口，无法靠裁空白收边，所以这里直接给一个真实屏幕高度。
    tall: 1000,
    state: {
      status: STATUS, receipts: RECEIPTS, skills: SKILLS, openRow: null,
      drawer: { skillId: 'e7f5c0e6f1be', receipt: RECEIPTS[2], evidence: EVIDENCE, filter: 'all' },
    },
  },
};

// ── 生成 HTML ────────────────────────────────────────────────────────────────
function readLocale(name) {
  return JSON.parse(fs.readFileSync(path.join(RENDERER, 'locales', `${name}.json`), 'utf8'));
}

function buildHtml() {
  const zh = readLocale('zh');
  const en = readLocale('en');
  const links = STYLE_HREFS.map((f) => `<link rel="stylesheet" href="${rel(f)}">`).join('\n  ');
  const scripts = SCRIPT_SRCS.map((f) => `<script src="${rel(path.join(RENDERER, f))}"></script>`).join('\n  ');

  const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>安全与信任 v2 · 设计稿</title>
  ${links}
</head>
<body>
  <div class="sx2-page" id="sx2-root"></div>
  <script>
    window.__locale = ${JSON.stringify(zh)};
    window.__localeFallback = ${JSON.stringify(en)};
    window.t = function (key, args) {
      var raw = window.__locale[key];
      if (raw == null) raw = window.__localeFallback[key];
      if (raw == null) return key;
      if (args) Object.keys(args).forEach(function (k) {
        raw = String(raw).split('{' + k + '}').join(String(args[k]));
      });
      return raw;
    };
    window.__scenarios = ${JSON.stringify(SCENARIOS)};
  </script>
  ${scripts}
  <script src="draft.js"></script>
  <script>
    (function () {
      var name = new URLSearchParams(location.search).get('s') || 'blocked';
      var sc = window.__scenarios[name] || window.__scenarios.blocked;
      var state = Object.assign({
        status: null, receipts: [], skills: [], checking: [],
        filter: 'all', coverageExpanded: false, composition: null,
        compositionLoading: false, drawer: null, openRow: null,
        pickerOpen: false, pickerQuery: ''
      }, sc.state);
      document.getElementById('sx2-root').innerHTML = window.__sx2.pageHtml(state);

      if (state.drawer) {
        window.uiDrawer({
          title: t('settings.security.drawer_title', { skill: state.drawer.skillId }),
          bodyHtml: window.__sx2.drawerBodyHtml(state),
          closeLabel: t('common.close')
        });
      }
      // 供 --dump-dom 读回真实高度，用于精确定高截图（避免大片留白或被裁切）。
      document.title = 'H=' + Math.ceil(document.documentElement.scrollHeight);
    })();
  </script>
</body></html>`;

  const file = path.join(HERE, 'preview.html');
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

// ── Chrome 调用 ──────────────────────────────────────────────────────────────
// 重要：本环境下 Chrome 写出截图后**不会自行退出**（进程一直挂着）。
// 因此不能等 close 事件——改为轮询产物文件出现且大小稳定，然后主动杀掉进程。
// 这也是本脚本不使用 Electron 的原因：headless Chrome 全程没有窗口。

function spawnChrome(args) {
  return spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

async function screenshot(url, width, outFile, timeoutMs = 40_000, tall = TALL) {
  fs.rmSync(outFile, { force: true });
  const child = spawnChrome([
    ...BASE_FLAGS,
    '--virtual-time-budget=1200',
    `--window-size=${width},${tall}`,
    `--screenshot=${outFile}`,
    url,
  ]);
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });

  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  let stable = 0;

  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      if (!fs.existsSync(outFile)) continue;
      const size = fs.statSync(outFile).size;
      if (size > 2000 && size === lastSize) {
        stable += 1;
        if (stable >= 2) return;          // 连续两次大小不变 => 写完了
      } else {
        stable = 0;
      }
      lastSize = size;
    }
    throw new Error(`screenshot not produced within ${timeoutMs}ms: ${path.basename(outFile)}\n${stderr.slice(-300)}`);
  } finally {
    child.kill('SIGKILL');
  }
}

const BASE_FLAGS = [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-features=Translate,OptimizationHints',
  '--hide-scrollbars',
  `--user-data-dir=${PROFILE}`,
];

const TALL = 2000;   // 渲染窗口一律给足高度，底部空白由 trim.py 按底色裁掉。
const WIDE = 1180;
const NARROW = 760;

async function shoot(url, width, outFile, tall = TALL) {
  await screenshot(url, width, outFile, 40_000, tall);
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
const only = process.env.SCENARIOS ? process.env.SCENARIOS.split(',').map((s) => s.trim()) : null;

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);
  const raw = path.join(OUT, 'raw');
  fs.mkdirSync(raw, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });

  const htmlFile = buildHtml();
  const baseUrl = `file://${htmlFile}`;
  console.log(`built ${path.relative(REPO, htmlFile)}`);

  const names = Object.keys(SCENARIOS).filter((n) => !only || only.includes(n));
  for (const name of names) {
    const url = `${baseUrl}?s=${encodeURIComponent(name)}`;
    const outFile = path.join(raw, `${name}.png`);
    await shoot(url, WIDE, outFile, SCENARIOS[name].tall || TALL);
    console.log(`raw  ${name.padEnd(18)} ${WIDE}x${SCENARIOS[name].tall || TALL}  — ${SCENARIOS[name].label}`);
  }

  const narrow = ['blocked', 'skills-open', 'coverage-open'].filter((n) => !only || only.includes(n));
  for (const name of narrow) {
    const url = `${baseUrl}?s=${encodeURIComponent(name)}`;
    await shoot(url, NARROW, path.join(raw, `narrow-${name}.png`));
    console.log(`raw  ${('narrow-' + name).padEnd(18)} ${NARROW}x${TALL}`);
  }

  fs.rmSync(PROFILE, { recursive: true, force: true });
  console.log(`\n${names.length + narrow.length} raw shots in ${path.relative(REPO, raw)}`);
  console.log('next: python3 design/security-redesign/v2/trim.py');
}

main().catch((e) => {
  console.error('BUILD FAILED', e.message);
  process.exit(1);
});
