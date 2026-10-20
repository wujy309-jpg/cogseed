#!/usr/bin/env node
/* S4 原型 v0.4 交互检查（假 DOM，见 harness.cjs）。
   用法（仓库根目录）：node specs/009-agent-skill-pages/prototype/check/flow.cjs
   覆盖 2026-10-18 会议 #2 结论：智能体页三类、「使用」一步完成、「我的」只放自建 + 贡献、
   「已安装的…」（原「管理」）只列从平台安装的（技能另有本地）、按钮「安装」→「使用」（详情里点示例 = 安装后直接发送）、搜索框带图标且与按钮等高、不展示「N 万人在用」，以及加载 / 断网 / 获取失败 / 创建 / 各直达链接。 */
'use strict';
const path = require('node:path');
const { createEnv } = require('./harness.cjs');

const dir = path.resolve(__dirname, '..');
const out = [];
const check = (n, ok, x = '') => { out.push([n, !!ok]); console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x); };

(async () => {
  let E = createEnv(dir);
  const card = (id) => E.doc.querySelector(`[data-id="${id}"]`);
  const act = (scope, a, arg) => scope && E.all(scope, (n) => n.attrs['data-act'] === a && (arg === undefined || n.attrs['data-arg'] === arg))[0];
  const modalText = () => (E.modal() ? E.modal().textContent.replace(/\s+/g, ' ') : '');
  const toastText = () => E.doc.querySelector('#toast').textContent;
  const foot = () => E.modal().querySelector('.ui-modal__footer');
  const heads = () => E.all(E.doc.body, (n) => /(agents|skills)-source-section-head/.test(n.className)).map((n) => n.textContent.replace(/\s+/g, ' ').trim());
  const isDisabled = (n) => !!n && 'disabled' in n.attrs;
  const hasClass = (n, c) => n.className.split(/\s+/).includes(c);
  const platformIds = () => E.all(E.doc.querySelector('[data-group="平台"]'), (n) => hasClass(n, 'marketplace-card') && n.attrs['data-id']).map((n) => n.attrs['data-id']);
  await E.sleep(900);

  /* A 智能体首页：主智能体 / 外接智能体 / 平台 */
  check('首页无报错', E.errors.length === 0, E.errors.join('|'));
  check('首页分三组，顺序为 主智能体 · 1 / 外接智能体 · 1 / 平台 · 8', JSON.stringify(heads()) === JSON.stringify(['主智能体 · 1', '外接智能体 · 1', '平台 · 8']), JSON.stringify(heads()));
  check('平台组里内置、默认安装、Hub 分发合在一起，且不标来源', ['b-compliance', 'pre-meeting-minutes', 'hub-resume-site', 'hub-weekly-agent'].every((i) => card(i) && hasClass(card(i), 'marketplace-card'))
    && !/客户端内置|平台预置|平台分发|已安装/.test(E.doc.querySelector('#ap-grid').textContent));
  const order = platformIds();
  check('平台排序：安装过的在最前，还没安装的在最后', order[0] === 'hub-weekly-agent' && order.slice(-4).every((i) => i.startsWith('hub-')), order.join(','));
  check('首页没有自建内容', !card('c-analyst') && !card('c-ops'));
  check('不展示"N 万人在用"', !/人在用/.test(E.text()));
  check('首页工具栏只有 我的智能体 · 2 / 已安装的智能体 · 4（含迁移来的原随包内容）；"+ 创建"和"我的贡献"都只在我的智能体里', !E.btnByText('管理')[0] && ['我的智能体·2', '已安装的智能体·4'].every((l) => !!E.btnByText(l)[0]) && !E.btnByText('我的贡献')[0] && !E.btnByText('+创建')[0]);
  const toolbar = E.doc.querySelector('.agents-resource-toolbar-controls');
  check('工具栏：搜索框带真实搜索图标；右侧按钮与搜索框同为默认高度（不是 sm）', !!E.doc.querySelector('.agents-search-field .agents-search-icon') && E.all(toolbar, (n) => n.nodeName === 'button').every((n) => !hasClass(n, 'ui-button--sm')));
  check('没装过的 4 张平台卡片按钮是"安装"，本机已有的是"使用"', ['hub-contract-review', 'hub-resume-site', 'hub-expense', 'hub-code-review'].every((i) => !!E.btnByText('安装', card(i))[0] && !E.btnByText('使用', card(i))[0])
    && ['hub-weekly-agent', 'b-compliance', 'pre-meeting-minutes', 'm-cogseed', 'x-codex'].every((i) => !!E.btnByText('使用', card(i))[0]));

  /* B 详情弹窗 */
  E.click(card('hub-weekly-agent').querySelector('.marketplace-card-name')); await E.sleep(30);
  check('点卡片→详情弹窗：lg、图标在标题栏最前、说明行"通用 · 平台 · v1.0.4 · 可更新到 v1.1.0"、3 个示例', !!E.modal() && !!E.modal().querySelector('.ui-modal--lg') && E.modal().querySelector('.ui-modal__header').childNodes[0].className.includes('ap-popup-icon')
    && E.modal().querySelector('.ui-modal__description').textContent === '通用 · 平台 · v1.0.4 · 可更新到 v1.1.0' && E.modal().querySelectorAll('.ap-popup-example').length === 3);
  check('已安装的平台内容：底部"使用智能体" + 停用 + 卸载，技能 chip "已就绪"', !!E.btnByText('使用智能体', foot())[0] && !!E.btnByText('停用', foot())[0] && !!E.btnByText('卸载', foot())[0] && modalText().includes('已就绪'));
  E.click(act(E.modal(), 'send', 'hub-weekly-agent|0')); await E.sleep(30);
  check('点示例→关闭弹窗并在新任务中发送', !E.modal() && toastText().startsWith('已在新任务中发送'));

  /* C 安装 → 使用；详情里点示例 = 安装后直接发送 */
  E.click(act(card('hub-resume-site'), 'install')); await E.sleep(300);
  check('点"安装"→按钮"安装中…"，不能重复点', E.btnByText('安装中…', card('hub-resume-site')).length === 1 && !act(card('hub-resume-site'), 'install'));
  await E.sleep(1100);
  check('安装完成→留在原处并提示，不自动进入任务', toastText().includes('已安装「简历与个人主页生成器」') && !toastText().includes('进入新任务'));
  check('安装后按钮变"使用"，工具栏"已安装的智能体 · 5"', !!E.btnByText('使用', card('hub-resume-site'))[0] && !E.btnByText('安装', card('hub-resume-site'))[0] && !!E.btnByText('已安装的智能体·5')[0]);
  check('安装后排到未安装的前面', platformIds().indexOf('hub-resume-site') < platformIds().indexOf('hub-contract-review'), platformIds().join(','));
  E.click(act(card('hub-resume-site'), 'use')); await E.sleep(30);
  check('再点"使用"→进入新任务', toastText().includes('已选中「简历与个人主页生成器」'));
  E.click(card('hub-expense').querySelector('.marketplace-card-name')); await E.sleep(30);
  check('未安装详情：说明行没有来源字样，底部"安装智能体"，提示"点示例会先安装，再发送"，技能 chip "随智能体一起安装"，没有卸载/停用', E.modal().querySelector('.ui-modal__description').textContent === '业务 · 平台 · v0.9.1'
    && !!E.btnByText('安装智能体', foot())[0] && modalText().includes('点示例会先安装，再发送') && modalText().includes('随智能体一起安装') && !E.btnByText('卸载', foot())[0] && !E.btnByText('停用', foot())[0]);
  check('未安装时示例不置灰', E.all(E.modal(), (n) => n.className.includes('ap-popup-example') && isDisabled(n)).length === 0);
  E.click(act(E.modal(), 'send', 'hub-expense|0')); await E.sleep(300);
  check('未安装时点示例→弹窗里转圈"安装中…"', !!E.modal() && E.btnByText('安装中…', foot()).length === 1);
  await E.sleep(1100);
  check('安装完成→直接发送该示例（一步）', !E.modal() && toastText().includes('已安装「报销助手」') && toastText().includes('已在新任务中发送'));

  /* D 平台内容的停用 / 启用（内置在详情里停用，不进管理） */
  check('已停用的"项目材料审阅"：卡片标"已停用"、"使用"不可点', card('pre-project-review').textContent.includes('已停用') && isDisabled(E.btnByText('使用', card('pre-project-review'))[0]));
  E.click(card('pre-project-review').querySelector('.marketplace-card-name')); await E.sleep(30);
  check('停用的仍能点开详情，示例置灰，底部有"启用"和"卸载"（原随包内容迁移后也能卸载）', !!E.modal() && modalText().includes('已停用') && !!E.btnByText('启用', foot())[0] && !!E.btnByText('卸载', foot())[0]
    && E.all(E.modal(), (n) => n.className.includes('ap-popup-example') && isDisabled(n)).length === 1);
  E.click(E.btnByText('启用', foot())[0]); await E.sleep(30);
  check('点"启用"→恢复可用', !isDisabled(E.btnByText('使用智能体', foot())[0]) && toastText().includes('已启用'));
  E.click(E.modal().querySelector('[data-ui-modal-close]')); await E.sleep(30);
  check('点关闭按钮→弹窗消失', !E.modal());
  E.click(act(card('m-cogseed'), 'use')); await E.sleep(30);
  check('主智能体 cogseed：点"使用"直接进入新任务', toastText().includes('已选中「cogseed」'));
  E.click(act(card('x-codex'), 'detail')); await E.sleep(30);
  check('外接智能体详情：说明行"产研 · 外接智能体"，有管理和停用', E.modal().querySelector('.ui-modal__description').textContent === '产研 · 外接智能体' && !!E.btnByText('管理', foot())[0] && !!E.btnByText('停用', foot())[0]);
  E.click(E.modal().querySelector('[data-ui-modal-close]')); await E.sleep(30);

  /* E 已安装的智能体（原「管理」）：只列从平台安装的 */
  E.click(act(E.doc.body, 'to-manage')); await E.sleep(30);
  const rows = () => E.all(E.doc.body, (n) => hasClass(n, 'ap-manage-row')).map((n) => n.attrs['data-id']);
  check('页面标题"已安装的智能体"，分组"从平台安装的 · 6"', E.all(E.doc.querySelector('.hubc-backline'), (n) => n.nodeName === 'span').map((n) => n.textContent).includes('已安装的智能体') && E.text().includes('从平台安装的 · 6'));
  check('列出 6 个：迁移来的 3 个 + 用户装的 3 个；没有自建 / 外接 / 主智能体', JSON.stringify(rows().sort()) === JSON.stringify(['b-compliance', 'hub-expense', 'hub-resume-site', 'hub-weekly-agent', 'pre-meeting-minutes', 'pre-project-review']), rows().join(','));
  check('已安装页头"已启用 6 / 共 6"，每行有卸载和开关', E.text().includes('已启用 6 / 共 6') && rows().every((i) => !!act(card(i), 'uninstall', i) && !!E.all(card(i), (n) => n.attrs.role === 'switch')[0]));
  E.click(E.all(card('hub-expense'), (n) => n.attrs.role === 'switch')[0]); await E.sleep(30);
  check('关掉开关→已启用 5 / 共 6', E.text().includes('已启用 5 / 共 6') && toastText().includes('已停用'));
  E.click(act(card('hub-resume-site'), 'uninstall', 'hub-resume-site')); await E.sleep(30);
  check('卸载→从已安装页消失，提示需要时可以再安装', !card('hub-resume-site') && toastText().includes('可以再安装'));
  E.click(E.btnByText('返回智能体')[0]); await E.sleep(30);
  check('返回首页：卸载的回到未安装状态（排在后面），停用的标"已停用"', !!card('hub-resume-site') && platformIds().indexOf('hub-resume-site') > platformIds().indexOf('b-compliance') && card('hub-expense').textContent.includes('已停用'));

  /* F 我的智能体：只放自建，有贡献 */
  E.click(act(E.doc.body, 'mine')); await E.sleep(30);
  const mineCards = E.all(E.doc.body, (n) => hasClass(n, 'agent-card')).map((n) => n.attrs['data-id']);
  check('我的智能体只有 2 张自建卡片，没有平台和外接、没有来源筛选', JSON.stringify(mineCards) === JSON.stringify(['c-analyst', 'c-ops']) && !E.btnByText('外接 Agent')[0] && !E.text().includes('平台'), mineCards.join(','));
  check('每张自建卡片有"贡献"（真实 agent-card-contribute），页面有"我的贡献"', ['c-analyst', 'c-ops'].every((i) => !!E.all(card(i), (n) => n.className.includes('agent-card-contribute'))[0]) && !!E.btnByText('我的贡献')[0]);
  E.click(act(card('c-analyst'), 'contribute', 'c-analyst')); await E.sleep(30);
  check('点"贡献"→沿用现有贡献流程', toastText().includes('开始贡献「项目分析师」'));
  E.click(E.btnByText('我的贡献')[0]); await E.sleep(30);
  const cRows = () => E.all(E.doc.body, (n) => hasClass(n, 'hubc-row')).map((n) => n.attrs['data-hubc-row']);
  const cDetail = () => E.doc.querySelector('[data-hubc-detail]');
  check('点"我的贡献"→客户端同款页面：返回行、标题、刷新、汇总 4/1/2、类型和状态筛选、搜索、列表 + 详情', !!E.doc.querySelector('.hubc-page') && !!E.btnByText('返回我的智能体')[0] && E.doc.querySelector('.hubc-heading h1').textContent === '我的贡献'
    && !!E.btnByText('刷新')[0] && E.doc.querySelector('.hubc-summary').textContent.replace(/\s+/g, '').startsWith('4项贡献1项待审核2项已发布')
    && !!E.doc.querySelector('[data-hubc-types]') && !!E.doc.querySelector('[data-hubc-filters]') && !!E.doc.querySelector('#hubc-mine-search') && cRows().length === 4);
  check('默认选中第一条（待审核），详情有"提交新版本"和"撤回投稿"', cDetail().textContent.includes('项目分析师') && cDetail().textContent.includes('待审核') && !!E.btnByText('提交新版本', cDetail())[0] && !!E.btnByText('撤回投稿', cDetail())[0]);
  E.click(act(E.doc.body, 'c-select', 'k3')); await E.sleep(30);
  check('点"调研材料清单"→详情显示退回原因和"修改后重新提交"', E.doc.querySelector('.hubc-row.is-selected').attrs['data-hubc-row'] === 'k3' && cDetail().textContent.includes('使用说明缺少示例输入') && !!E.btnByText('修改后重新提交', cDetail())[0]);
  E.click(act(E.doc.body, 'c-select', 'k2')); await E.sleep(30);
  check('已发布的：有"提交新版本""申请撤回""撤回记录"', ['提交新版本', '申请撤回', '撤回记录'].every((l) => !!E.btnByText(l, cDetail())[0]));
  E.click(act(E.doc.body, 'c-type', 'agent')); await E.sleep(30);
  check('类型"智能体"→只剩 2 条，列头变"智能体"', JSON.stringify(cRows()) === JSON.stringify(['k1', 'k4']) && E.doc.querySelector('.hubc-list__head').textContent.startsWith('智能体'));
  E.click(act(E.doc.body, 'c-filter', 'withdrawal')); await E.sleep(30);
  check('状态"撤回申请"→只剩经营分析师，详情显示撤回申请、不能再申请撤回', JSON.stringify(cRows()) === JSON.stringify(['k4']) && cDetail().textContent.includes('撤回申请') && !E.btnByText('申请撤回', cDetail())[0]);
  E.click(act(E.doc.body, 'c-type', 'all')); await E.sleep(30); E.click(act(E.doc.body, 'c-filter', 'all')); await E.sleep(30);
  E.type(E.doc.querySelector('#hubc-mine-search'), '不存在'); await E.sleep(30);
  check('搜索无结果→"没有匹配的贡献"，详情"选择一项贡献"', E.text().includes('没有匹配的贡献') && cDetail().textContent.includes('选择一项贡献'));
  E.type(E.doc.querySelector('#hubc-mine-search'), '口径'); await E.sleep(30);
  check('搜索"口径"→只剩项目报告口径核验', JSON.stringify(cRows()) === JSON.stringify(['k2']));
  E.click(E.btnByText('提交新版本', cDetail())[0]); await E.sleep(30);
  check('点详情操作→提示沿用现有流程', toastText().includes('提交新版本'));
  E.click(E.btnByText('返回我的智能体')[0]); await E.sleep(30);
  check('"返回我的智能体"→回到我的智能体', !!card('c-analyst') && !E.doc.querySelector('.hubc-page'));
  E.click(act(card('c-analyst'), 'detail', 'c-analyst')); await E.sleep(30);
  check('自建详情：贡献 / 管理 / 停用', ['贡献', '管理', '停用'].every((l) => !!E.btnByText(l, foot())[0]));
  E.click(E.modal().querySelector('[data-ui-modal-close]')); await E.sleep(30);
  E.type(E.doc.querySelector('#ap-search'), '经营'); await E.sleep(30);
  check('我的里搜索"经营"→只剩经营分析师', !!card('c-ops') && !card('c-analyst'));
  E.type(E.doc.querySelector('#ap-search'), ''); await E.sleep(30);

  /* G 创建 */
  E.click(E.btnByText('+创建')[0]); await E.sleep(30);
  check('创建弹窗：创建 / 外接 + 名称 / 简介 / 输出格式', modalText().includes('新建智能体') && modalText().includes('输出格式') && !!E.btnByText('外接', E.modal())[0]);
  E.click(E.btnByText('确认', E.modal())[0]); await E.sleep(60);
  check('空提交→提示请填写名称和简介', modalText().includes('请填写名称和简介'));
  const setf = (id, v) => { E.modal().querySelector('#' + id).value = v; };
  setf('ap-name', '合规审阅员'); setf('ap-intro', '说明'); E.click(E.btnByText('确认', E.modal())[0]); await E.sleep(60);
  check('与平台内容同名→提示已存在同名', modalText().includes('已存在同名智能体'));
  setf('ap-name', '合同比对员'); setf('ap-intro', '比对合同版本差异'); E.click(E.btnByText('确认', E.modal())[0]); await E.sleep(60);
  check('创建成功→进入我的，出现新卡片，计数 3', !E.modal() && E.all(E.doc.body, (n) => n.className.includes('agent-card-name') && n.textContent === '合同比对员').length === 1);
  E.click(act(E.doc.body, 'home')); await E.sleep(30);
  check('首页工具栏"我的智能体 · 3"，新建的不出现在首页', !!E.btnByText('我的智能体·3')[0] && !E.all(E.doc.querySelector('#ap-grid'), (n) => n.textContent === '合同比对员').length);
  E.click(act(E.doc.body, 'mine')); await E.sleep(30);
  E.click(E.btnByText('+创建')[0]); await E.sleep(30);
  E.click(E.btnByText('外接', E.modal())[0]); await E.sleep(30);
  E.click(E.btnByText('ClaudeCode', E.modal())[0]); await E.sleep(60);
  // 假 DOM 不会把 <textarea> 的文字内容当成 value（真实浏览器会），这里补填简介
  setf('ap-intro', '通过 Claude Code 处理开发任务。'); E.click(E.btnByText('确认', E.modal())[0]); await E.sleep(60);
  check('外接→回到首页，出现在"外接智能体 · 2"', !E.modal() && heads().includes('外接智能体 · 2'), JSON.stringify(heads()));

  /* H 技能页 */
  E.click(act(E.doc.body, 'tab', 'skill')); await E.sleep(900);
  check('技能首页只有"平台 · 9"一组', JSON.stringify(heads()) === JSON.stringify(['平台 · 9']), JSON.stringify(heads()));
  check('技能首页没有自建、外部包、全局文件夹技能，不展示人在用', !card('c-caliber') && !card('g-report') && !card('p-pdf-toolkit') && !/人在用/.test(E.text()));
  check('技能首页工具栏"我的技能 · 6"（自建 2 + 外部包 2 + 全局文件夹 2）', !!E.btnByText('我的技能·6')[0]);
  E.click(card('hub-mail-polish').querySelector('.marketplace-card-name')); await E.sleep(30);
  check('没装过的技能详情：标题、"通用 · 平台 · v1.0.2"、安检通过、能做什么 3 条、底部"安装技能"', E.modal().querySelector('.ui-modal__title').textContent === '邮件润色' && E.modal().querySelector('.ui-modal__description').textContent === '通用 · 平台 · v1.0.2'
    && modalText().includes('安检通过') && E.modal().querySelectorAll('.ap-checklist li').length === 3 && !!E.btnByText('安装技能', foot())[0] && !E.btnByText('使用技能', foot())[0]);
  E.click(E.btnByText('安装技能', foot())[0]); await E.sleep(1300);
  check('技能点"安装技能"→装好后弹窗还在，底部变"使用技能"', !!E.modal() && !!E.btnByText('使用技能', foot())[0] && toastText().includes('已安装「邮件润色」'));
  E.click(E.btnByText('使用技能', foot())[0]); await E.sleep(30);
  check('再点"使用技能"→进入新任务', !E.modal() && toastText().includes('已选中「邮件润色」'));
  E.click(act(E.doc.body, 'mine')); await E.sleep(30);
  const gridIds = () => E.all(E.doc.querySelector('#ap-grid'), (n) => (hasClass(n, 'skill-card') || hasClass(n, 'agent-card')) && n.attrs['data-id']).map((n) => n.attrs['data-id']);
  check('我的技能：一个网格（不分组），自定义在前、本机已有在后，共 6 张', heads().length === 0 && JSON.stringify(gridIds()) === JSON.stringify(['c-caliber', 'c-list', 'p-pdf-toolkit', 'p-gh-helper', 'g-report', 'g-frontend-design']), gridIds().join(','));
  check('顶部来源筛选：全部 / 自定义 / 本机已有（没有"平台"，没有分类）', ['全部', '自定义', '本机已有'].every((l) => !!act(E.doc.body, 'mine-src', { 全部: 'all', 自定义: 'custom', 本机已有: 'local' }[l])) && !act(E.doc.body, 'mine-src', 'platform') && !act(E.doc.body, 'cat'));
  check('自定义卡片：真实 skill-card，标"自定义"，有贡献；没有平台技能', hasClass(card('c-caliber'), 'skill-card') && card('c-caliber').textContent.includes('自定义') && !!E.all(card('c-caliber'), (n) => hasClass(n, 'skill-card-contribute'))[0] && !card('hub-mail-polish'));
  check('本机已有卡片：标"本机已有"，外部包带包名，都没有贡献按钮', card('p-pdf-toolkit').textContent.includes('github.com/acme/pdf-toolkit') && ['p-pdf-toolkit', 'g-report'].every((i) => card(i).textContent.includes('本机已有') && !E.all(card(i), (n) => hasClass(n, 'skill-card-contribute'))[0] && !!E.btnByText('使用', card(i))[0]));
  E.click(act(E.doc.body, 'mine-src', 'custom')); await E.sleep(30);
  check('筛选"自定义"→只剩 2 张自建', JSON.stringify(gridIds()) === JSON.stringify(['c-caliber', 'c-list']));
  E.click(act(E.doc.body, 'mine-src', 'local')); await E.sleep(30);
  check('筛选"本机已有"→只剩外部包和全局文件夹', JSON.stringify(gridIds()) === JSON.stringify(['p-pdf-toolkit', 'p-gh-helper', 'g-report', 'g-frontend-design']));
  E.click(act(E.doc.body, 'mine-src', 'all')); await E.sleep(30);
  E.click(card('p-pdf-toolkit').querySelector('.skill-card-name')); await E.sleep(30);
  check('外部包详情：说明行带仓库地址，有停用和移除，没有贡献 / 卸载 / 管理', E.modal().querySelector('.ui-modal__description').textContent === '文档处理 · 外部包（github.com/acme/pdf-toolkit）'
    && !!E.btnByText('停用', foot())[0] && !!E.btnByText('移除', foot())[0] && !['贡献', '卸载', '管理'].some((l) => E.btnByText(l, foot())[0]));
  E.click(E.btnByText('停用', foot())[0]); await E.sleep(30);
  E.click(E.modal().querySelector('[data-ui-modal-close]')); await E.sleep(30);
  check('停用外部包→卡片变暗、"使用"不可点', hasClass(card('p-pdf-toolkit'), 'is-disabled') && isDisabled(E.btnByText('使用', card('p-pdf-toolkit'))[0]));
  E.type(E.doc.querySelector('#ap-search'), 'report'); await E.sleep(30);
  check('我的技能搜索"report"→只剩 report', JSON.stringify(gridIds()) === JSON.stringify(['g-report']));
  E.type(E.doc.querySelector('#ap-search'), ''); await E.sleep(30);
  /* 一样东西只放一处：本机已有的技能只在「我的技能」里管 */
  check('我的技能顶部有说明条和全局文件夹总开关"读取 ~/.claude、~/.codex 的技能"', !!E.doc.querySelector('#ap-mine-local') && !!act(E.doc.body, 'global-roots') && E.text().includes('读取 ~/.claude、~/.codex 的技能'));
  E.click(act(E.doc.body, 'mine-src', 'custom')); await E.sleep(30);
  check('筛选"自定义"时不显示本机已有的说明条', !E.doc.querySelector('#ap-mine-local'));
  E.click(act(E.doc.body, 'mine-src', 'all')); await E.sleep(30);
  E.click(act(E.doc.body, 'global-roots')); await E.sleep(30);
  check('关掉总开关→全局文件夹两张卡片消失，说明条改为"已关闭读取"', !card('g-report') && !card('g-frontend-design') && !!E.doc.querySelector('#ap-global-off') && JSON.stringify(gridIds()) === JSON.stringify(['c-caliber', 'c-list', 'p-pdf-toolkit', 'p-gh-helper']));
  E.click(card('p-gh-helper').querySelector('.skill-card-name')); await E.sleep(30);
  E.click(E.btnByText('移除', foot())[0]); await E.sleep(30);
  check('外部包详情点"移除"→先确认（说明会一起移除它带的技能）', !!E.modal() && modalText().includes('移除「gh-helper」') && modalText().includes('1 个技能'));
  E.click(E.btnByText('移除', E.modal())[0]); await E.sleep(60);
  check('确认移除→从我的技能里消失，有提示', !E.modal() && !card('p-gh-helper') && toastText().includes('已移除「gh-helper」'));
  E.click(act(E.doc.body, 'home')); await E.sleep(30);
  check('回到技能首页→"我的技能 · 3"、"已安装的技能 · 5"（迁移来的 4 个 + 邮件润色；本地不算已安装）', !!E.btnByText('我的技能·3')[0] && !!E.btnByText('已安装的技能·5')[0]);
  E.click(act(E.doc.body, 'to-manage')); await E.sleep(30);
  const secRows = (g) => E.all(E.doc.querySelector(`[data-group^="${g}"]`), (n) => hasClass(n, 'ap-manage-row')).map((n) => n.attrs['data-id']);
  check('已安装的技能只有一组"从平台安装的 · 5"，没有"本地"', JSON.stringify(secRows('从平台安装的').sort()) === JSON.stringify(['b-summary', 'b-table-check', 'hub-mail-polish', 'pre-meeting-notes', 'pre-weekly-report']) && !E.doc.querySelector('[data-group^="本地"]') && !card('p-pdf-toolkit') && !act(E.doc.body, 'global-roots') && E.text().includes('已启用 5 / 共 5'));
  E.click(act(E.doc.body, 'home')); await E.sleep(30);
  E.click(act(E.doc.body, 'mine')); await E.sleep(30);
  check('我的技能里只剩自建 2 + PDF 工具包', JSON.stringify(gridIds()) === JSON.stringify(['c-caliber', 'c-list', 'p-pdf-toolkit']), gridIds().join(','));

  /* I 状态 */
  E = createEnv(dir, { search: '?v=offline' }); await E.sleep(300);
  check('offline：提示 + 重试；内置/默认安装/已安装的仍在，未安装的隐藏', E.text().includes('暂时无法获取平台内容') && !!card('hub-weekly-agent') && !!card('b-compliance') && !!card('pre-meeting-minutes') && !card('hub-expense'));
  E.click(act(E.doc.body, 'retry')); await E.sleep(30);
  check('点重试→恢复完整列表', !!card('hub-expense') && !E.text().includes('暂时无法获取平台内容'));
  E = createEnv(dir, { search: '?v=install-fail' }); await E.sleep(300);
  E.click(act(card('hub-expense'), 'install')); await E.sleep(1300);
  check('安装失败→卡片保留，"安装失败，可重试"+"重试"', card('hub-expense').textContent.includes('安装失败，可重试') && !!E.btnByText('重试', card('hub-expense'))[0] && !E.doc.querySelector('#toast').textContent.includes('进入新任务'));
  E.click(card('hub-expense').querySelector('.marketplace-card-name')); await E.sleep(30);
  check('失败后的详情：原因 + 底部"重试"', modalText().includes('安装没有完成') && modalText().includes('网络中断') && !!E.btnByText('重试', foot())[0]);
  E.click(E.btnByText('重试', foot())[0]); await E.sleep(1300);
  check('重试成功→已安装，底部变"使用智能体"', E.doc.querySelector('#toast').textContent.includes('已安装「报销助手」') && !!E.btnByText('使用智能体', foot())[0]);
  E = createEnv(dir, { search: '?v=loading' }); await E.sleep(100);
  check('loading：主智能体和本机自带的先显示，平台组里有骨架屏', !!card('m-cogseed') && !!card('b-compliance') && E.doc.querySelectorAll('.ui-skeleton').length >= 1 && !card('hub-expense'));
  E = createEnv(dir, { search: '?v=empty' }); await E.sleep(100);
  check('empty：平台只剩已安装的，并说明暂时没有更多', !!card('b-compliance') && !card('hub-expense') && E.text().includes('平台暂时没有更多可安装的智能体'));
  E = createEnv(dir, { search: '?v=skills-manage' }); await E.sleep(100);
  check('已安装的技能直达：迁移来的 4 个原随包技能都在，每行可卸载', ['b-summary', 'b-table-check', 'pre-meeting-notes', 'pre-weekly-report'].every((i) => !!act(card(i), 'uninstall', i)));
  E = createEnv(dir); await E.sleep(900);
  E.type(E.doc.querySelector('#ap-search'), '不存在的东西'); await E.sleep(30);
  check('搜索无结果→空态 + 清除筛选', E.text().includes('没有匹配的智能体') && !!act(E.doc.body, 'clear'));
  E.click(act(E.doc.body, 'cat', '产研')); await E.sleep(30);
  E.type(E.doc.querySelector('#ap-search'), ''); await E.sleep(30);
  check('分类"产研"→三组都按分类过滤（只剩 Codex 和代码评审助手）', !!card('x-codex') && !!card('hub-code-review') && !card('m-cogseed') && !card('b-compliance'));
  /* J 有更新 */
  E = createEnv(dir, { search: '?v=update' }); await E.sleep(950);
  check('有更新：卡片标"有更新"，详情说明行"可更新到 v1.1.0"，底部"更新到 v1.1.0"', card('hub-weekly-agent').textContent.includes('有更新') && E.modal().querySelector('.ui-modal__description').textContent.includes('可更新到 v1.1.0') && !!E.btnByText('更新到v1.1.0', foot())[0] && modalText().includes('有新版本 v1.1.0'));
  E.click(E.btnByText('更新到v1.1.0', foot())[0]); await E.sleep(300);
  check('点更新→"更新中…"', E.btnByText('更新中…', foot()).length === 1);
  await E.sleep(1200);
  check('更新完成→说明行变 v1.1.0、不再提示更新，卡片不再标"有更新"', E.modal().querySelector('.ui-modal__description').textContent === '通用 · 平台 · v1.1.0' && !E.btnByText('更新到v1.1.0', foot())[0] && !card('hub-weekly-agent').textContent.includes('有更新') && toastText().includes('已更新「周报助手」到 v1.1.0'));
  E.click(E.modal().querySelector('[data-ui-modal-close]')); await E.sleep(30);
  E.click(act(E.doc.body, 'to-manage')); await E.sleep(30);
  check('已安装页：仍有更新的"会议纪要助手"行标"有更新"', card('pre-meeting-minutes').textContent.includes('有更新') && !card('hub-weekly-agent').textContent.includes('有更新'));
  E = createEnv(dir, { search: '?v=update-fail' }); await E.sleep(950);
  E.click(E.btnByText('更新到v1.1.0', foot())[0]); await E.sleep(1500);
  check('更新失败→提示"没有完成"、保留 v1.0.4，按钮变"重试更新"', modalText().includes('更新到 v1.1.0 没有完成') && modalText().includes('已保留 v1.0.4') && !!E.btnByText('重试更新', foot())[0]);
  E.click(E.btnByText('重试更新', foot())[0]); await E.sleep(1500);
  check('重试更新成功', toastText().includes('已更新「周报助手」到 v1.1.0'));

  /* K 停用有依赖的技能 */
  E = createEnv(dir, { search: '?v=disable-dep' }); await E.sleep(950);
  const depNames = () => E.all(E.doc.querySelector('#ap-dep-list'), (n) => n.nodeName === 'li').map((n) => n.textContent);
  check('停用"文档摘要"→先弹确认，列出会受影响的已安装智能体，并说明它们将暂时不能使用', !!E.modal() && modalText().includes('停用「文档摘要」') && modalText().includes('暂时不能使用') && JSON.stringify(depNames().sort()) === JSON.stringify(['会议纪要助手', '项目材料审阅'].sort()), depNames().join(','));
  E.click(E.btnByText('取消', E.modal())[0]); await E.sleep(30);
  const swOf2 = (id) => E.all(card(id), (n) => n.attrs.role === 'switch')[0];
  check('点取消→不停用', swOf2('b-summary').attrs['aria-checked'] === 'true');
  E.click(swOf2('b-summary')); await E.sleep(30);
  E.click(E.btnByText('停用', E.modal())[0]); await E.sleep(60);
  check('确认停用→开关关闭', swOf2('b-summary').attrs['aria-checked'] === 'false' && toastText().includes('已停用「文档摘要」'));
  E.click(swOf2('b-table-check')); await E.sleep(30);
  check('停用没被引用的"表格核对"→不弹确认，直接停用', !E.modal() && swOf2('b-table-check').attrs['aria-checked'] === 'false');
  E.click(act(E.doc.body, 'home')); await E.sleep(30);
  E.click(act(E.doc.body, 'tab', 'agent')); await E.sleep(900);
  check('回智能体页：会议纪要助手、项目材料审阅卡片标"依赖已停用"且"使用"不可点，周报助手不受影响', card('pre-meeting-minutes').textContent.includes('依赖已停用') && isDisabled(E.btnByText('使用', card('pre-meeting-minutes'))[0]) && !card('hub-weekly-agent').textContent.includes('依赖已停用') && !isDisabled(E.btnByText('使用', card('hub-weekly-agent'))[0]));
  E.click(card('pre-meeting-minutes').querySelector('.marketplace-card-name')); await E.sleep(30);
  check('详情：提示"依赖的技能已停用"，"文档摘要"标"已停用"，"会议纪要"仍"已就绪"，底部有"启用「文档摘要」"', modalText().includes('依赖的技能已停用') && E.all(E.modal(), (n) => hasClass(n, 'ap-skillchip') && hasClass(n, 'is-off')).map((n) => n.textContent).join('|').includes('文档摘要已停用') && modalText().includes('会议纪要已就绪') && !!E.btnByText('启用「文档摘要」', foot())[0]);
  check('依赖停用时：详情"使用智能体"与示例都不可点，提示"暂时不能使用"', isDisabled(E.btnByText('使用智能体', foot())[0]) && E.all(E.modal(), (n) => hasClass(n, 'ap-popup-example') && !isDisabled(n)).length === 0 && modalText().includes('暂时不能使用'));
  E.click(E.btnByText('启用「文档摘要」', foot())[0]); await E.sleep(60);
  check('点"启用「文档摘要」"→提示消失、技能恢复"已就绪"、"使用智能体"恢复可点', !modalText().includes('依赖的技能已停用') && modalText().includes('文档摘要已就绪') && toastText().includes('已启用「文档摘要」') && !isDisabled(E.btnByText('使用智能体', foot())[0]));
  E = createEnv(dir, { search: '?v=dep-off' }); await E.sleep(950);
  check('直达"依赖已停用"：会议纪要助手详情直接显示依赖提示', modalText().includes('依赖的技能已停用'));

  /* L 未登录 */
  E = createEnv(dir, { search: '?v=logged-out' }); await E.sleep(950);
  check('未登录：顶部提示"登录后查看更多平台内容"+登录按钮；侧栏显示"未登录"', !!E.doc.querySelector('#ap-login-note') && !!act(E.doc.querySelector('#ap-login-note'), 'login') && E.doc.querySelector('#hub-account-chip-root').textContent.includes('未登录'));
  check('未登录：主智能体、外接、已安装的平台内容照常显示；未安装的不显示', !!card('m-cogseed') && !!card('x-codex') && !!card('b-compliance') && !!card('hub-weekly-agent') && !card('hub-expense') && !card('hub-resume-site'));
  check('未登录："我的智能体""已安装的智能体"入口照常', !!E.btnByText('我的智能体·2')[0] && !!E.btnByText('已安装的智能体·4')[0]);
  E.click(act(E.doc.body, 'mine')); await E.sleep(30);
  E.click(act(card('c-analyst'), 'contribute', 'c-analyst')); await E.sleep(30);
  check('未登录点"贡献"→提示先登录，不开始贡献', !!E.modal() && modalText().includes('请先登录') && modalText().includes('贡献到平台') && !toastText().includes('开始贡献'));
  E.click(E.btnByText('登录', E.modal())[0]); await E.sleep(60);
  E.click(act(E.doc.body, 'home')); await E.sleep(30);
  check('登录后→提示消失，未安装的平台内容出现', !E.doc.querySelector('#ap-login-note') && !!card('hub-expense') && E.doc.querySelector('#hub-account-chip-root').textContent.includes('雨萱'));
  E.click(E.doc.querySelector('#hub-account-chip')); await E.sleep(30);
  check('已登录时点左下角账号→"退出登录"确认', !!E.modal() && modalText().includes('退出登录') && modalText().includes('已安装的智能体和技能仍可使用'));
  E.click(E.btnByText('退出登录', E.doc.querySelector('.ui-modal__footer'))[0]); await E.sleep(60);
  check('退出登录→顶部出现登录提示、未安装的平台内容隐藏、账号显示"未登录"', !!E.doc.querySelector('#ap-login-note') && !card('hub-expense') && E.doc.querySelector('#hub-account-chip-root').textContent.includes('未登录'));
  E.click(E.doc.querySelector('#hub-account-chip')); await E.sleep(30);
  check('未登录时点账号→"请先登录"', !!E.modal() && modalText().includes('请先登录'));

  for (const key of ['update', 'update-fail', 'disable-dep', 'dep-off', 'logged-out', 'agents', 'agent-detail', 'agents-mine', 'agents-manage', 'skills', 'skills-mine', 'skills-manage', 'contributions', 'skills-contributions', 'create', 'detail-uninstalled', 'detail-builtin', 'detail-disabled', 'detail-own', 'detail-external']) {
    E = createEnv(dir, { search: '?v=' + key }); await E.sleep(950);
    check(`直达 ?v=${key} 无报错`, E.errors.length === 0, E.errors.join('|'));
  }
  const bad = out.filter((o) => !o[1]).length; console.log(`\n${out.length - bad}/${out.length} 通过`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e.stack || e); process.exit(2); });
