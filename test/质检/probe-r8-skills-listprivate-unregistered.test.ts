/**
 * 探针 r8（边界测试员 · 本遍循环第 3 轮）→ 主题：IPC 通道「调用 / 注册」两方不对齐。
 *
 * 疑点（机械扫描发现，逐项亲证）：
 * - 渲染层 skills.js:438 `window.cogseed.invoke('skills.listPrivate')`——
 *   主进程全部注册源（ipc/index.ts + 19 个分文件字典 + ipcMain.handle 直注）
 *   **零注册**。渲染层对未注册通道的 invoke 走通用分发 resolve {ok:false}
 *   （F-r1-3 前遍修复的 boot.js relaunch 同款机制），若真发出只会静默拿空结果。
 * - 但调用方 `_mergeAgentPrivateSkills` 的守卫（skills.js:436）
 *   `if (typeof isDevMode !== 'function' || !false || ...) return;` 中 `!false`
 *   恒真 → 条件恒真 → 函数自文件初始导入（commit 4991c338）即天生死代码，
 *   invoke 永不发出——零注册因此**无运行时危害**，属「死代码里的死通道」。
 * - 与 P-r1-9（projects.list 退役通道，功能退化有用户可见危害）同族不同档。
 *
 * 判定：pending（领域在 skills 面板非认知资产核心域；且当前不可达；修法两向
 * ——删死函数连带 invoke，或修恒真守卫激活 dev 检查区块并注册通道——需拍板）。
 * 对照组证明扫描口径有效（真实注册的 skills.list 在场）。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r3-41（删死函数+调用点（推荐）/ 修活守卫+注册 dev-gated 处理器两向不可只做半截——待拍板）；本文件亦是 P-r3-34（质检目录并行非确定）的复现载体**——
 * 断言漏洞/分裂现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（合法路径/既有契约在）不依赖漏洞，保留 active。
 *
 * P-r3-34 处置补记（2026-10-01 工单 b5，决策卡组 11「先修拾取再串行化」）：
 * 哈希快照实测坐实「整跑拾取写盘中（中间态）文件」——整跑自身零写方（第一次
 * 快照比对 1201 文件零变化），但并行修复现场 8s 整跑窗口内 3 个 src 源文件被
 * 其他执行单元并发改写（含本探针 mainRegisteredChannels() 读取的 src/main/ipc/
 * 目录），本探针静态读源文件撞上写盘中间态即假红、复跑全绿。修拾取：本文件
 * 全部源码读取改走 readStable（连读两次一致才采纳，撞中间态退避重读）；主待议
 * P-r3-41 的 it.skip 状态不随本处置变化。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.join(__dirname, '../..');

/**
 * P-r3-34 修拾取：质检循环是多 agent 并行修复现场，整跑期间仓库 src 源文件可能
 * 正被其他执行单元改写（2026-10-01 哈希快照实测坐实）。静态断言读到写盘中间态
 * 会假红（历史 flake 指纹：首跑 1 failed + 1 unhandled error、复跑全绿、失败文件
 * mtime 与整跑同分钟）。稳定读：同文件连读两次内容一致才采纳；不一致说明撞上
 * 写盘中间态，同步退避 10ms 后重读，直至稳定或达上限（用最后一次内容继续，
 * 不把重试耗尽当成测试失败——断言本身才是判据）。
 */
function readStabFile(absPath: string, attempts = 6): string {
  let prev = fs.readFileSync(absPath, 'utf8');
  for (let i = 1; i < attempts; i++) {
    const next = fs.readFileSync(absPath, 'utf8');
    if (next === prev) return next;
    prev = next;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return prev;
}

function read(p: string): string {
  return readStabFile(path.join(repoRoot, p));
}

/** 主进程全部通道注册键（分文件字典键 + index.ts 键 + ipcMain.handle 直注）。 */
function mainRegisteredChannels(): Set<string> {
  const keys = new Set<string>();
  const ipcDir = path.join(repoRoot, 'src/main/ipc');
  for (const file of fs.readdirSync(ipcDir).filter((f) => f.endsWith('.ts'))) {
    const text = readStabFile(path.join(ipcDir, file));
    for (const m of text.matchAll(/^\s+'([a-zA-Z0-9_.]+)':/gm)) keys.add(m[1]);
  }
  // ipcMain.handle 直注（preload 直通形态，如 cogseed.relaunch）
  const mainIndex = read('src/main/index.ts');
  for (const m of mainIndex.matchAll(/ipcMain\.handle\(\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
  return keys;
}

describe('probe r8 › skills.listPrivate：渲染调用零注册 + 恒真守卫死代码', () => {
  // P-r3-41（2026-10-01 拍板「删死函数+调用点」）已执行：_mergeAgentPrivateSkills
  // 连同其 `skills.listPrivate` invoke 与恒真守卫一并删除，主进程配套的
  // listAgentPrivateSkills 导出随之退役。主靶断言按拍板反转：坐实死链不回潮。
  it('【已修 P-r3-41】主靶：死函数/死调用/恒真守卫零残留，通道保持零注册', () => {
    const skills = read('src/renderer/modules/skills.js');
    // ① 渲染层不再有该调用（死函数已删；注释里的历史说明不算残留，锚定
    // 函数定义与调用语法）
    expect(skills).not.toContain("invoke('skills.listPrivate')");
    expect(skills).not.toContain('async function _mergeAgentPrivateSkills');
    expect(skills).not.toContain('await _mergeAgentPrivateSkills');
    // ② 恒真守卫指纹在代码行不复存在（剥离 // 注释行再匹配——历史说明
    // 注释允许引用该指纹）
    const codeLines = skills.split('\n').filter((line) => !line.trim().startsWith('//'));
    expect(codeLines.join('\n')).not.toMatch(/\|\| !false \|\|/);
    // ③ 主进程全部注册源仍无该键（通道从未注册，保持零注册）
    const registered = mainRegisteredChannels();
    expect(registered.has('skills.listPrivate')).toBe(false);
    // ④ 主进程配套服务函数已随真删退役（零消费零测试，P-r3-3 同精神）
    const skillsService = read('src/main/features/skills.ts');
    expect(skillsService).not.toContain('export async function listAgentPrivateSkills');
    // 渲染防御分支保留：listSkills 排除 ownerAgent，分组分支防未来泄漏
    expect(skills).toContain("if (s.ownerAgent) { groups.private.push(s); continue; }");
  });

  it('对照组：真实注册的 skills.list / skills.read 在注册集合内（扫描口径有效非漏扫）', () => {
    const registered = mainRegisteredChannels();
    expect(registered.has('skills.list')).toBe(true);
    expect(registered.has('skills.read')).toBe(true);
    expect(registered.has('projects.list')).toBe(false); // P-r1-9 已议的退役通道（口径参照，不另立项）
  });
});
