// ─────────────────────────────────────────────────────────────────────────────
// 安全与信任 · 重构设计稿截图工装（experiment）
// ─────────────────────────────────────────────────────────────────────────────
// 与 test/renderer/fixtures/security-page-shots.cjs 同一思路：在真实 Chromium 里
// 加载**真实的** tokens.css / ui-components.css 与**真实的**共享组件脚本，
// 再叠加设计稿自己的 draft.css / draft.js，然后截图。
//
// 与生产预览工装的区别：这里不加载 src/renderer/modules/settings-security.js
// 与 style.css，所以截出来的**只有重构后的结构**，不会混入生产页面的样式。
//
//   node_modules/.bin/electron design/security-redesign/render-shots.cjs
//   SHOT_WIDTH=760 node_modules/.bin/electron ...   # 只跑指定宽度
// ─────────────────────────────────────────────────────────────────────────────
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// 本工装只做离屏截图，不需要 Chromium 的进程沙箱与 GPU。
// 在嵌套沙箱环境（CI / agent 容器 / 受限 shell）里，这两者会直接让渲染进程
// 初始化失败并 SIGTRAP。必须在 app ready 之前设置。
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.disableHardwareAcceleration();

const REPO = path.resolve(__dirname, '../..');
const RENDERER = path.join(REPO, 'src/renderer');
const LOCALES = path.join(RENDERER, 'locales');
const OUT = path.join(__dirname, 'shots');

// 真实共享样式：token + 共享组件。刻意不含 style.css（生产页面自有样式）。
const STYLES = [
  path.join(RENDERER, 'tokens.css'),
  path.join(RENDERER, 'ui-components.css'),
  path.join(__dirname, 'draft.css'),
];

// 与 index.html 相同的依赖顺序；uiDrawer 依赖 uiModalController。
const SCRIPTS = [
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

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

// ── 夹具：与生产预览同一场景，便于前后对比 ──────────────────────────────────
const STATUS = {
  scanner: 'present',
  scannerIntegrity: 'verified',
  sentryEngineVersion: '2.2.0',
  sentryRulesetVersion: 'v1.1.0',
  declarationEngineVersion: '1.1.1',
  declarationIntegrity: 'verified',
  rules: {
    total: 181, hardBlock: 2, versioned: true,
    groups: ['credential_expansion', 'dangerous_commands', 'dynamic_execution', 'network_egress'],
  },
  interpreter: 'python3',
  externalTools: [
    { id: 'gitleaks', available: false },
    { id: 'osv-scanner', available: false },
  ],
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
    owaspAgentic: ['ASI05'], owaspAst: ['AST01', 'AST02'],
    references: ['https://cwe.mitre.org/data/definitions/494.html'],
    fingerprint: 'a1b2c3d4e5f60718293a', suppressed: false, derived: 'b64',
  },
  {
    ruleId: 'credential_path_read', severity: 'high', originalSeverity: 'critical', demoted: true,
    confidence: 'high', category: 'credential_access', file: 'SKILL.md', line: 51,
    description: '命中规则 credential_path_read（network_egress）',
    remediation: '不要读取用户凭据文件；改由用户显式提供所需的值。',
    hardBlock: false, context: 'doc', cwe: ['CWE-522', 'CWE-359'], owaspLlm: ['LLM02'],
    owaspAgentic: ['ASI03'], owaspAst: ['AST01', 'AST03'],
    references: ['https://cwe.mitre.org/data/definitions/522.html'],
    fingerprint: 'b2c3d4e5f60718293a4b', suppressed: false, derived: 'normalized',
  },
  {
    ruleId: 'agent_config_write', severity: 'high', originalSeverity: 'high', demoted: false,
    confidence: 'high', category: 'mcp_config', file: 'SKILL.md', line: 88,
    description: '写入宿主代理（Claude/Cursor/Codex 等）的配置目录',
    remediation: '不要改写宿主或其它 Agent 的 MCP/工具配置；连接器应由用户在应用界面里显式添加。',
    hardBlock: false, context: 'source', cwe: ['CWE-506', 'CWE-1357'], owaspLlm: ['LLM03', 'LLM06'],
    owaspAgentic: ['ASI02', 'ASI04'], owaspAst: ['AST05', 'AST09'],
    references: [], fingerprint: 'c3d4e5f60718293a4b5c', suppressed: false,
  },
  {
    ruleId: 'unpinned_runtime_install', severity: 'medium', originalSeverity: 'medium', demoted: false,
    confidence: 'medium', category: 'supply_chain', file: 'SKILL.md', line: 132,
    description: '运行时安装未固定版本：npx some-helper',
    remediation: '固定依赖版本（tag/commit/digest）并提交 lockfile。',
    hardBlock: false, context: 'source', cwe: ['CWE-1357', 'CWE-1104'], owaspLlm: ['LLM03'],
    owaspAgentic: ['ASI04'], owaspAst: ['AST02'], references: [],
    fingerprint: 'd4e5f60718293a4b5c6d', suppressed: false,
  },
  {
    ruleId: 'typosquat_suspected', severity: 'medium', originalSeverity: 'medium', demoted: false,
    confidence: 'low', category: 'typosquat', file: 'package.json', line: 9,
    description: '依赖名 reqeusts 与流行包 requests 高度相似：可能是拼写伪装',
    remediation: '核对该依赖是否为官方包名；确需使用则固定到具体版本与哈希。',
    hardBlock: false, context: 'source', cwe: ['CWE-1357'], owaspLlm: ['LLM03'],
    owaspAgentic: ['ASI04'], owaspAst: ['AST02'], references: [],
    fingerprint: 'e5f60718293a4b5c6d7e', suppressed: false,
  },
  {
    ruleId: 'raw_ip_url', severity: 'low', originalSeverity: 'medium', demoted: true,
    confidence: 'high', category: 'network', file: 'scripts/fetch.py', line: 27,
    description: '命中规则 raw_ip_url（suspicious_addresses）',
    remediation: '核对每个外部地址是否必要；把域名写入 allowlist 并在 SKILL.md 声明。',
    hardBlock: false, context: 'comment', cwe: ['CWE-200'], owaspLlm: ['LLM02'],
    owaspAgentic: ['ASI02'], owaspAst: ['AST03'], references: [],
    fingerprint: 'f60718293a4b5c6d7e8f', suppressed: false,
  },
];

const EVIDENCE = {
  outcome: 'restricted', scanTier: 'static', score: 62, scannedAt: ago(180),
  scannerVersion: '2.2.0', rulesetVersion: 'v1.1.0', recommendation: 'CAUTION',
  isolated: false, rulesDegraded: false, hardBlocked: false, confirmedCritical: false,
  // 计数必须与上面的 FINDINGS 实际分布一致（1 critical / 2 high / 2 medium / 1 low），
  // 否则分段控件的数字会与列表对不上，评审时会被误当成设计缺陷。
  severityCounts: { critical: 1, high: 2, medium: 2, low: 1, info: 0 },
  findings: FINDINGS,
  scoreBreakdown: {
    rawPenalty: 78.4, penalty: 78.4,
    byCategory: [
      { category: 'unauthorized_download', count: 1, penalty: 24, capped: false },
      { category: 'mcp_config', count: 1, penalty: 20, capped: false },
      { category: 'credential_access', count: 1, penalty: 20, capped: false },
      { category: 'supply_chain', count: 1, penalty: 4.8, capped: false },
      { category: 'typosquat', count: 1, penalty: 3, capped: false },
    ],
    floors: [],
  },
  coverage: {
    filesScanned: 9, bytesScanned: 84_512, ruleCount: 181, hardBlockRules: 2,
    ruleGroups: ['credential_expansion', 'dangerous_commands'], rulesetResolved: true,
    rulesetVersion: 'v1.1.0', invalidRules: [], derivedViews: { b64_1: 1, normalized: 2 },
    derivedFindings: 3, scanTier: 'static',
    externalTools: { gitleaks: 'SKIPPED', osv_scanner: 'SKIPPED' },
  },
  frameworkSummary: {
    owaspLlm: [
      { id: 'LLM02', title: '敏感信息泄露', count: 3 },
      { id: 'LLM03', title: '供应链', count: 3 },
      { id: 'LLM05', title: '不当输出处理', count: 1 },
      { id: 'LLM06', title: '过度代理', count: 2 },
    ],
    owaspAgentic: [],
    owaspAst: [
      { id: 'AST01', title: '恶意技能', count: 2 },
      { id: 'AST02', title: '供应链投毒', count: 3 },
      { id: 'AST03', title: '过度授权', count: 2 },
    ],
  },
  structuralSummary: { fileCount: 12, totalBytes: 84_512, executableCount: 2, archiveCount: 0, topExtensions: [{ ext: '.py', count: 5 }] },
  dependencyManifests: { npm_dependencies: ['lodash@^4.17.21', 'reqeusts@1.0.0'], runtime_packages: ['some-helper'] },
  limitations: [
    '文本检测以正则/关键词为主，存在误报与漏报，分数为启发式而非绝对度量',
    '二进制扫描当前仅静态层（strings+指标），未接入动态沙箱，无法确认真实运行时行为',
    '依赖漏洞(CVE)、密钥扫描依赖外部工具（osv-scanner/gitleaks），未安装时能力降级',
  ],
};

const COMPOSITION_PATHS = {
  skills: [],
  paths: [
    { id: 'credential_exfil', severity: 'high', participants: ['e7f5c0e6f1be', 'release-notes'], capabilities: ['read_credentials', 'egress'] },
    { id: 'untrusted_to_exec', severity: 'medium', participants: ['integration-map', 'agent-creator'], capabilities: ['ingest_untrusted', 'execute'] },
  ],
  coverage: { analyzedSkills: 48, resolvableSkills: 66, unresolvedSkills: 32, budgetLimited: true },
};

function readLocale(locale) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES, `${locale}.json`), 'utf8'));
}

const I18N_STUB = `
  window.__locale = window.__locale || {};
  window.t = function (key, args) {
    var raw = window.__locale[key];
    if (raw == null) raw = window.__localeFallback[key];
    if (raw == null) return key;
    if (args) {
      Object.keys(args).forEach(function (k) {
        raw = String(raw).split('{' + k + '}').join(String(args[k]));
      });
    }
    return raw;
  };
`;

/**
 * 页面侧胶水。**必须**在页面上下文里定义 state 与 render，
 * 不能在 Node 侧定义后把函数序列化进去——那样函数体里的 `state`
 * 在页面里是未定义的，会直接抛 ReferenceError。
 */
const PAGE_GLUE = `
  window.__sx = {
    state: {
      status: null, receipts: [], skills: [],
      filter: 'all', expanded: false, checking: [],
      coverageExpanded: false, composition: null,
      compositionLoading: false, drawer: null
    },
    render: function () {
      document.getElementById('sx-root').innerHTML =
        window.__sxDraft.pageHtml(window.__sx.state);
    },
    scroll: function (y) { window.scrollTo(0, y); },
    scrollBottom: function () { window.scrollTo(0, document.body.scrollHeight); }
  };
`;

function pageHtml(zh, en) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"></head>
<body>
  <div class="sx-page" id="sx-root"></div>
  <script>
    window.__locale = ${JSON.stringify(zh)};
    window.__localeFallback = ${JSON.stringify(en)};
    ${I18N_STUB}
  </script>
</body></html>`;
}

/**
 * 页面 HTML 会内联完整 locale（zh + en，合计约 1.8MB），远超 data: URL 的可靠
 * 长度——用 data URL 会在第二次导航时 ERR_FAILED。改为落到临时文件再 loadFile。
 */
function writePageFile(zh, en) {
  const file = path.join(OUT, '_draft-page.html');
  fs.writeFileSync(file, pageHtml(zh, en), 'utf8');
  return file;
}

async function shoot(win, name, opts = {}) {
  await new Promise((r) => setTimeout(r, opts.settle || 320));
  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  if (png.length < 5000) throw new Error(`suspiciously small capture for ${name}: ${png.length} bytes`);
  fs.writeFileSync(path.join(OUT, `${name}.png`), png);
  const size = image.getSize();
  console.log(`shot ${name}: ${size.width}x${size.height} ${png.length} bytes`);
}

/**
 * 注入脚本并丢弃其求值结果。
 *
 * `executeJavaScript` 会把脚本最后一条语句的**求值结果**结构化克隆回主进程。
 * 若该语句是 `window.x = {...}` 且对象里含函数（控制器、render 等），克隆会抛
 * "An object could not be cloned"。因此统一追加一个可克隆的尾值。
 */
const js = (win, code) => win.webContents.executeJavaScript(`${code}\n;0;`, true);

/** 需要读取返回值时用它；调用方必须保证最后一条语句可克隆。 */
const jsValue = (win, code) => win.webContents.executeJavaScript(code, true);

/**
 * 在**同一个**窗口里装载一次页面环境。
 *
 * 不复用两个 BrowserWindow：在本工装的离屏/无 GPU 环境下，销毁首窗后再建第二窗
 * 会让导航直接 ERR_FAILED。改用「一窗 + setSize 后 reload」跑两个宽度。
 */
async function loadEnvironment(win, zh, en) {
  await win.loadFile(writePageFile(zh, en));
  for (const file of STYLES) {
    await win.webContents.insertCSS(fs.readFileSync(file, 'utf8'));
  }
  for (const file of SCRIPTS) {
    await js(win, fs.readFileSync(path.join(RENDERER, file), 'utf8'));
  }
  await js(win, fs.readFileSync(path.join(__dirname, 'draft.js'), 'utf8'));
  if (!(await jsValue(win, 'typeof window.__sxDraft === "object"'))) {
    throw new Error('draft.js did not register window.__sxDraft');
  }
  await js(win, PAGE_GLUE);
}

async function scenarios(win, suffix) {
  // 场景 A：健康扫描器 + 混合回执 + 组合风险「尚未分析」
  await js(win, `
    window.__sx.state.status = ${JSON.stringify(STATUS)};
    window.__sx.state.receipts = ${JSON.stringify(RECEIPTS)};
    window.__sx.state.skills = ${JSON.stringify(SKILLS)};
    window.__sx.render();
    true;
  `);
  await shoot(win, `01-verdict-${suffix}`);

  // 场景 B：能力覆盖展开（与折叠态对比注意力分配）
  await js(win, 'window.__sx.state.coverageExpanded = true; window.__sx.render(); window.__sx.scroll(220); true');
  await shoot(win, `02-coverage-expanded-${suffix}`);

  // 场景 C：组合风险发现路径
  await js(win, `
    window.__sx.state.coverageExpanded = false;
    window.__sx.state.composition = ${JSON.stringify(COMPOSITION_PATHS)};
    window.__sx.render();
    window.__sx.scroll(0);
    true;
  `);
  await shoot(win, `03-top-composition-${suffix}`);
  await js(win, 'window.__sx.scrollBottom(); true');
  await shoot(win, `04-records-${suffix}`);

  // 场景 D：详情抽屉
  await js(win, `
    window.__sx.state.drawer = {
      skillId: 'e7f5c0e6f1be',
      evidence: ${JSON.stringify(EVIDENCE)},
      acceptances: [], filter: 'all'
    };
    window.__sxDrawer = window.uiDrawer({
      title: t('settings.security.drawer_title', { skill: 'e7f5c0e6f1be' }),
      bodyHtml: window.__sxDraft.drawerBodyHtml(window.__sx.state),
      closeLabel: t('common.close')
    });
    true;
  `);
  await shoot(win, `05-drawer-${suffix}`, { settle: 700 });

  await js(win, `
    var b = document.querySelector('.ui-drawer__body');
    if (b) b.scrollTop = b.scrollHeight * 0.74;
    true;
  `);
  await shoot(win, `06-drawer-score-${suffix}`);

  // 场景 E：无扫描器的开源构建（capabilities 为空 → 覆盖区块整体不渲染）
  await js(win, `
    if (window.__sxDrawer) window.__sxDrawer.close('scenario');
    window.__sx.state.status = Object.assign({}, ${JSON.stringify(STATUS)}, {
      scanner: 'absent_by_build', scannerIntegrity: 'unreadable',
      sentryEngineVersion: '', sentryRulesetVersion: '',
      rules: { total: 0, groups: [], hardBlock: 0, versioned: false },
      capabilities: [], externalTools: [], interpreter: ''
    });
    window.__sx.state.receipts = ${JSON.stringify(RECEIPTS.slice(0, 3))};
    window.__sx.state.composition = null;
    window.__sx.render();
    window.__sx.scroll(0);
    true;
  `);
  await shoot(win, `07-scanner-absent-${suffix}`);
}

/**
 * 生成可在浏览器直接打开的交互预览。
 *
 * 与截图同一套真实资源，只是用相对路径引用（classic script / link 在 file:// 下
 * 不受 CORS 限制），并把 locale 与夹具内联，因此无需起服务器。
 * 工具栏按钮也走共享 uiButton，避免在设计稿里引入裸控件。
 */
function writePreview(zh, en) {
  const rel = (p) => path.relative(__dirname, p).split(path.sep).join('/');
  const links = STYLES.map((f) => `<link rel="stylesheet" href="${rel(f)}">`).join('\n  ');
  const scripts = SCRIPTS
    .map((f) => `<script src="${rel(path.join(RENDERER, f))}"></script>`).join('\n  ');

  const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>安全与信任 · 重构设计稿（experiment）</title>
  ${links}
</head>
<body>
  <div class="sx-reviewbar">
    <div class="sx-reviewbar__label">设计稿预览 · 非生产</div>
    <div class="sx-reviewbar__actions" id="sx-scenarios"></div>
  </div>
  <div class="sx-page" id="sx-root"></div>

  <script>
    window.__locale = ${JSON.stringify(zh)};
    window.__localeFallback = ${JSON.stringify(en)};
    ${I18N_STUB}
    window.__fixture = {
      STATUS: ${JSON.stringify(STATUS)},
      RECEIPTS: ${JSON.stringify(RECEIPTS)},
      SKILLS: ${JSON.stringify(SKILLS)},
      EVIDENCE: ${JSON.stringify(EVIDENCE)},
      COMPOSITION: ${JSON.stringify(COMPOSITION_PATHS)}
    };
  </script>
  ${scripts}
  <script src="draft.js"></script>
  <script>
    (function () {
      var F = window.__fixture;
      var state = {
        status: null, receipts: [], skills: [],
        filter: 'all', expanded: false, checking: [],
        coverageExpanded: false, composition: null,
        compositionLoading: false, drawer: null
      };
      var drawerCtl = null;

      function closeDrawer() {
        if (drawerCtl) { drawerCtl.close('scenario'); drawerCtl = null; }
      }
      function render() {
        document.getElementById('sx-root').innerHTML = window.__sxDraft.pageHtml(state);
      }

      var SCENARIOS = {
        '拦截态 · 默认': function () {
          closeDrawer();
          state.status = F.STATUS; state.receipts = F.RECEIPTS; state.skills = F.SKILLS;
          state.coverageExpanded = false; state.composition = null; state.filter = 'all';
          render(); window.scrollTo(0, 0);
        },
        '能力覆盖 · 全部展开': function () {
          closeDrawer();
          state.coverageExpanded = true; render();
        },
        '组合风险 · 发现路径': function () {
          closeDrawer();
          state.coverageExpanded = false; state.composition = F.COMPOSITION; render();
          window.scrollTo(0, 0);
        },
        '无扫描器构建': function () {
          closeDrawer();
          state.status = Object.assign({}, F.STATUS, {
            scanner: 'absent_by_build', scannerIntegrity: 'unreadable',
            sentryEngineVersion: '', sentryRulesetVersion: '',
            rules: { total: 0, groups: [], hardBlock: 0, versioned: false },
            capabilities: [], externalTools: [], interpreter: ''
          });
          state.receipts = F.RECEIPTS.slice(0, 3);
          state.composition = null;
          render(); window.scrollTo(0, 0);
        },
        '打开详情抽屉': function () {
          closeDrawer();
          state.drawer = {
            skillId: 'e7f5c0e6f1be', evidence: F.EVIDENCE,
            acceptances: [], filter: 'all'
          };
          drawerCtl = window.uiDrawer({
            title: t('settings.security.drawer_title', { skill: 'e7f5c0e6f1be' }),
            bodyHtml: window.__sxDraft.drawerBodyHtml(state),
            closeLabel: t('common.close'),
            onClose: function () { drawerCtl = null; }
          });
        }
      };

      var host = document.getElementById('sx-scenarios');
      Object.keys(SCENARIOS).forEach(function (name) {
        host.insertAdjacentHTML('beforeend', window.uiButton({
          label: name, role: 'ghost', size: 'sm',
          attrs: { 'data-scenario': name }
        }));
      });
      host.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-scenario]');
        if (btn) SCENARIOS[btn.dataset.scenario]();
      });

      SCENARIOS['拦截态 · 默认']();
      window.__preview = { SCENARIOS: SCENARIOS, state: state };
    })();
  </script>
</body></html>`;

  const file = path.join(__dirname, 'preview.html');
  fs.writeFileSync(file, html, 'utf8');
  console.log(`wrote ${path.relative(REPO, file)} (${(html.length / 1024).toFixed(0)} KB)`);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const en = readLocale('en');
  const zh = readLocale('zh');
  const baseWidth = Number(process.env.SHOT_WIDTH || 1180);

  const win = new BrowserWindow({
    show: true, x: -4000, y: 0,
    width: baseWidth, height: 1400,
    webPreferences: { sandbox: true, contextIsolation: false, nodeIntegration: false },
  });

  await loadEnvironment(win, zh, en);
  await scenarios(win, 'desktop');

  if (!process.env.SHOT_WIDTH) {
    win.setSize(760, 1400);
    await new Promise((r) => setTimeout(r, 250));
    await loadEnvironment(win, zh, en);
    await scenarios(win, 'narrow');
  }

  win.destroy();
  writePreview(zh, en);
  fs.rmSync(path.join(OUT, '_draft-page.html'), { force: true });
  app.quit();
}).catch((err) => {
  console.error('SHOT FAILED', err);
  app.exit(1);
});
