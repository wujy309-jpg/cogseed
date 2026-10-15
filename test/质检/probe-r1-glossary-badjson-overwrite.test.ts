/**
 * 探针（本轮红队-数据与注入）：词表坏档静默覆盖——loadGlossary 坏 JSON 当空表，
 * 下一次任意保存把全部词条静默替换成「空表+这一条」（与 po 域 P-r1-8 同构、
 * 不同文件，前遍只登记了 po/store.ts 一处）。
 *
 * 读码链路（transcript_glossary.ts）：
 *  - loadGlossary :327-333：readFileSync/JSON.parse 抛错（ENOENT 之外，含坏 JSON、
 *    云同步冲突截断）→ 只 log.warn('glossary unreadable') → 返回 emptyGlossary；
 *  - 词表所有写路径（upsertEntry :823 / recordReplacement :878 / setScope …）都是
 *    「loadGlossary 读全文 → 改 → saveGlossary 全量回写」（saveGlossary :435-447
 *    tmp+rename 覆盖写）；
 *  - 于是：坏档 → 内存空表 → 用户确认一个新纠错词 → 盘上被「空表+1 条」整体
 *    覆盖，原词条全丢且无坏档备份——与 P-r1-8（po/store.ts:70 坏档静默覆盖，
 *    待议 high）同一触发面（云同步冲突）与同一丢失形态。
 *
 * 触发面：transcript_glossary.md 与 personal-ontology.json 同在用户数据目录
 * （云同步域）；词表是会议纠错沉淀的唯一载体。
 *
 * 收尾状态（2026-10-01 b2 执行员按拍板启用）→ **同日 b2 回滚员回滚**：
 * 对应待议 **P-r1-88（high）**，决策卡拍板「copy 备份 + 拒绝写 + 恢复入口」
 * 三件套（util/corrupt-guard）。词表读侧接线（loadGlossary 抛结构化
 * CorruptFileError + .corrupt 备份 + cognition.corrupt.* 恢复通道）与既有
 * 契约测试「JSON 损坏 → 降级空表且不抛错」（test/main/features/
 * transcript_glossary.test.ts）正面冲突，恢复通道又未登记 014 anti-drift
 * 白名单——两处门禁新增失败，读侧已按 before 快照回滚，本主用例恢复
 * 挂起（断言保留修复后口径，待 P-r1-88 与旧契约测试裁决后一并反转）。
 * 对照组（好档正常累积 / 真 ENOENT 空初始化）与回滚后行为一致，保持 active。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadGlossary, upsertEntry } from '../../src/main/features/transcript_glossary';
import { userTranscriptGlossaryFile } from '../../src/main/paths';

let tmpDir: string;
let uid = '';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-glos-bad-'));
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  uid = `u_glos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('探针 r1 › 词表坏档静默覆盖（P-r1-88 修复被 b2 回滚：读侧与既有契约冲突，待议恢复）', () => {
  it('对照组：好档时词条正常累积', () => {
    upsertEntry(uid, { wrong: 'coxy', correct: 'Cogseed' });
    upsertEntry(uid, { wrong: 'fuping', correct: '傅平' });
    expect(loadGlossary(uid).entries.length).toBe(2);
  });

  it('对照组：真 ENOENT 仍走空初始化（拒绝写不误伤新用户）', () => {
    const file = userTranscriptGlossaryFile(uid);
    expect(fs.existsSync(file)).toBe(false);
    expect(loadGlossary(uid).entries.length).toBe(0);
    upsertEntry(uid, { wrong: 'fresh', correct: 'Fresh' });
    expect(loadGlossary(uid).entries.length).toBe(1);
  });

  // b2 回滚：P-r1-88 词表读侧已按 before 快照回滚（坏 JSON 降级空表），
  // 本用例断言的修复后行为暂不成立，恢复挂起；重新落地时随读侧一并反转。
  it.skip('【待议 P-r1-88（b2 回滚）】坏 JSON → 结构化错误 + .corrupt 备份 + 拒写，盘上字节不被覆盖', () => {
    // 先落两条真实词条（走正常写路径）。
    upsertEntry(uid, { wrong: 'coxy', correct: 'Cogseed' });
    upsertEntry(uid, { wrong: 'fuping', correct: '傅平' });
    const file = userTranscriptGlossaryFile(uid);
    expect(loadGlossary(uid).entries.length).toBe(2);

    // 模拟云同步冲突把文件截断成坏 JSON。
    const corruptBytes = '{"version":2,"uid":"' + uid + '","entries":[{"wrong":"cox';
    fs.writeFileSync(file, corruptBytes);

    // ① 读侧返回结构化错误（不再当空表吞掉）。
    let readErr: Error | undefined;
    try { loadGlossary(uid); } catch (err) { readErr = err as Error; }
    expect(readErr).toBeTruthy();
    expect((readErr as { code?: string }).code).toBe('cognition_file_corrupt');

    // ② 坏档已被 copy 备份（原文件不动，非 move）。
    const backups = fs.readdirSync(path.dirname(file)).filter((n) => n.includes('corrupt'));
    expect(backups.length).toBe(1);
    expect(fs.readFileSync(path.join(path.dirname(file), backups[0]), 'utf8')).toBe(corruptBytes);

    // ③ 写侧拒绝：最普通的写路径不再把「空表+这一条」覆写上去。
    let writeErr: Error | undefined;
    try { upsertEntry(uid, { wrong: 'moodle', correct: 'Moodle' }); } catch (err) { writeErr = err as Error; }
    expect(writeErr).toBeTruthy();
    expect((writeErr as { code?: string }).code).toBe('cognition_file_corrupt');

    // ④ 盘上仍是坏档原字节（未被清成空表+1），备份仍在。
    expect(fs.readFileSync(file, 'utf8')).toBe(corruptBytes);
    expect(fs.readdirSync(path.dirname(file)).filter((n) => n.includes('corrupt'))).toHaveLength(1);
  });
});
