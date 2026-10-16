/**
 * 词表控制字符探针：观察 U+202E（RTL override）与 NUL 经写入、重读和
 * scanText→applyCorrections 替换链进入清理版文本的路径。控制字符可能造成
 * 视觉欺骗，不能将仅有长度校验等同于字符清洗。
 *
 * 干净输入对照保持启用；含控制字符的观察断言暂时挂起，待词表读写两侧的
 * 字符处理契约确定后再改为相应的拒绝或清洗断言。memory 的注入检测作为
 * 不同入口的行为对照，不替代词表自身的处理。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { upsertEntry, loadGlossary, listEntries } from '../../src/main/features/transcript_glossary';
import { scanText, applyCorrections } from '../../src/main/features/transcript_auto_correct';

let tmpDir: string;
let uid = '';
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-glos-ctl-'));
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  uid = `u_gctl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('探针 r4 › 词表词条控制字符零过滤：落盘透传 + 替换链带入清理版文本', () => {
  it('对照组：正常词条读写与替换链干净', () => {
    const res = upsertEntry(uid, { wrong: 'coxy', correct: 'Cogseed' });
    expect(res.entry?.correct).toBe('Cogseed');
    const entries = listEntries(uid, { status: 'active' });
    const scan = scanText('coxy 是演示词', entries);
    expect(scan.candidates.length).toBeGreaterThan(0);
    const applied = applyCorrections('coxy 是演示词', scan.candidates, { acceptRiskLevels: ['low', 'medium', 'high'] });
    expect(applied.text).toBe('Cogseed 是演示词');
  });

  it.skip('待统一字符处理：RTL override（U+202E）与 NUL（\\x00）词条全链落盘透传', () => {
    // 写入口 bounded 只查类型与长度（≤80/200），无字符清洗。
    const rtl = upsertEntry(uid, { wrong: 'speakerx', correct: 'SpeakerX\u202Eelpmas 演示角色' });
    expect(rtl.entry).toBeTruthy();
    const nul = upsertEntry(uid, { wrong: 'nulprobe', correct: 'A\x00B' });
    expect(nul.entry).toBeTruthy();
    // 读侧 normalizeStoredEntry 逐字段收敛但同样不滤：读回原样。
    const reloaded = loadGlossary(uid).entries;
    expect(reloaded.some((e) => e.correct.includes('\u202E'))).toBe(true);
    expect(reloaded.some((e) => e.correct.includes('\x00'))).toBe(true);
    // 对照：同仓 memory 通道对同文本有 invisible-unicode 防线（两通道口径分裂）。
    const { scanForInjection } = require('../../src/main/features/memory');
    expect(scanForInjection('SpeakerX\u202Eelpmas')).toBeTruthy();
  });

  it.skip('待统一字符处理：替换链把含控制字符的 correct 原样写进清理版文本', () => {
    upsertEntry(uid, { wrong: 'speakerx', correct: 'SpeakerX\u202E 演示角色' });
    const entries = listEntries(uid, { status: 'active' });
    const scan = scanText('speakerx 为演示发言', entries);
    expect(scan.candidates.length).toBeGreaterThan(0);
    const applied = applyCorrections('speakerx 为演示发言', scan.candidates, { acceptRiskLevels: ['low', 'medium', 'high'] });
    // 清理版文本（另存进 KB 的会议纪要）携带 RTL override——其后的文字在支持
    // 双向算法的渲染器里反向显示（视觉欺骗向量）。
    expect(applied.text).toContain('\u202E');
  });
});
