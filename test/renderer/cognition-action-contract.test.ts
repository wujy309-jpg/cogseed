/**
 * 认知资产迁移动作契约(施工矩阵的门禁形态)。
 *
 * 依据 `test/renderer/fixtures/cognition-actions.json`(转录自
 * design/认知资产-原型按钮IPC施工矩阵-20260921.md)。四条不变量:
 *
 * 1. **完整性**:views.js 里出现的每个 data-act(含 btn()/moreRow() 生成的)
 *    在 app.js 委托层必须有 case 或 change 选择器——出现即被消费,不允许
 *    渲染出来点了没反应的按钮。
 * 2. **禁入**:batchRunNow 不得出现在认知资产前端(批量立即整理入口
 *    确认不迁移,后端能力保留)。
 * 3. **必达**:fixture 里每个动作在目标模块落地(cognition-assets 看
 *    app.js handler;personal-ontology 看 IPC 通道调用点)。迁移分阶段
 *    推进,该断言在 Phase 5-8 期间逐步由红转绿,是迁移完成的机械判据。
 * 4. **pending 态**:fixture 标 pending=true 的写动作必须在 app.js 的
 *    WRITE_ACTIONS 集合里(点击即禁用,防双击重复提交)。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const core = read('src/renderer/modules/cognition-assets/core.js');
// 2026-09-29 views.js 机械拆分:候选族/待我处理动作随函数迁入 review-candidate.js /
// review-views.js,动作扫描按加载顺序合并三源(断言语义不变)。
const views = ['views.js', 'review-candidate.js', 'review-views.js']
  .map((file) => read(`src/renderer/modules/cognition-assets/${file}`))
  .join('\n');
const app = read('src/renderer/modules/cognition-assets/app.js');
const ontology = read('src/renderer/modules/personal-ontology.js');
const fixture = JSON.parse(read('test/renderer/fixtures/cognition-actions.json')) as {
  actions: { act: string; module: string; ipc: string | null; write: boolean; pending: boolean; phase: number }[];
  forbidden: { act: string; reason: string }[];
};

/** app.js 委托层实际处理的动作:switch case + change 事件的 data-act 选择器。 */
function handledActs(): Set<string> {
  const acts = new Set<string>();
  for (const m of app.matchAll(/case '([a-z0-9-]+)'/g)) acts.add(m[1]);
  for (const m of app.matchAll(/\[data-act="([a-z0-9-]+)"\]/g)) acts.add(m[1]);
  return acts;
}

/** views.js 里引用的动作:data-act 字面量 + btn() 第二参 + moreRow() 第三参
 *  (btn/moreRow 是本模块生成 data-act 的两个 helper,roleBtn/svg 的 data-act
 *  以字面量出现)。 */
function referencedActs(): Set<string> {
  const acts = new Set<string>();
  for (const m of views.matchAll(/data-act="([a-z0-9-]+)"/g)) acts.add(m[1]);
  for (const m of views.matchAll(/\bbtn\(\s*[^,()]+(?:\([^()]*\))?[^,()]*,\s*'([a-z0-9-]+)'/g)) acts.add(m[1]);
  for (const m of views.matchAll(/\bmoreRow\(\s*[^,]+,\s*[^,]+,\s*'([a-z0-9-]+)'/g)) acts.add(m[1]);
  return acts;
}

/** personal-ontology.js 实际发起调用的 IPC 通道:只认 _pocInvoke('x') /
 *  _pocGroupAction('x') 的字面量首参调用语法,且**先剥注释再匹配**——对齐
 *  handledActs/referencedActs 的语法锚定惯例(P-r3-35:原 `ontology.includes
 *  ("'act'")` 是裸文本匹配,调用点被删但通道名残留注释时守卫照绿,是潜在盲区;
 *  通道名出现在注释里不算落地)。剥除误差方向宁红勿绿:误剥只会让守卫更早红。 */
function poCalledChannelsIn(source: string): Set<string> {
  // 块注释整体剥;以 // 开头的行整行剥(行中段 // 不动——URL 字符串里 // 前有
  // 冒号,粗暴截断会误伤真实代码)。
  const codeOnly = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  const channels = new Set<string>();
  for (const m of codeOnly.matchAll(/\b_poc(?:Invoke|GroupAction)\(\s*'([a-zA-Z0-9.]+)'/g)) channels.add(m[1]);
  return channels;
}
function poCalledChannels(): Set<string> {
  return poCalledChannelsIn(ontology);
}

const writeActionsBlock = (() => {
  const start = app.indexOf('const WRITE_ACTIONS = new Set([');
  if (start < 0) return '';
  const end = app.indexOf(']);', start);
  return app.slice(start, end);
})();

describe('认知资产动作契约', () => {
  it('views.js 渲染的每个动作都有 app.js 委托处理', () => {
    const handled = handledActs();
    const orphan = [...referencedActs()].filter((act) => !handled.has(act)).sort();
    expect(orphan).toEqual([]);
  });

  it('批量立即整理入口不进前端(batchRunNow 禁入)', () => {
    for (const banned of fixture.forbidden) {
      expect(views).not.toContain(`data-act="${banned.act}"`);
      expect(app).not.toContain(`case '${banned.act}'`);
    }
    expect(app).not.toContain('batchRunNow');
  });

  it('app.js switch 的 case 名不得重复(重复时仅首个匹配执行,后续分支永不可达)', () => {
    // 2026-10-01 修复回归:inbox-boundary-save 曾在同一 switch 出现两次,
    // 第二分支永不可达且读的字段名与渲染层(boundary-applicable)不一致。
    const names = [...app.matchAll(/case '([a-z0-9-]+)'/g)].map((m) => m[1]);
    const seen = new Set<string>();
    const dup = names.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
    expect(dup, `app.js 存在重复 case(仅首个执行):${dup.join(', ')}`).toEqual([]);
  });

  it('fixture 动作全部在目标模块落地(迁移完成的机械判据)', () => {
    const handled = handledActs();
    // P-r3-35:personal-ontology 侧按调用语法锚定(见 poCalledChannels 注释)。
    const poCalled = poCalledChannels();
    const missing = fixture.actions.filter((entry) => {
      if (entry.module === 'cognition-assets') return !handled.has(entry.act);
      return !poCalled.has(entry.act);
    }).map((entry) => `${entry.module}:${entry.act}`);
    expect(missing).toEqual([]);
  });

  it('写动作的 pending 集合覆盖 fixture 标记', () => {
    const pendingRequired = fixture.actions
      .filter((entry) => entry.module === 'cognition-assets' && entry.pending)
      .map((entry) => entry.act);
    const missing = pendingRequired.filter((act) => !writeActionsBlock.includes(`'${act}'`));
    expect(missing).toEqual([]);
  });

  it('fixture 覆盖了现役全部写通道,未静默漏掉新动作', () => {
    // 反向钳制:app.js WRITE_ACTIONS 里的动作都必须出现在 fixture 里——
    // 未来新增写动作若没登记进施工矩阵,这里会先红。
    const inWriteSet = [...writeActionsBlock.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    const known = new Set(fixture.actions.filter((e) => e.module === 'cognition-assets').map((e) => e.act));
    const unregistered = inWriteSet.filter((act) => !known.has(act));
    expect(unregistered).toEqual([]);
    // 推荐卡确认的核心层动作存在(app.js case 调用它)。
    expect(core).toContain('acknowledgeAssetRecommendation');
  });
});

/* ═══════════ 真机修复守卫（2026-09-26 T035 取证抓出）═══════════
 * app.js 曾在 purge 按钮的委托分支裸调 confirmUser（helper 实际经
 * NS.confirmUser 暴露）→ 真机点击直接 ReferenceError，「立即彻底删除」
 * 按钮一直是死的。源码级钉住：app.js 内不得再出现裸引用。 */
describe('app.js 委托层的 helper 引用（真机修复守卫）', () => {
  it('confirmUser 一律经 NS.confirmUser——裸引用即红', () => {
    const bare = [...app.matchAll(/(?<!NS\.)\bconfirmUser\s*\(/g)];
    expect(bare.map((m) => m[0]), `app.js 存在裸 confirmUser 调用（真机会 ReferenceError）：${bare.length} 处`).toHaveLength(0);
    expect(app).toContain('NS.confirmUser');
  });
});

/* ═══════════ P-r3-35 盲区守卫的回归钉 ═══════════
 * 本条修的盲区:调用点被删(整行注释掉)但通道名残留注释时,原裸 includes
 * 断言照绿。落地断言已改为「剥注释 + 调用语法锚定」(poCalledChannels),此处
 * 用受控样本钉住剥离行为本身——未来若有人把剥注释逻辑简化掉(退回裸正则),
 * 这里先红。mutation 验证记录见 reports/认知资产质检循环-20260930/wo-b8-err-hot.md。 */
describe('poCalledChannels 注释剥离（P-r3-35 回归钉）', () => {
  it('注释里的 _pocInvoke 调用形态不算落地,真实调用点才算', () => {
    const sample = [
      "    const res = await _pocInvoke('po.real.channel', { groupId: 'g' });",
      "    // const dead = await _pocInvoke('po.line.commented', { groupId: 'g' });",
      '    /* const dead2 = await _pocInvoke(\'po.block.commented\', {}); */',
      "    const act = await _pocGroupAction('po.real.groupAction', { groupId: 'g' });",
      "    // _pocGroupAction('po.groupAction.commented', {})",
    ].join('\n');
    const channels = poCalledChannelsIn(sample);
    expect([...channels].sort()).toEqual(['po.real.channel', 'po.real.groupAction']);
  });

  it('行中段 // 不截断:URL 里的双斜杠不算注释开头(剥除误伤会让守卫假红)', () => {
    const sample = [
      "    const url = 'https://example.com/x';",
      "    const res = await _pocInvoke('po.after.url', {});",
    ].join('\n');
    expect([...poCalledChannelsIn(sample)]).toEqual(['po.after.url']);
  });
});
