// ─────────────────────────────────────────────────────────────────────────────
// 安全与信任 · 重构设计稿（experiment）
// ─────────────────────────────────────────────────────────────────────────────
// 这不是生产模块。它只做一件事：用**真实的共享组件工厂**（window.ui*）和真实的
// 文案键（t()）渲染重构后的页面结构，供评审拍板后再落地到 settings-security.js。
//
// 刻意不做的三件事：
//   1. 不复制共享组件的外观 —— 按钮/筛选/胶囊/标签/抽屉/图标/骨架全部走 ui*。
//   2. 不引入第二套状态色板 —— 所有状态一律 uiStatusPill/uiStatusDot，
//      取值只用 success|attention|critical|neutral|idle（修掉生产页的 .sec-pill）。
//   3. 不用假进度 —— 时长未知的加载只用 uiSkeleton。
//
// 命名空间 sx-（security experiment）。若落地，样式并入页面自有块并登记
// renderer-structural-registry；组件调用方式无需改动。
// ─────────────────────────────────────────────────────────────────────────────

(() => {
  'use strict';

  const TONE_ATTENTION = 'attention';
  const TONE_CRITICAL = 'critical';
  const TONE_SUCCESS = 'success';
  const TONE_NEUTRAL = 'neutral';

  const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
  const SEV_ORDER = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /**
   * 与生产页同一份契约：共享工厂参数错误时返回空串而不是白屏。
   * 注意 factory 抛错会导致该控件消失，所以设计稿评审时要留意空位。
   */
  function ui(name, ...args) {
    const fn = window[name];
    if (typeof fn !== 'function') return '';
    try {
      return fn(...args);
    } catch (err) {
      if (window.__sxDraftDebug) console.warn('[draft] shared factory rejected', name, err);
      return '';
    }
  }

  function icon(name, cls) {
    return typeof window.uiIconHtml === 'function' ? window.uiIconHtml(name, cls || '') : '';
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function relTime(iso) {
    if (!iso) return t('settings.security.just_now_none');
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return t('settings.security.just_now_none');
    const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
    if (mins < 1) return t('settings.security.just_now');
    if (mins < 60) return t('settings.security.mins_ago', { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('settings.security.hours_ago', { n: hours });
    return t('settings.security.days_ago', { n: Math.floor(hours / 24) });
  }

  // ── 分档：唯一来源，评分环与分数条共用（与生产页同契约） ────────────────────
  function scoreBand(score) {
    if (typeof score !== 'number') return 'unknown';
    if (score >= 90) return 'ok';
    if (score >= 70) return 'warn';
    if (score >= 40) return 'mid';
    return 'bad';
  }

  /**
   * 评分环。生产版在 hero 用 92px、抽屉用 64px，视觉上两次都是主角。
   * 设计稿把环降为 68px 且只保留弧与数字（去掉环下的说明行内移），
   * 让「一句话结论」成为最强视觉元素。
   */
  function ring(score, opts = {}) {
    const size = opts.size === 'sm' ? 52 : 68;
    const stroke = opts.size === 'sm' ? 5 : 6;
    const r = (size - stroke) / 2;
    const circumference = 2 * Math.PI * r;
    const value = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : null;
    const ratio = value === null ? 0 : value / 100;
    const band = scoreBand(value);
    const label = value === null ? '—' : String(value);
    const caption = opts.caption
      ? `<div class="sx-ring__caption">${esc(opts.caption)}</div>` : '';
    return `<div class="sx-ring sx-ring--${band}${opts.size === 'sm' ? ' sx-ring--sm' : ''}"
      data-band="${esc(band)}">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"
           aria-label="${esc(t('settings.security.ring_aria', { score: label }))}">
        <circle class="sx-ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}"
                fill="none" stroke-width="${stroke}"></circle>
        <circle class="sx-ring__value" cx="${size / 2}" cy="${size / 2}" r="${r}"
                fill="none" stroke-width="${stroke}" stroke-linecap="round"
                stroke-dasharray="${circumference.toFixed(2)}"
                stroke-dashoffset="${(circumference * (1 - ratio)).toFixed(2)}"
                transform="rotate(-90 ${size / 2} ${size / 2})"></circle>
      </svg>
      <div class="sx-ring__num">${esc(label)}</div>
      ${caption}
    </div>`;
  }

  // ── 派生态 ────────────────────────────────────────────────────────────────

  function receiptCounts(state) {
    const counts = { pass: 0, risk: 0, blocked: 0, unchecked: 0 };
    const seen = new Set();
    for (const r of state.receipts) {
      seen.add(r.skillId);
      if (counts[r.decision] !== undefined) counts[r.decision] += 1;
    }
    counts.unchecked = Math.max(0, state.skills.length - seen.size);
    return counts;
  }

  function libraryScore(state) {
    const scores = state.receipts
      .map((r) => (typeof r.securityScore === 'number' ? r.securityScore : null))
      .filter((n) => n !== null);
    return scores.length ? Math.min(...scores) : null;
  }

  function scannerIsFaulty(state) {
    const st = state.status || {};
    if (st.scanner !== 'present' && st.scanner !== 'absent_by_build') return true;
    return st.scannerIntegrity === 'tampered' || st.declarationIntegrity === 'tampered';
  }

  function verdictKind(state) {
    const st = state.status;
    if (!st) return 'bad';
    const counts = receiptCounts(state);
    if (counts.blocked > 0) return 'bad';
    if (st.scanner !== 'present' && st.scanner !== 'absent_by_build') return 'bad';
    if (st.scannerIntegrity === 'tampered' || st.declarationIntegrity === 'tampered') return 'bad';
    if (st.scanner !== 'present' || st.scannerIntegrity !== 'verified' || st.declarationIntegrity !== 'verified') return 'warn';
    if ((st.capabilities || []).some((c) => c.status === 'degraded')) return 'warn';
    if (counts.risk > 0) return 'warn';
    return 'ok';
  }

  function decisionTone(decision) {
    if (decision === 'pass') return TONE_SUCCESS;
    if (decision === 'risk') return TONE_ATTENTION;
    if (decision === 'blocked') return TONE_CRITICAL;
    return TONE_NEUTRAL;
  }

  function decisionText(decision) {
    if (decision === 'pass') return t('settings.security.decision_pass');
    if (decision === 'risk') return t('settings.security.decision_risk');
    if (decision === 'blocked') return t('settings.security.decision_blocked');
    return t('settings.security.decision_unknown');
  }

  function sevTone(sev) {
    if (sev === 'critical' || sev === 'high') return TONE_CRITICAL;
    if (sev === 'medium') return TONE_ATTENTION;
    return TONE_NEUTRAL;
  }

  function sevLabel(sev) {
    return t(`settings.security.sev_${sev}`);
  }

  function integrityText(v) {
    return {
      verified: t('settings.security.integrity_verified'),
      tampered: t('settings.security.integrity_tampered'),
      unpinned: t('settings.security.integrity_unpinned'),
      unreadable: t('settings.security.integrity_unreadable'),
    }[v] || String(v || '—');
  }

  // 判定用的本地文案（新增结构需要新措辞；落地时必须补 i18n 键）。
  const DX = {
    source_disclosure: '检查来源与完整性',
    coverage_tally: '共 {total} 项能力 · {ok} 可用 · {attention} 项需要注意',
    coverage_expand: '展开全部 {n} 项',
    coverage_collapse: '只看向需要注意的项',
    blocked_title: '{n} 个技能被拦截',
    records_sr: '技能总数 {all}，已通过 {pass}，有提示 {risk}，已拦截 {blocked}，待检查 {unchecked}',
    finding_map: '标准映射与上下文',
    recheck_aria: '重新检查 {skill}',
    blocked_cta: '查看被拦截的技能',
  };

  function dx(key, args) {
    let raw = DX[key] || key;
    if (args) {
      Object.keys(args).forEach((k) => { raw = String(raw).split(`{${k}}`).join(String(args[k])); });
    }
    return raw;
  }

  // ── 1. 结论条 ─────────────────────────────────────────────────────────────

  function verdictHtml(state) {
    const st = state.status || {};
    const kind = verdictKind(state);
    const counts = receiptCounts(state);
    const tone = kind === 'ok' ? TONE_SUCCESS : kind === 'warn' ? TONE_ATTENTION : TONE_CRITICAL;
    const tagText = kind === 'ok' ? t('settings.security.tag_ok')
      : kind === 'warn' ? t('settings.security.tag_attention') : t('settings.security.tag_alert');

    const level = kind === 'bad' ? (scannerIsFaulty(state) ? 'alert' : 'blocked') : kind;
    const title = level === 'ok' ? t('settings.security.hero_ok')
      : level === 'warn' ? t('settings.security.hero_attention')
        : level === 'blocked' ? t('settings.security.hero_blocked')
          : t('settings.security.hero_alert');
    const desc = level === 'ok' ? t('settings.security.hero_ok_desc')
      : level === 'warn' ? t('settings.security.hero_attention_desc')
        : level === 'blocked' ? t('settings.security.hero_blocked_desc')
          : t('settings.security.hero_alert_desc');

    const last = state.receipts[0];
    const lastAt = last && last.scannedAt ? relTime(last.scannedAt) : '';

    // 关键改动一：主标题只留一句结论。
    // 生产版把「库内最低分 25」和「已拦截 1」并置后，标题里又出现一次「有技能被拦截」，
    // 读者要在两句里判断哪个是结论。这里拦截态直接给数量。
    const titleText = level === 'blocked'
      ? dx('blocked_title', { n: counts.blocked })
      : title;

    // 关键改动二：来源信息（引擎/规则包/条数/完整性）退入 disclosure。
    // 这些是溯源信息，不是「我现在该怎么办」。生产版把它们与结论等权铺在 hero。
    const sourceRows = [
      [t('settings.security.scanner_label'), st.scanner === 'present' ? t('settings.security.scanner_present')
        : st.scanner === 'absent_by_build' ? t('settings.security.scanner_absent_build')
          : st.scanner === 'broken' ? t('settings.security.scanner_broken')
            : t('settings.security.status_unknown')],
      [t('settings.security.sentry_engine'), st.sentryEngineVersion ? `skill-sentry ${st.sentryEngineVersion}` : '—'],
      [t('settings.security.ruleset'), st.sentryRulesetVersion || '—'],
      [t('settings.security.rule_count'), st.rules && st.rules.total ? String(st.rules.total) : '—'],
      [t('settings.security.integrity_label'), integrityText(st.scannerIntegrity)],
    ];

    const blockedCta = counts.blocked > 0
      ? ui('uiButton', {
        label: dx('blocked_cta'), role: 'primary', size: 'sm', iconEnd: 'arrow-right',
        attrs: { 'data-sx-action': 'show-blocked' },
      })
      : ui('uiButton', {
        label: t('settings.security.check_one'), role: 'primary', size: 'sm', icon: 'search',
        attrs: { 'data-sx-action': 'toggle-picker' },
      });

    return `<section class="sx-verdict" data-kind="${esc(kind)}">
      <div class="sx-verdict__ring">${ring(libraryScore(state), { caption: t('settings.security.ring_caption') })}</div>
      <div class="sx-verdict__body">
        <h2 class="sx-verdict__title">
          <span>${esc(titleText)}</span>
          ${ui('uiStatusPill', { label: tagText, tone })}
        </h2>
        <p class="sx-verdict__desc">${esc(desc)}</p>
        <div class="sx-verdict__meta">
          <span>${esc(t('settings.security.checked_count', { n: state.receipts.length }))}</span>
          ${lastAt ? `<span class="sx-verdict__meta-sep">·</span><span>${esc(t('settings.security.last_checked_at', { time: lastAt }))}</span>` : ''}
        </div>
        <details class="sx-disclosure">
          <summary>
            ${icon('chevron-right')}
            <span>${esc(dx('source_disclosure'))}</span>
          </summary>
          <div class="sx-disclosure__body">
            <dl class="sx-source">
              ${sourceRows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
            </dl>
          </div>
        </details>
      </div>
      <div class="sx-verdict__actions">
        ${blockedCta}
        ${ui('uiIconButton', {
          label: t('settings.security.refresh'), icon: 'refresh', size: 'sm',
          attrs: { 'data-sx-action': 'refresh' },
        })}
        ${ui('uiIconButton', {
          label: t('settings.security.export'), icon: 'download', size: 'sm',
          attrs: { 'data-sx-action': 'export' },
        })}
      </div>
    </section>`;
  }

  // ── 2. 内联提示 ───────────────────────────────────────────────────────────
  // 只保留**能力账本表达不了**的告警：扫描器缺失/被篡改属于组件级故障，
  // 与能力清单不是同一层信息。
  // 刻意**不再**渲染「以下能力处于降级状态」横幅：降级项已由下方账本置顶展示，
  // 两处都说一遍正是生产版要修的重复。
  function noticesHtml(state) {
    const st = state.status || {};
    const out = [];
    if (st.scanner === 'broken') {
      out.push({ tone: 'critical', icon: 'warning', text: t('settings.security.issue_scanner_broken') });
    }
    if (st.scannerIntegrity === 'tampered' || st.declarationIntegrity === 'tampered') {
      out.push({ tone: 'critical', icon: 'warning', text: t('settings.security.hero_alert_desc') });
    }
    if (!out.length) return '';
    return out.map((n) => `<div class="sx-notice" data-tone="${esc(n.tone)}" role="status">
      <span class="sx-notice__icon" aria-hidden="true">${icon(n.icon)}</span>
      <span>${esc(n.text)}</span>
    </div>`).join('');
  }

  // ── 3. 检测能力覆盖：默认只暴露需要注意的项 ─────────────────────────────────
  // 生产版默认摊开 14 格、每格一遍「可用」，约 300px 全是噪音，真正的 2 个降级项
  // 埋在网格底部第 12、13 格。这里把注意力倒过来：先给降级项，健康项折叠。
  function coverageHtml(state) {
    const st = state.status || {};
    const caps = st.capabilities || [];
    if (!caps.length) return '';

    const attention = caps.filter((c) => c.status !== 'implemented');
    const healthy = caps.filter((c) => c.status === 'implemented');
    const expanded = Boolean(state.coverageExpanded);
    // 两种状态都让「需要注意」排在最前，否则展开后又把降级项埋回列表末尾——
    // 那正是要修的问题。折叠态只含需要注意的项。
    const list = expanded ? [...attention, ...healthy] : attention;

    const rows = list.map((c) => {
      const reason = c.reason ? ` <span class="sx-ledger__reason">· ${esc(t(`settings.security.cap_reason_${c.reason}`))}</span>` : '';
      return `<li class="sx-ledger__item" data-status="${esc(c.status)}">
        ${ui('uiStatusDot', {
          tone: c.status === 'implemented' ? TONE_SUCCESS
            : (c.status === 'partial' || c.status === 'degraded') ? TONE_ATTENTION : TONE_NEUTRAL,
        })}
        <span class="sx-ledger__name">${esc(t(`settings.security.cap_${c.id}`))}</span>
        <span class="sx-ledger__state">${esc(capabilityStatusText(c.status))}${reason}</span>
      </li>`;
    }).join('');

    const tools = st.externalTools || [];
    const rules = st.rules || {};

    const tally = esc(dx('coverage_tally', {
      total: caps.length, ok: healthy.length, attention: attention.length,
    }));

    const toolChips = tools.map((tool) => ui('uiTag', {
      label: `${tool.id}${tool.available ? '' : ` · ${t('settings.security.tool_missing')}`}`,
      variant: tool.available ? 'success' : 'outline',
    })).join('');

    const toggle = caps.length > attention.length
      ? ui('uiButton', {
        label: expanded ? dx('coverage_collapse') : dx('coverage_expand', { n: caps.length }),
        role: 'ghost', size: 'sm',
        iconEnd: expanded ? 'chevron-up' : 'chevron-down',
        attrs: { 'data-sx-action': 'toggle-coverage', 'aria-expanded': expanded ? 'true' : 'false' },
      })
      : '';

    return `<section class="sx-section">
      <div class="sx-section__head">
        <div>
          <h3 class="sx-section__title">${esc(t('settings.security.coverage_title'))}</h3>
          <p class="sx-section__sub">${esc(t('settings.security.coverage_sub'))}</p>
        </div>
        <div class="sx-section__aside">
          ${rules.total ? ui('uiTag', { label: t('settings.security.rule_count_value', { n: rules.total }) }) : ''}
          ${rules.hardBlock ? ui('uiTag', { label: t('settings.security.hard_block_value', { n: rules.hardBlock }) }) : ''}
          ${(rules.groups || []).length ? ui('uiTag', { label: t('settings.security.rule_groups_value', { n: rules.groups.length }) }) : ''}
          ${st.interpreter ? ui('uiTag', { label: t('settings.security.interpreter_ok'), variant: 'success' }) : ''}
        </div>
      </div>
      <div class="sx-section__aside" style="margin-bottom:var(--space-3)">
        <span class="sx-tally">${tally}</span>
        ${tools.length ? `<span class="sx-tally__sep">·</span><span>${esc(t('settings.security.external_tools'))}</span> ${toolChips}` : ''}
      </div>
      <ul class="sx-ledger">${rows}</ul>
      ${toggle ? `<div style="margin-top:var(--space-3)">${toggle}</div>` : ''}
    </section>`;
  }

  function capabilityStatusText(status) {
    if (status === 'implemented') return t('settings.security.cap_status_on');
    if (status === 'partial') return t('settings.security.cap_status_partial');
    if (status === 'degraded') return t('settings.security.cap_status_degraded');
    return t('settings.security.cap_status_off');
  }

  // ── 4. 组合风险 ───────────────────────────────────────────────────────────
  // 生产版空态是 ~350px 的居中大图标 + 三行说明，把页面撑出一个洞。
  function compositionHtml(state) {
    const comp = state.composition;
    const paths = (comp && comp.paths) || [];
    const runBtn = ui('uiButton', {
      label: state.compositionLoading ? t('settings.security.composition_running') : t('settings.security.composition_run'),
      size: 'sm', loading: state.compositionLoading,
      attrs: { 'data-sx-action': 'run-composition' },
    });

    const head = `<div class="sx-section__head">
      <div>
        <h3 class="sx-section__title">${esc(t('settings.security.composition_title'))}</h3>
        <p class="sx-section__sub">${esc(t('settings.security.composition_sub'))}</p>
      </div>
      <div class="sx-section__aside">${runBtn}</div>
    </div>`;

    if (!comp) {
      return `<section class="sx-section">${head}
        <div class="sx-idle">
          <span class="sx-idle__icon" aria-hidden="true">${icon('git-branch')}</span>
          <span class="sx-idle__text"><b>${esc(t('settings.security.composition_idle'))}</b> · ${esc(t('settings.security.composition_idle_hint'))}</span>
        </div>
      </section>`;
    }

    if (!paths.length) {
      return `<section class="sx-section">${head}
        <div class="sx-idle">
          <span class="sx-idle__icon" aria-hidden="true">${icon('check')}</span>
          <span class="sx-idle__text"><b>${esc(t('settings.security.composition_clean'))}</b></span>
        </div>
      </section>`;
    }

    const coverage = (comp && comp.coverage) || {};
    const coverageLine = t('settings.security.composition_coverage', {
      analyzed: coverage.analyzedSkills || 0,
      total: coverage.resolvableSkills || coverage.analyzedSkills || 0,
    });

    return `<section class="sx-section">${head}
      <p class="sx-section__sub" style="margin-bottom:var(--space-3)">${esc(coverageLine)}</p>
      <ul class="sx-paths">
        ${paths.map((p) => `<li class="sx-path" data-severity="${esc(p.severity)}">
          <div class="sx-path__head">
            ${ui('uiStatusPill', { label: sevLabel(p.severity === 'high' ? 'high' : 'medium'), tone: p.severity === 'high' ? TONE_CRITICAL : TONE_ATTENTION })}
            <span class="sx-path__name">${esc(t(`settings.security.path_${p.id}`))}</span>
          </div>
          <p class="sx-path__desc">${esc(t(`settings.security.path_${p.id}_desc`, { skills: p.participants.join(' → ') }))}</p>
          <div class="sx-path__chain">
            ${p.capabilities.map((c) => ui('uiTag', { label: t(`settings.security.capability_${c}`) })).join('')}
            <span class="sx-path__arrow" aria-hidden="true">${icon('arrow-right')}</span>
            ${p.participants.map((id) => ui('uiButton', {
              label: id, role: 'ghost', size: 'sm',
              attrs: { 'data-sx-action': 'detail', 'data-skill': id },
            })).join('')}
          </div>
        </li>`).join('')}
      </ul>
      <p class="sx-section__sub" style="margin-top:var(--space-3)">${esc(t('settings.security.composition_caveat'))}</p>
    </section>`;
  }

  // ── 5. 检测记录 ───────────────────────────────────────────────────────────
  // 生产版把同一组数字渲染两遍：可见的文字摘要 + 紧随其后的分段控件。
  // 这里只保留分段控件作为唯一控件；为屏幕阅读器保留同一句话，但视觉隐藏。
  function recordsHtml(state) {
    const counts = receiptCounts(state);
    const items = [
      { key: 'all', label: t('settings.security.stat_all'), count: state.skills.length },
      { key: 'pass', label: t('settings.security.stat_pass'), count: counts.pass },
      { key: 'risk', label: t('settings.security.stat_risk'), count: counts.risk },
      { key: 'blocked', label: t('settings.security.stat_blocked'), count: counts.blocked },
      { key: 'unchecked', label: t('settings.security.stat_unchecked'), count: counts.unchecked },
    ];
    const rows = state.filter === 'all'
      ? state.receipts
      : state.receipts.filter((r) => r.decision === state.filter);
    const visible = state.expanded ? rows : rows.slice(0, 10);

    const srSummary = dx('records_sr', {
      all: state.skills.length, pass: counts.pass, risk: counts.risk,
      blocked: counts.blocked, unchecked: counts.unchecked,
    });

    const empty = state.filter === 'all'
      ? ui('uiEmptyState', {
        kind: 'explained', title: t('settings.security.no_receipts'),
        hint: t('settings.security.no_receipts_hint'), icon: 'shield-check',
      })
      : ui('uiEmptyState', { kind: 'quiet', title: t('settings.security.no_receipts_filtered') });

    return `<section class="sx-section">
      <div class="sx-section__head">
        <div>
          <h3 class="sx-section__title">${esc(t('settings.security.recent_title'))}</h3>
          <p class="sx-section__sub">${esc(t('settings.security.recent_sub'))}</p>
        </div>
        <div class="sx-section__aside">
          <span>${esc(t('settings.security.checked_count', { n: rows.length }))}</span>
        </div>
      </div>
      <div class="sx-records__filters">
        <p class="sx-visually-hidden">${esc(srSummary)}</p>
        ${ui('uiSegmentedControl', {
          ariaLabel: t('settings.security.stats_aria'),
          value: state.filter, items,
          attrs: { 'data-sx-role': 'library-filter' },
        })}
      </div>
      <div class="sx-table-wrap">
        <table class="sx-table">
          <caption class="sx-visually-hidden">${esc(t('settings.security.recent_title'))}</caption>
          <thead><tr>
            <th scope="col">${esc(t('settings.security.col_skill'))}</th>
            <th scope="col">${esc(t('settings.security.col_decision'))}</th>
            <th scope="col" class="is-num">${esc(t('settings.security.col_score'))}</th>
            <th scope="col" class="is-num is-optional">${esc(t('settings.security.col_findings'))}</th>
            <th scope="col" class="is-optional">${esc(t('settings.security.col_time'))}</th>
            <th scope="col" class="is-actions"><span class="sx-visually-hidden">${esc(t('settings.security.col_actions'))}</span></th>
          </tr></thead>
          <tbody>${visible.length ? visible.map((r) => recordRow(state, r)).join('')
            : `<tr><td colspan="6">${empty}</td></tr>`}</tbody>
        </table>
        <div class="sx-table-foot">
          <span>${esc(t('settings.security.table_foot_hint'))}</span>
          ${rows.length > 10 ? ui('uiButton', {
            label: state.expanded ? t('settings.security.view_recent') : t('settings.security.view_all'),
            role: 'ghost', size: 'sm',
            attrs: { 'data-sx-action': 'toggle-all' },
          }) : ''}
        </div>
      </div>
    </section>`;
  }

  function recordRow(state, r) {
    const sub = [
      r.scanner === 'deep' ? t('skills.security_scanner_deep') : t('skills.security_scanner_local'),
      r.rulesDegraded ? t('skills.security_rules_degraded') : '',
      r.isolated ? '' : t('skills.security_not_isolated'),
    ].filter(Boolean).join(' · ');
    const busy = state.checking.includes(r.skillId);
    const findings = typeof r.violationCount === 'number' && r.violationCount > 0 ? String(r.violationCount) : '—';
    return `<tr data-skill="${esc(r.skillId)}">
      <td>
        <div class="sx-skill">
          <span class="sx-skill__badge" aria-hidden="true">${esc(String(r.skillId).slice(0, 1).toUpperCase())}</span>
          <span class="sx-skill__body">
            <span class="sx-skill__name">${esc(r.skillId)}</span>
            <span class="sx-skill__sub">${esc(sub || '—')}</span>
          </span>
        </div>
      </td>
      <td>${ui('uiStatusPill', { label: decisionText(r.decision), tone: decisionTone(r.decision) })}</td>
      <td class="is-num">${scoreCell(r.securityScore)}</td>
      <td class="is-num is-optional">${esc(findings)}</td>
      <td class="is-optional"><span class="sx-time">${esc(relTime(r.scannedAt))}</span></td>
      <td class="is-actions">
        <div class="sx-row-actions">
          ${ui('uiButton', {
            label: t('settings.security.detail'), role: 'ghost', size: 'sm',
            attrs: { 'data-sx-action': 'detail', 'data-skill': r.skillId },
          })}
          ${ui('uiIconButton', {
            label: dx('recheck_aria', { skill: r.skillId }), icon: 'refresh', size: 'sm',
            variant: busy ? 'plain' : 'plain',
            attrs: { 'data-sx-action': 'recheck', 'data-skill': r.skillId, 'aria-busy': busy ? 'true' : null },
          })}
        </div>
      </td>
    </tr>`;
  }

  function scoreCell(score) {
    if (typeof score !== 'number') return '<span class="sx-score__num">—</span>';
    const band = scoreBand(score);
    return `<div class="sx-score">
      <span class="sx-score__bar" role="img" aria-label="${esc(t('settings.security.score_aria', { score }))}">
        <i class="sx-score__fill" data-band="${esc(band)}" style="width:${Math.max(4, Math.min(100, score))}%"></i>
      </span>
      <span class="sx-score__num">${score}</span>
    </div>`;
  }

  // ── 6. 抽屉内容 ───────────────────────────────────────────────────────────

  function drawerBodyHtml(state) {
    const d = state.drawer || {};
    if (d.loading) {
      // 时长未知 → 只用 uiSkeleton。生产版同时渲染了一个固定 40% 的
      // uiProgressBar，既声称确定性进度，又和骨架屏互相竞争注意力。
      const stages = [
        t('settings.security.progress_rules'),
        t('settings.security.progress_text'),
        t('settings.security.progress_binary'),
        t('settings.security.progress_deps'),
        t('settings.security.progress_instruction'),
      ];
      return `<div>
        <ol class="sx-stages">${stages.map((s, i) => `<li class="${i === 0 ? 'is-active' : ''}">${esc(s)}</li>`).join('')}</ol>
        <div style="margin-top:var(--space-4)">
          ${ui('uiSkeleton', { ariaLabel: t('settings.security.loading'), lines: [46, 100, 88, 72] })}
        </div>
        <div style="margin-top:var(--space-3)">
          ${ui('uiSkeleton', { ariaLabel: t('settings.security.loading'), lines: [92, 64] })}
        </div>
      </div>`;
    }
    const e = d.evidence;
    if (!e) return ui('uiEmptyState', {
      kind: 'explained', title: t('settings.security.detail_failed'),
      hint: t('settings.security.detail_failed_hint'), icon: 'warning',
    });

    const counts = e.severityCounts || {};
    const acceptances = d.acceptances || [];
    const sevFilter = d.filter || 'all';
    let findings = (e.findings || []).slice().sort((a, b) =>
      (SEV_ORDER[b.severity] - SEV_ORDER[a.severity]) || a.file.localeCompare(b.file));
    if (sevFilter === 'active') findings = findings.filter((f) => !f.suppressed);
    else if (sevFilter === 'suppressed') findings = findings.filter((f) => f.suppressed);
    else if (sevFilter !== 'all') findings = findings.filter((f) => f.severity === sevFilter);

    const verdictTone = e.hardBlocked || e.confirmedCritical ? TONE_CRITICAL
      : e.outcome === 'pass' ? TONE_SUCCESS
        : e.outcome === 'restricted' ? TONE_ATTENTION : TONE_NEUTRAL;
    const verdictLabel = e.hardBlocked ? t('settings.security.verdict_hard_blocked')
      : e.confirmedCritical ? t('settings.security.verdict_confirmed_critical')
        : e.outcome === 'pass' ? t('settings.security.decision_pass')
          : e.outcome === 'restricted' ? t('settings.security.decision_risk')
            : e.outcome === 'blocked' ? t('settings.security.decision_blocked')
              : t('settings.security.decision_unknown');

    const notes = [];
    if (!e.isolated) notes.push({ tone: 'attention', icon: 'warning', text: t('settings.security.notice_not_isolated') });
    if (e.rulesDegraded) notes.push({ tone: 'attention', icon: 'warning', text: t('settings.security.notice_rules_degraded') });
    if (e.coverage && (e.coverage.derivedFindings || 0) > 0) {
      notes.push({
        tone: 'attention', icon: 'info',
        text: t('settings.security.notice_derived', {
          n: e.coverage.derivedFindings,
          views: Object.keys(e.coverage.derivedViews || {}).join('、'),
        }),
      });
    }
    if (e.coverage && e.coverage.externalTools
      && Object.values(e.coverage.externalTools).some((v) => v && v !== 'OK' && v !== 'static-only')) {
      notes.push({ tone: 'attention', icon: 'info', text: t('settings.security.notice_external_tools') });
    }

    return `
      <div class="sx-dw-hero">
        ${ring(e.score, { size: 'sm' })}
        <div class="sx-dw-hero__main">
          <div class="sx-dw-verdict">
            ${ui('uiStatusPill', { label: verdictLabel, tone: verdictTone })}
            ${ui('uiTag', {
              label: e.scanTier === 'sandboxed' ? t('settings.security.tier_sandboxed') : t('settings.security.tier_static'),
              variant: e.scanTier === 'sandboxed' ? 'success' : 'outline',
            })}
          </div>
          <dl class="sx-dw-meta">
            <div><dt>${esc(t('settings.security.field_scanned_at'))}</dt><dd>${esc(fmtTime(e.scannedAt))}</dd></div>
            ${e.scannerVersion ? `<div><dt>${esc(t('settings.security.sentry_engine'))}</dt><dd>${esc(e.scannerVersion)}</dd></div>` : ''}
            ${e.rulesetVersion ? `<div><dt>${esc(t('settings.security.ruleset'))}</dt><dd>${esc(e.rulesetVersion)}</dd></div>` : ''}
            ${e.recommendation ? `<div><dt>${esc(t('settings.security.field_recommendation'))}</dt><dd>${esc(e.recommendation)}</dd></div>` : ''}
          </dl>
        </div>
      </div>
      ${notes.length ? `<ul class="sx-notes">${notes.map((n) => `<li data-tone="${esc(n.tone)}">
        ${icon(n.icon)}<span>${esc(n.text)}</span></li>`).join('')}</ul>` : ''}
      <div>
        ${ui('uiSegmentedControl', {
          ariaLabel: t('settings.security.sev_filter_aria'),
          value: sevFilter,
          items: [
            { label: t('settings.security.filter_all'), value: 'all', count: (e.findings || []).length },
            { label: t('settings.security.filter_active'), value: 'active', count: (e.findings || []).filter((f) => !f.suppressed).length },
            ...SEVERITIES.filter((s) => (counts[s] || 0) > 0).map((s) => ({ label: sevLabel(s), value: s, count: counts[s] })),
            ...(acceptances.length ? [{ label: t('settings.security.filter_suppressed'), value: 'suppressed', count: (e.findings || []).filter((f) => f.suppressed).length }] : []),
          ],
          attrs: { 'data-sx-role': 'sev-filter' },
        })}
      </div>
      <div style="margin-top:var(--space-3)">
        ${findings.length
          ? `<ul class="sx-findings">${findings.map((f) => findingCard(f, acceptances)).join('')}</ul>`
          : ui('uiEmptyState', {
            kind: 'quiet',
            title: sevFilter === 'all' ? t('settings.security.no_findings') : t('settings.security.no_findings_filtered'),
          })}
      </div>
      ${breakdownHtml(e.scoreBreakdown)}
      ${frameworkHtml(e.frameworkSummary)}
      ${coverageDetailHtml(e)}
      ${limitationsHtml(e)}`;
  }

  function findingCard(f, acceptances) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    const accepted = (acceptances || []).find((a) => a.fingerprint === f.fingerprint);
    // 标准编号与上下文折进 disclosure：生产版每张卡摊开 7 个标签并换行。
    const tags = [
      ...f.cwe.map((c) => ui('uiTag', { label: c })),
      ...f.owaspLlm.map((c) => ui('uiTag', { label: `OWASP ${c}` })),
      ...f.owaspAgentic.map((c) => ui('uiTag', { label: c })),
      ...(f.owaspAst || []).map((c) => ui('uiTag', { label: c })),
    ].join(' ');

    const badges = [
      f.hardBlock ? ui('uiBadge', { label: t('settings.security.badge_hard_block'), tone: TONE_CRITICAL }) : '',
      f.demoted ? ui('uiBadge', { label: t('settings.security.badge_demoted', { level: sevLabel(f.originalSeverity) }), tone: TONE_NEUTRAL }) : '',
      f.suppressed ? ui('uiBadge', { label: t('settings.security.badge_suppressed'), tone: TONE_NEUTRAL }) : '',
      f.suppressionRefused ? ui('uiBadge', { label: t('settings.security.badge_suppression_refused'), tone: TONE_CRITICAL }) : '',
      f.derived ? ui('uiBadge', {
        label: t(`settings.security.derived_${f.derived}`) === `settings.security.derived_${f.derived}`
          ? t('settings.security.derived_generic', { view: f.derived })
          : t(`settings.security.derived_${f.derived}`),
        tone: TONE_ATTENTION,
      }) : '',
    ].filter(Boolean).join('');

    return `<li class="sx-finding" data-severity="${esc(f.severity)}" data-suppressed="${f.suppressed ? '1' : '0'}">
      <div class="sx-finding__head">
        ${ui('uiStatusPill', { label: sevLabel(f.severity), tone: sevTone(f.severity) })}
        <span class="sx-finding__rule">${esc(f.ruleId)}</span>
        <span class="sx-finding__loc">${esc(loc)}</span>
        ${badges}
      </div>
      <p class="sx-finding__desc">${esc(f.description)}</p>
      ${f.remediation ? `<div class="sx-fix">
        <span class="sx-fix__label">${icon('arrow-right')}${esc(t('settings.security.field_remediation'))}</span>
        <span class="sx-fix__text">${esc(f.remediation)}</span>
      </div>` : ''}
      <details class="sx-disclosure">
        <summary>${icon('chevron-right')}<span>${esc(dx('finding_map'))}</span></summary>
        <div class="sx-disclosure__body">
          ${tags ? `<div class="sx-tags">${tags}</div>` : ''}
          <dl class="sx-map">
            <div><dt>${esc(t('settings.security.field_confidence'))}</dt><dd>${esc(t(`settings.security.conf_${f.confidence}`))}</dd></div>
            <div><dt>${esc(t('settings.security.field_context'))}</dt><dd>${esc(t(`settings.security.ctx_${f.context}`) === `settings.security.ctx_${f.context}` ? f.context : t(`settings.security.ctx_${f.context}`))}</dd></div>
            <div><dt>${esc(t('settings.security.field_category'))}</dt><dd>${esc(f.category)}</dd></div>
          </dl>
          ${f.references && f.references.length ? `<div class="sx-tags">${f.references.slice(0, 3).map((url) =>
            `<a href="${esc(url)}" target="_blank" rel="noreferrer noopener">${esc(url.replace(/^https?:\/\//, ''))}</a>`).join('')}</div>` : ''}
        </div>
      </details>
      <div class="sx-finding__actions">
        <span class="sx-finding__note">${esc(findingNote(f, accepted))}</span>
        ${findingAction(f, accepted)}
      </div>
    </li>`;
  }

  function findingNote(f, accepted) {
    if (f.suppressed && accepted) {
      return t('settings.security.accepted_until', { time: fmtTime(accepted.expiresAt) });
    }
    if (f.suppressionRefused) return t('settings.security.accept_refused_note');
    if (f.hardBlock || f.severity === 'critical' || f.severity === 'high') {
      return t('settings.security.accept_unavailable');
    }
    return '';
  }

  function findingAction(f, accepted) {
    if (f.suppressed) {
      return accepted ? ui('uiButton', {
        label: t('settings.security.revoke_accept'), role: 'ghost', size: 'sm',
        attrs: { 'data-sx-action': 'revoke', 'data-fingerprint': f.fingerprint },
      }) : '';
    }
    if (f.suppressionRefused) return '';
    if (f.hardBlock || f.severity === 'critical' || f.severity === 'high') return '';
    return ui('uiButton', {
      label: t('settings.security.accept_risk'), role: 'ghost', size: 'sm',
      attrs: {
        'data-sx-action': 'accept', 'data-fingerprint': f.fingerprint,
        'data-rule': f.ruleId, 'data-file': f.file, 'data-severity': f.severity,
      },
    });
  }

  function breakdownHtml(bd) {
    if (!bd || !(bd.byCategory || []).length) return '';
    const rows = bd.byCategory.filter((c) => c.penalty > 0);
    if (!rows.length) return '';
    return `<section class="sx-dw-section">
      <h4 class="sx-dw-title">${esc(t('settings.security.breakdown_title'))}</h4>
      <p class="sx-dw-sub">${esc(t('settings.security.breakdown_sub', { raw: bd.rawPenalty, penalty: bd.penalty }))}</p>
      <ul class="sx-breakdown">
        ${rows.map((c) => `<li>
          <span class="sx-breakdown__name">${esc(t(`settings.security.cat_${c.category}`) === `settings.security.cat_${c.category}` ? c.category : t(`settings.security.cat_${c.category}`))}</span>
          <span class="sx-breakdown__bar"><i style="width:${Math.max(3, Math.min(100, (c.penalty / Math.max(1, bd.penalty)) * 100))}%"></i></span>
          <span class="sx-breakdown__num">-${esc(String(c.penalty))}${c.capped ? esc(t('settings.security.breakdown_capped')) : ''}</span>
          <span class="sx-breakdown__count">${esc(t('settings.security.breakdown_hits', { n: c.count }))}</span>
        </li>`).join('')}
      </ul>
      ${(bd.floors || []).length ? `<p class="sx-dw-sub">${esc(t('settings.security.breakdown_floor', { floors: bd.floors.map((f) => t(`settings.security.floor_${f}`)).join('、') }))}</p>` : ''}
    </section>`;
  }

  function frameworkHtml(fw) {
    if (!fw) return '';
    const groups = [
      { label: t('settings.security.framework_ast'), items: fw.owaspAst || [] },
      { label: t('settings.security.framework_llm'), items: fw.owaspLlm || [] },
      { label: t('settings.security.framework_agentic'), items: fw.owaspAgentic || [] },
    ].filter((g) => g.items.length);
    if (!groups.length) return '';
    return `<details class="sx-disclosure sx-dw-section">
      <summary>${icon('chevron-right')}<span>${esc(t('settings.security.framework_title'))}</span></summary>
      <div class="sx-disclosure__body">
        <p class="sx-dw-sub">${esc(t('settings.security.framework_sub'))}</p>
        ${groups.map((g) => `<div style="margin-bottom:var(--space-2)">
          <div class="sx-dw-sub" style="margin:0 0 var(--space-1)">${esc(g.label)}</div>
          <div class="sx-tags">${g.items.map((item) => ui('uiTag', {
            label: `${item.id} · ${item.count}`, variant: 'accent',
            attrs: { title: item.title || item.id },
          })).join('')}</div>
        </div>`).join('')}
      </div>
    </details>`;
  }

  function coverageDetailHtml(e) {
    const c = e.coverage;
    if (!c) return '';
    const rows = [
      [t('settings.security.cov_files'), String(c.filesScanned)],
      [t('settings.security.cov_rules'), String(c.ruleCount)],
      [t('settings.security.cov_hard_block'), String(c.hardBlockRules)],
      [t('settings.security.cov_ruleset'), c.rulesetResolved ? (c.rulesetVersion || '—') : t('settings.security.cov_builtin')],
      [t('settings.security.cov_tier'), c.scanTier === 'sandboxed' ? t('settings.security.tier_sandboxed') : t('settings.security.tier_static')],
      [t('settings.security.cov_views'), String(Object.keys(c.derivedViews || {}).length)],
    ];
    return `<details class="sx-disclosure sx-dw-section">
      <summary>${icon('chevron-right')}<span>${esc(t('settings.security.coverage_detail_title'))}</span></summary>
      <div class="sx-disclosure__body">
        <dl class="sx-kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      </div>
    </details>`;
  }

  function limitationsHtml(e) {
    if (!(e.limitations || []).length) return '';
    return `<details class="sx-disclosure sx-dw-section">
      <summary>${icon('chevron-right')}<span>${esc(t('settings.security.limitations_title'))}</span></summary>
      <div class="sx-disclosure__body">
        <ul class="sx-notes">${e.limitations.map((l) => `<li>${icon('info')}<span>${esc(l)}</span></li>`).join('')}</ul>
      </div>
    </details>`;
  }

  // ── 7. 组装 ───────────────────────────────────────────────────────────────

  function pageHtml(state) {
    return `
      ${verdictHtml(state)}
      ${noticesHtml(state)}
      ${coverageHtml(state)}
      ${compositionHtml(state)}
      ${recordsHtml(state)}
      <div class="sx-foot">
        ${icon('lock')}
        <span>${esc(t('settings.security.protection_sub'))}</span>
      </div>`;
  }

  window.__sxDraft = {
    scoreBand, ring, pageHtml, drawerBodyHtml,
    verdictKind, receiptCounts, libraryScore,
  };
})();
