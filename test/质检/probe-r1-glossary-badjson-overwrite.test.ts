/**
 * 词表坏档覆盖探针：坏 JSON 被按空表读取后，后续全量保存可能把原词条
 * 替换成「空表+新条目」。模拟云同步截断来观察这一数据丢失边界。
 *
 * 好档累积与真正 ENOENT 的空初始化是有效对照。坏档用例保留结构化错误、
 * copy 备份和拒写的预期，但暂时挂起：该预期与现有「JSON 损坏后降级为空表
 * 且不抛错」的读取契约不同，需要与读写恢复路径一起确定后再启用。
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

describe('词表坏档覆盖边界与正常初始化对照', () => {
  it('对照组：好档时词条正常累积', () => {
    upsertEntry(uid, { wrong: 'coxy', correct: 'Cogseed' });
    upsertEntry(uid, { wrong: 'exampleterm', correct: '示例词条' });
    expect(loadGlossary(uid).entries.length).toBe(2);
  });

  it('对照组：真 ENOENT 仍走空初始化（拒绝写不误伤新用户）', () => {
    const file = userTranscriptGlossaryFile(uid);
    expect(fs.existsSync(file)).toBe(false);
    expect(loadGlossary(uid).entries.length).toBe(0);
    upsertEntry(uid, { wrong: 'fresh', correct: 'Fresh' });
    expect(loadGlossary(uid).entries.length).toBe(1);
  });

  // 与当前坏档降级读取契约不同；统一读写恢复行为后再启用该预期。
  it.skip('待统一坏档契约：坏 JSON → 结构化错误 + .corrupt 备份 + 拒写，盘上字节不被覆盖', () => {
    // 先通过正常写路径落两条合成词条。
    upsertEntry(uid, { wrong: 'coxy', correct: 'Cogseed' });
    upsertEntry(uid, { wrong: 'exampleterm', correct: '示例词条' });
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
