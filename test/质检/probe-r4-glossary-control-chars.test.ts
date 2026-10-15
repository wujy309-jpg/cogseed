/**
 * 探针（本轮红队-数据与注入，主题：数据完整性与极端输入/控制字符）：词表词条
 * （transcript_glossary）对控制字符/双向覆写字符零过滤——wrong/correct 全链
 * （upsertEntry bounded 只查长度、normalizeStoredEntry 逐字段收敛但无字符清洗）
 * 落盘原样，经 scanText→applyCorrections 把含 U+202E（RTL override）/\x00 的
 * correct 写进会议清理版文本（进 KB 与检索），构成纪要视觉欺骗向量；对照同仓
 * memory.ts scanForInjection :228 的 invisible-unicode 规则——词表通道无同款防线。
 *
 * 对照前遍 P-r1-4（po 域控制字符，待议）：同族不同文件，glossary 域从未登记。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r4-3（bounded 单点剥离 / 写读双闸 / 复用共享字符集三案待拍板；与 P-r4-2 同拍，前遍 P-r1-4 族）**——
 * 断言漏洞现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（干净输入/正常序时防线与链路正常）不依赖漏洞，保留 active。
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

  it.skip('【待议 P-r4-3】漏洞：RTL override（U+202E）与 NUL（\\x00）词条全链落盘透传', () => {
    // 写入口 bounded 只查类型与长度（≤80/200），无字符清洗。
    const rtl = upsertEntry(uid, { wrong: 'victor', correct: 'Victor\u202Eregal 先生' });
    expect(rtl.entry).toBeTruthy();
    const nul = upsertEntry(uid, { wrong: 'nulprobe', correct: 'A\x00B' });
    expect(nul.entry).toBeTruthy();
    // 读侧 normalizeStoredEntry 逐字段收敛但同样不滤：读回原样。
    const reloaded = loadGlossary(uid).entries;
    expect(reloaded.some((e) => e.correct.includes('\u202E'))).toBe(true);
    expect(reloaded.some((e) => e.correct.includes('\x00'))).toBe(true);
    // 对照：同仓 memory 通道对同文本有 invisible-unicode 防线（两通道口径分裂）。
    const { scanForInjection } = require('../../src/main/features/memory');
    expect(scanForInjection('Victor\u202Eregal')).toBeTruthy();
  });

  it.skip('【待议 P-r4-3】漏洞：替换链把含控制字符的 correct 原样写进清理版文本', () => {
    upsertEntry(uid, { wrong: 'victor', correct: 'Victor\u202E 先生' });
    const entries = listEntries(uid, { status: 'active' });
    const scan = scanText('victor 发言支持该方案', entries);
    expect(scan.candidates.length).toBeGreaterThan(0);
    const applied = applyCorrections('victor 发言支持该方案', scan.candidates, { acceptRiskLevels: ['low', 'medium', 'high'] });
    // 清理版文本（另存进 KB 的会议纪要）携带 RTL override——其后的文字在支持
    // 双向算法的渲染器里反向显示（视觉欺骗向量）。
    expect(applied.text).toContain('\u202E');
  });
});
