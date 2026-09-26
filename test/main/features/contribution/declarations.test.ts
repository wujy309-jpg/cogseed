/**
 * 三项声明：齐备判定、不可由渲染层伪造的字段、以及 forked_from 的阻塞状态。
 *
 * 最后一组是本文件存在的主要理由。`C-FR-006` 要求派生副本自动预填来源并锁死类型，
 * 而迭代一把 `forked_from` 实现为只写不读且明示「Client-only — it never travels to Hub」。
 * 在 `CC-HUB-OPEN1-US3-US6-FORKED-FROM-READ-001` 裁决前，预填必须保持关闭——
 * 这条断言是为了让"有人顺手把预填打开"这件事变红，而不是静悄悄把一个本机私有
 * 字段送上 Hub。
 */
import { describe, expect, it } from 'vitest';

import {
  emptyDeclarations, declareOrigin, acceptTerms, confirmMaintenance,
  missingDeclarations, termsStale, isOriginType, prefillOrigin,
} from '../../../../src/main/features/contribution/declarations';

const TERMS = { version: '1.0', effective_at: '2026-09-20T00:00:00Z', body_markdown: '# 条款' };

describe('三项齐备判定指出缺项', () => {
  it('全空时三项都缺', () => {
    expect(missingDeclarations(emptyDeclarations())).toEqual(['origin', 'terms', 'maintenance']);
  });

  it('齐备后为空数组', () => {
    const d = emptyDeclarations();
    d.origin = declareOrigin('original', '');
    d.terms = acceptTerms(TERMS);
    d.maintenance = confirmMaintenance();
    expect(missingDeclarations(d)).toEqual([]);
  });

  it('只缺条款时只报条款 —— C-FR-005 要求指出缺项而非只拒绝', () => {
    const d = emptyDeclarations();
    d.origin = declareOrigin('original', '');
    d.maintenance = confirmMaintenance();
    expect(missingDeclarations(d)).toEqual(['terms']);
  });
});

describe('来源声明', () => {
  it.each(['original', 'derived_from_hub', 'third_party'])('接受类型 %s', (v) => {
    expect(isOriginType(v)).toBe(true);
  });

  it.each(['', 'other', 'ORIGINAL', null, 42])('拒绝非法类型 %s', (v) => {
    expect(isOriginType(v)).toBe(false);
  });

  it('第三方材料必须说明来源 —— 空说明等于没声明', () => {
    expect(() => declareOrigin('third_party', '   ')).toThrow('third_party_note_required');
  });

  it('原创可以不填说明', () => {
    expect(declareOrigin('original', '').type).toBe('original');
  });

  it('派生来源缺少不可变 forked_from 时拒绝', () => {
    expect(() => declareOrigin('derived_from_hub', '手填的派生说明')).toThrow('forked_from_required');
    expect(declareOrigin('derived_from_hub', '', { content_id: '8a4f01c29d7e', version: '1.0.0' }).forked_from)
      .toEqual({ content_id: '8a4f01c29d7e', version: '1.0.0' });
  });
});

describe('forked_from 预填保持关闭（受阻于未裁决的 CC）', () => {
  /**
   * 三处代码事实支撑这条断言：
   * - `src/main` 全仓零 `forked_from` 读取点；
   * - `marketplace/global-invariants.test.ts` 有一条全局不变量断言锁住；
   * - 字段注释逐字「Client-only — it never travels to Hub」。
   *
   * 裁决通过后改 `prefillOrigin` 一个函数即可，本用例届时同步更新——
   * 它变红正是提醒"这是个需要人类决定的开关"。
   */
  it('预填一律返回未预填、未锁定、无派生关联', () => {
    expect(prefillOrigin()).toEqual({ type: null, forked_from: null, locked: false });
  });
});

describe('条款版本不可由调用方伪造', () => {
  it('acceptTerms 只从条款对象取版本', () => {
    expect(acceptTerms(TERMS).version).toBe('1.0');
  });

  it('条款对象缺版本时抛错，不记一个空版本', () => {
    expect(() => acceptTerms({ version: '', effective_at: '', body_markdown: 'x' })).toThrow('terms_version_missing');
  });

  it('接受时间是本机生成的 ISO 串', () => {
    expect(acceptTerms(TERMS).accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('条款改版判定', () => {
  it('版本一致时不算过期', () => {
    expect(termsStale(acceptTerms(TERMS), TERMS)).toBe(false);
  });

  it('Hub 改版后判为过期 —— 要重新确认的是条款而不是内容', () => {
    const accepted = acceptTerms(TERMS);
    expect(termsStale(accepted, { ...TERMS, version: '1.1' })).toBe(true);
  });

  it('尚未接受或拿不到当前条款时不判过期', () => {
    expect(termsStale(null, TERMS)).toBe(false);
    expect(termsStale(acceptTerms(TERMS), null)).toBe(false);
  });
});
