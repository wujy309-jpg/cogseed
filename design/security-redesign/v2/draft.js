// ─────────────────────────────────────────────────────────────────────────────
// 安全与信任 · 重构设计稿 v2「杀毒软件式状态页」(experiment)
// ─────────────────────────────────────────────────────────────────────────────
// v1 的问题：把 hero + 能力账本 + 组合风险 + 检查记录表 + 筛选器全铺在一页，
// 仍然是一张 dashboard。用户反馈「太繁琐」是对的。
//
// v2 的第一性原理借自杀毒/安全类软件（Windows 安全中心、火绒、Kaspersky、
// Bitdefender、Malwarebytes——建议自行打开对照）：
//
//   1. 主屏只回答一个问题：「我现在安全吗？」→ 一个状态图形 + 一句话 + 一个动作。
//   2. 主屏不放数字。没有评分、没有分数环、没有「规则 181 条」。
//      杀软主界面从不显示安全评分——分数无法行动，只制造焦虑。
//   3. 其余信息是**若干行**，每行「图标 + 名称 + 一句状态」，点开才展开细节。
//   4. 颜色只用在**出问题的那一行**。健康行是中性灰，不给绿色徽章。
//   5. 平面、少边框：行与行之间用发丝线，不嵌套卡片。
//
// 因此主屏从 5 个区块降到 2 个（状态 + 防护项），全部细节下沉为可展开行。
//
// 与共享层的关系：
//   - 按钮/胶囊/标签/图标/分段控件/骨架/抽屉仍然全部走真实 ui* 工厂。
//   - 行本身用页面本地 <details>（原生语义，零自写键盘逻辑）。共享的
//     uiAccordion 形状正确但**不能让单行带状态色**，缺 per-item tone。
//     落地前应给 uiAccordion 补 `tone`（记在 v2/README.md）。
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

  function ui(name, ...args) {
    const fn = window[name];
    if (typeof fn !== 'function') return '';
    try {
      return fn(...args);
    } catch (_) {
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

  function scoreBand(score) {
    if (typeof score !== 'number') return 'unknown';
    if (score >= 90) return 'ok';
    if (score >= 70) return 'warn';
    if (score >= 40) return 'mid';
    return 'bad';
  }

  function sevLabel(sev) { return t(`settings.security.sev_${sev}`); }

  function sevTone(sev) {
    if (sev === 'critical' || sev === 'high') return TONE_CRITICAL;
    if (sev === 'medium') return TONE_ATTENTION;
    return TONE_NEUTRAL;
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

  function integrityText(v) {
    return {
      verified: t('settings.security.integrity_verified'),
      tampered: t('settings.security.integrity_tampered'),
      unpinned: t('settings.security.integrity_unpinned'),
      unreadable: t('settings.security.integrity_unreadable'),
    }[v] || String(v || '—');
  }

  // 新增结构需要的新措辞。落地时必须补 settings.security.* i18n 键。
  const DX = {
    section: '防护项',
    row_skills: '技能检查',
    row_coverage: '检测能力',
    row_composition: '组合风险',
    scan_now: '立即检查',
    export_aria: '导出检查回执（脱敏）',
    st_skills: '{checked} 个已检查 · {blocked} 个被拦截',
    st_skills_clean: '{checked} 个已检查 · 无异常',
    st_coverage: '{ok} 可用 · {attention} 项降级',
    st_coverage_clean: '{ok} 项全部可用',
    st_composition_idle: '尚未分析',
    st_composition_paths: '发现 {n} 条组合路径',
    st_composition_clean: '未发现组合路径',
    tone_attention: '需要留意',
    tone_critical: '需要处理',
    tone_ok: '正常',
  };

  function dx(key, args) {
    let raw = DX[key] || key;
    if (args) {
      Object.keys(args).forEach((k) => { raw = String(raw).split(`{${k}}`).join(String(args[k])); });
    }
    return raw;
  }

  // ── 派生态 ────────────────────────────────────────────────────────────────

  function counts(state) {
    const out = { pass: 0, risk: 0, blocked: 0, unchecked: 0 };
    const seen = new Set();
    for (const r of state.receipts) {
      seen.add(r.skillId);
      if (out[r.decision] !== undefined) out[r.decision] += 1;
    }
    out.unchecked = Math.max(0, state.skills.length - seen.size);
    return out;
  }

  function scannerIsFaulty(state) {
    const st = state.status || {};
    if (st.scanner !== 'present' && st.scanner !== 'absent_by_build') return true;
    return st.scannerIntegrity === 'tampered' || st.declarationIntegrity === 'tampered';
  }

  function kind(state) {
    const st = state.status;
    if (!st) return 'bad';
    if (counts(state).blocked > 0) return 'bad';
    if (st.scanner !== 'present' && st.scanner !== 'absent_by_build') return 'bad';
    if (st.scannerIntegrity === 'tampered' || st.declarationIntegrity === 'tampered') return 'bad';
    if (st.scanner !== 'present' || st.scannerIntegrity !== 'verified' || st.declarationIntegrity !== 'verified') return 'warn';
    if ((st.capabilities || []).some((c) => c.status === 'degraded')) return 'warn';
    if (counts(state).risk > 0) return 'warn';
    return 'ok';
  }

  /** 库级评分 = 已检查技能里的最低分。与生产同口径。 */
  function libraryScore(state) {
    const scores = state.receipts
      .map((r) => (typeof r.securityScore === 'number' ? r.securityScore : null))
      .filter((n) => n !== null);
    return scores.length ? Math.min(...scores) : null;
  }

  function capabilityAttention(state) {
    return ((state.status || {}).capabilities || []).filter((c) => c.status !== 'implemented');
  }

  // ── 状态区 ────────────────────────────────────────────────────────────────
  // 一个图形 + 一句话 + 一行事实 + 一个动作。没有评分环、没有来源字段、
  // 没有分数。这是整版最重要的删减。

  /**
   * 评分环。**按用户要求保留**：生产页把「一个评分环 + 一句话」作为第一设计原则
   * （settings-security.js 文件头），评审确认这块不动。
   *
   * 这是本文件唯一的内联 <svg>，属数据可视化而非图标：半径/描边/stroke-dashoffset
   * 都由分数算出，静态 path 无法表达。沿用生产登记 SEC-PV-001-SVG。
   */
  function scoreRing(score, size) {
    const lg = size !== 'sm';
    const dim = lg ? 92 : 64;
    const stroke = lg ? 7 : 5;
    const r = (dim - stroke) / 2;
    const circumference = 2 * Math.PI * r;
    const value = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : null;
    const ratio = value === null ? 0 : value / 100;
    const band = scoreBand(value);
    const label = value === null ? '—' : String(value);
    return `<div class="sx2-ring sx2-ring--${band}${lg ? '' : ' sx2-ring--sm'}">
      <svg viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" role="img"
           aria-label="${esc(t('settings.security.ring_aria', { score: label }))}">
        <circle class="sx2-ring__track" cx="${dim / 2}" cy="${dim / 2}" r="${r}"
                fill="none" stroke-width="${stroke}"></circle>
        <circle class="sx2-ring__value" cx="${dim / 2}" cy="${dim / 2}" r="${r}"
                fill="none" stroke-width="${stroke}" stroke-linecap="round"
                stroke-dasharray="${circumference.toFixed(2)}"
                stroke-dashoffset="${(circumference * (1 - ratio)).toFixed(2)}"
                transform="rotate(-90 ${dim / 2} ${dim / 2})"></circle>
      </svg>
      <div class="sx2-ring__num">${esc(label)}</div>
      ${lg ? `<div class="sx2-ring__caption">${esc(t('settings.security.ring_caption'))}</div>` : ''}
    </div>`;
  }

  /**
   * Hero：**原样保留生产实现**（评分环 + 标题 + 状态胶囊 + 描述 + 5 个来源字段
   * + 三个动作按钮），评审明确要求这块不动。
   *
   * 因此这里刻意不做「去数字」「来源下沉」之类的简化——那是我原先的主张，
   * 已被否决。简化只作用于 hero 以下的区域。
   */
  function heroHtml(state) {
    const st = state.status || {};
    const k = kind(state);
    const level = k === 'bad' ? (scannerIsFaulty(state) ? 'alert' : 'blocked') : k;
    const title = level === 'ok' ? t('settings.security.hero_ok')
      : level === 'warn' ? t('settings.security.hero_attention')
        : level === 'blocked' ? t('settings.security.hero_blocked')
          : t('settings.security.hero_alert');
    const desc = level === 'ok' ? t('settings.security.hero_ok_desc')
      : level === 'warn' ? t('settings.security.hero_attention_desc')
        : level === 'blocked' ? t('settings.security.hero_blocked_desc')
          : t('settings.security.hero_alert_desc');

    const tagTone = k === 'ok' ? TONE_SUCCESS : k === 'warn' ? TONE_ATTENTION : TONE_CRITICAL;
    const tagText = k === 'ok' ? t('settings.security.tag_ok')
      : k === 'warn' ? t('settings.security.tag_attention') : t('settings.security.tag_alert');

    const last = state.receipts[0];
    const lastAt = last && last.scannedAt
      ? t('settings.security.last_checked_at', { time: relTime(last.scannedAt) }) : '';

    const scannerText = st.scanner === 'present' ? t('settings.security.scanner_present')
      : st.scanner === 'absent_by_build' ? t('settings.security.scanner_absent_build')
        : st.scanner === 'broken' ? t('settings.security.scanner_broken')
          : t('settings.security.status_unknown');
    const metaRow = (label, value) => value
      ? `<span class="sx2-meta-item"><span class="sx2-meta-label">${esc(label)}</span><b>${esc(value)}</b></span>`
      : '';

    return `<section class="sx2-hero" data-kind="${esc(k)}">
      ${scoreRing(libraryScore(state), 'lg')}
      <div class="sx2-hero__main">
        <h2 class="sx2-hero__title">
          <span>${esc(title)}</span>
          ${ui('uiStatusPill', { label: tagText, tone: tagTone })}
        </h2>
        <p class="sx2-hero__desc">${esc(desc)}${lastAt ? ` ${esc(lastAt)}` : ''}</p>
        <div class="sx2-hero__meta">
          ${metaRow(t('settings.security.scanner_label'), scannerText)}
          ${metaRow(t('settings.security.sentry_engine'),
            st.sentryEngineVersion ? `skill-sentry ${st.sentryEngineVersion}` : '')}
          ${metaRow(t('settings.security.ruleset'), st.sentryRulesetVersion || '')}
          ${metaRow(t('settings.security.rule_count'), st.rules && st.rules.total ? String(st.rules.total) : '')}
          ${metaRow(t('settings.security.integrity_label'), integrityText(st.scannerIntegrity))}
        </div>
      </div>
      <div class="sx2-hero__actions">
        ${ui('uiButton', {
          label: t('settings.security.refresh'), role: 'primary', size: 'sm', icon: 'refresh',
          attrs: { 'data-sx2-action': 'refresh' },
        })}
        ${ui('uiButton', {
          label: t('settings.security.check_one'), size: 'sm', icon: 'search',
          attrs: { 'data-sx2-action': 'toggle-picker', 'aria-expanded': state.pickerOpen ? 'true' : 'false' },
        })}
        ${ui('uiButton', {
          label: t('settings.security.export'), size: 'sm', icon: 'download',
          attrs: { 'data-sx2-action': 'export' },
        })}
      </div>
    </section>
    ${issuesHtml(state)}`;
  }

  /**
   * 降级/异常提示条。同样按用户要求保留生产行为。
   *
   * 注意与「检测能力」行的关系：这里点名**哪些**能力降级，行内是折叠的明细。
   * 主屏上没有重复——横幅是提醒，明细在展开后。这正是我原先主张删掉横幅时
   * 忽略的一点：横幅负责「不展开也能看见」。
   */
  function issuesHtml(state) {
    const k = kind(state);
    if (k === 'ok') return '';
    const st = state.status || {};
    const items = [];
    if (st.scanner === 'broken') {
      items.push({ icon: 'warning', text: t('settings.security.issue_scanner_broken') });
    } else if (st.scanner === 'absent_by_build') {
      items.push({ icon: 'info', text: t('settings.security.scanner_not_present_sub') });
    }
    if (st.scannerIntegrity === 'tampered' || st.declarationIntegrity === 'tampered') {
      items.push({ icon: 'warning', text: t('settings.security.hero_alert_desc') });
    } else if (st.scannerIntegrity !== 'verified' || st.declarationIntegrity !== 'verified') {
      items.push({ icon: 'info', text: t('settings.security.integrity_not_verified_sub') });
    }
    const degraded = (st.capabilities || []).filter((c) => c.status === 'degraded');
    if (degraded.length) {
      items.push({
        icon: 'info',
        text: t('settings.security.issue_degraded', {
          items: degraded.map((c) => t(`settings.security.cap_${c.id}`)).join('、'),
        }),
      });
    }
    if (!items.length) return '';
    return `<div class="sx2-issues" role="list">
      ${items.map((i) => `<div class="sx2-issue" role="listitem">
        <span class="sx2-issue__icon" aria-hidden="true">${icon(i.icon)}</span>
        <span>${esc(i.text)}</span></div>`).join('')}
    </div>`;
  }

  /** 「检查指定技能…」的选择器。生产页有这个交互，保留。 */
  function pickerHtml(state) {
    if (!state.pickerOpen) return '';
    const q = state.pickerQuery || '';
    const matches = state.skills
      .filter((sk) => !q
        || String(sk.id || '').toLowerCase().includes(q.toLowerCase())
        || String(sk.name || '').toLowerCase().includes(q.toLowerCase()))
      .slice(0, 50);
    const receiptById = new Map(state.receipts.map((r) => [r.skillId, r]));
    return `<section class="sx2-picker" aria-label="${esc(t('settings.security.check_one'))}">
      ${ui('uiInput', {
        id: 'sx2-picker-input', type: 'search', className: 'sx2-picker__input',
        placeholder: t('settings.security.search_placeholder'), value: q,
        attrs: { 'data-sx2-role': 'picker-input', 'aria-label': t('settings.security.search_placeholder') },
      })}
      <div class="sx2-picker__list" role="list">
        ${matches.length
          ? matches.map((sk) => {
            const rc = receiptById.get(sk.id);
            const busy = (state.checking || []).includes(sk.id);
            return `<div class="sx2-picker__item" role="listitem">
              <span class="sx2-picker__name">${esc(sk.id)}</span>
              <span class="sx2-picker__sub">${esc(sk.name || '')}${rc ? ` · ${esc(decisionText(rc.decision))}` : ''}</span>
              ${ui('uiButton', {
                label: busy ? t('settings.security.checking') : t('settings.security.check_action'),
                role: 'ghost', size: 'sm', loading: busy,
                attrs: { 'data-sx2-action': 'check', 'data-skill': sk.id },
              })}
            </div>`;
          }).join('')
          : ui('uiEmptyState', { kind: 'quiet', title: t('settings.security.picker_empty') })}
      </div>
    </section>`;
  }

  /**
   * 防护项一行。原生 <details>：键盘/无障碍行为由浏览器提供，
   * 页面不写任何 focus trap 或 keydown 逻辑。
   *
   * tone 只用于**出问题的行**；健康行 tone=null，保持中性。
   */
  function rowHtml(opts) {
    const tone = opts.tone || null;
    return `<details class="sx2-row"${tone ? ` data-tone="${esc(tone)}"` : ''}${opts.open ? ' open' : ''}>
      <summary>
        <span class="sx2-row__chevron" aria-hidden="true">${icon('chevron-right')}</span>
        <span class="sx2-row__icon" aria-hidden="true">${icon(opts.icon)}</span>
        <span class="sx2-row__title">${esc(opts.title)}</span>
        <span class="sx2-row__status">${esc(opts.status)}</span>
        ${tone ? `<span class="sx2-row__flag">${ui('uiStatusPill', {
          label: tone === TONE_CRITICAL ? dx('tone_critical') : dx('tone_attention'),
          tone,
        })}</span>` : ''}
      </summary>
      <div class="sx2-row__body">${opts.bodyHtml}</div>
    </details>`;
  }

  // ── 行内容：技能检查 ──────────────────────────────────────────────────────
  // 记录表从主屏下沉到这里。筛选仍用共享 uiSegmentedControl（唯一控件，
  // 不再有重复的文字摘要行）。

  function skillsBodyHtml(state) {
    const c = counts(state);
    const items = [
      { key: 'all', label: t('settings.security.stat_all'), count: state.skills.length },
      { key: 'pass', label: t('settings.security.stat_pass'), count: c.pass },
      { key: 'risk', label: t('settings.security.stat_risk'), count: c.risk },
      { key: 'blocked', label: t('settings.security.stat_blocked'), count: c.blocked },
      { key: 'unchecked', label: t('settings.security.stat_unchecked'), count: c.unchecked },
    ];
    const rows = state.filter === 'all'
      ? state.receipts
      : state.receipts.filter((r) => r.decision === state.filter);
    const empty = state.filter === 'all'
      ? ui('uiEmptyState', {
        kind: 'explained', title: t('settings.security.no_receipts'),
        hint: t('settings.security.no_receipts_hint'), icon: 'shield-check',
      })
      : ui('uiEmptyState', { kind: 'quiet', title: t('settings.security.no_receipts_filtered') });

    return `<div class="sx2-filter">
      ${ui('uiSegmentedControl', {
        ariaLabel: t('settings.security.stats_aria'),
        value: state.filter, items,
        attrs: { 'data-sx2-role': 'library-filter' },
      })}
    </div>
    <div class="sx2-tablewrap">
    <table class="sx2-table">
      <caption class="sx2-sr">${esc(t('settings.security.recent_title'))}</caption>
      <thead><tr>
        <th scope="col">${esc(t('settings.security.col_skill'))}</th>
        <th scope="col">${esc(t('settings.security.col_decision'))}</th>
        <th scope="col" class="is-num">${esc(t('settings.security.col_score'))}</th>
        <th scope="col" class="is-actions"><span class="sx2-sr">${esc(t('settings.security.col_actions'))}</span></th>
      </tr></thead>
      <tbody>${rows.length ? rows.map((r) => skillRow(state, r)).join('')
        : `<tr><td colspan="4">${empty}</td></tr>`}</tbody>
    </table>
    </div>
    <p class="sx2-note">${esc(t('settings.security.table_foot_hint'))}</p>`;
  }

  /**
   * 一行只保留 4 列。外层页面是 720px 窄栏，6 列会把右侧操作按钮挤出可视区
   * （实测被裁）。副标题也只留**本行特有**的信息：
   *   - 时间：每行不同，保留。
   *   - 规则库降级：只在该技能上出现，保留（能解释为什么分低）。
   *   - 扫描方式/隔离状态：每一行都一样，逐行重复是噪音，移入详情抽屉。
   */
  function skillRow(state, r) {
    const sub = [
      relTime(r.scannedAt),
      r.rulesDegraded ? t('skills.security_rules_degraded') : '',
    ].filter(Boolean).join(' · ');
    const busy = state.checking.includes(r.skillId);
    return `<tr data-skill="${esc(r.skillId)}">
      <td>
        <span class="sx2-skill">
          <span class="sx2-skill__badge" aria-hidden="true">${esc(String(r.skillId).slice(0, 1).toUpperCase())}</span>
          <span class="sx2-skill__body">
            <span class="sx2-skill__name">${esc(r.skillId)}</span>
            <span class="sx2-skill__sub">${esc(sub || '—')}</span>
          </span>
        </span>
      </td>
      <td>${ui('uiStatusPill', { label: decisionText(r.decision), tone: decisionTone(r.decision) })}</td>
      <td class="is-num">${scoreCell(r.securityScore)}</td>
      <td class="is-actions">
        <span class="sx2-rowacts">
          ${ui('uiButton', {
            label: t('settings.security.detail'), role: 'ghost', size: 'sm',
            attrs: { 'data-sx2-action': 'detail', 'data-skill': r.skillId },
          })}
          ${ui('uiIconButton', {
            label: `${t('settings.security.recheck')} ${r.skillId}`, icon: 'refresh', size: 'sm',
            attrs: { 'data-sx2-action': 'recheck', 'data-skill': r.skillId, 'aria-busy': busy ? 'true' : null },
          })}
        </span>
      </td>
    </tr>`;
  }

  function scoreCell(score) {
    if (typeof score !== 'number') return '<span class="sx2-score__num">—</span>';
    return `<span class="sx2-score">
      <span class="sx2-score__bar" role="img" aria-label="${esc(t('settings.security.score_aria', { score }))}">
        <i class="sx2-score__fill" data-band="${esc(scoreBand(score))}" style="width:${Math.max(4, Math.min(100, score))}%"></i>
      </span>
      <span class="sx2-score__num">${score}</span>
    </span>`;
  }

  // ── 行内容：检测能力 ──────────────────────────────────────────────────────

  function coverageBodyHtml(state) {
    const st = state.status || {};
    const caps = st.capabilities || [];
    if (!caps.length) {
      return ui('uiEmptyState', {
        kind: 'quiet', title: t('settings.security.scanner_not_present_sub'),
      });
    }
    const attention = caps.filter((c) => c.status !== 'implemented');
    const healthy = caps.filter((c) => c.status === 'implemented');
    const list = state.coverageExpanded ? [...attention, ...healthy] : attention;

    const rows = list.map((c) => `<li class="sx2-cap" data-status="${esc(c.status)}">
      ${ui('uiStatusDot', {
        tone: c.status === 'implemented' ? TONE_SUCCESS
          : (c.status === 'partial' || c.status === 'degraded') ? TONE_ATTENTION : TONE_NEUTRAL,
      })}
      <span class="sx2-cap__name">${esc(t(`settings.security.cap_${c.id}`))}</span>
      <span class="sx2-cap__state">${esc(capabilityStatusText(c.status))}${
        c.reason ? ` · ${esc(t(`settings.security.cap_reason_${c.reason}`))}` : ''}</span>
    </li>`).join('');

    const toggle = caps.length > attention.length
      ? ui('uiButton', {
        label: state.coverageExpanded
          ? `只显示 ${attention.length} 项降级`
          : `展开全部 ${caps.length} 项`,
        role: 'ghost', size: 'sm',
        iconEnd: state.coverageExpanded ? 'chevron-up' : 'chevron-down',
        attrs: { 'data-sx2-action': 'toggle-coverage' },
      })
      : '';

    const rules = st.rules || {};
    return `<ul class="sx2-caps">${rows}</ul>
      <div class="sx2-rowfoot">
        <span class="sx2-tags">
          ${rules.total ? ui('uiTag', { label: t('settings.security.rule_count_value', { n: rules.total }) }) : ''}
          ${rules.hardBlock ? ui('uiTag', { label: t('settings.security.hard_block_value', { n: rules.hardBlock }) }) : ''}
          ${(st.externalTools || []).map((tool) => ui('uiTag', {
            label: `${tool.id}${tool.available ? '' : ` · ${t('settings.security.tool_missing')}`}`,
            variant: tool.available ? 'success' : 'outline',
          })).join('')}
        </span>
        ${toggle}
      </div>`;
  }

  function capabilityStatusText(status) {
    if (status === 'implemented') return t('settings.security.cap_status_on');
    if (status === 'partial') return t('settings.security.cap_status_partial');
    if (status === 'degraded') return t('settings.security.cap_status_degraded');
    return t('settings.security.cap_status_off');
  }

  // ── 行内容：组合风险 ──────────────────────────────────────────────────────

  function compositionBodyHtml(state) {
    const comp = state.composition;
    const paths = (comp && comp.paths) || [];
    const runBtn = ui('uiButton', {
      label: state.compositionLoading
        ? t('settings.security.composition_running') : t('settings.security.composition_run'),
      role: 'secondary', size: 'sm', loading: state.compositionLoading,
      attrs: { 'data-sx2-action': 'run-composition' },
    });

    if (!comp) {
      return `<p class="sx2-note">${esc(t('settings.security.composition_idle_hint'))}</p>
        <div class="sx2-rowfoot"><span></span>${runBtn}</div>`;
    }
    if (!paths.length) {
      return `<p class="sx2-note">${esc(t('settings.security.composition_clean'))}</p>
        <div class="sx2-rowfoot"><span></span>${runBtn}</div>`;
    }
    const cov = comp.coverage || {};
    return `<p class="sx2-note">${esc(t('settings.security.composition_coverage', {
      analyzed: cov.analyzedSkills || 0,
      total: cov.resolvableSkills || cov.analyzedSkills || 0,
    }))}</p>
    <ul class="sx2-paths">
      ${paths.map((p) => `<li class="sx2-path" data-severity="${esc(p.severity)}">
        <span class="sx2-path__head">
          ${ui('uiStatusPill', {
            label: sevLabel(p.severity === 'high' ? 'high' : 'medium'),
            tone: p.severity === 'high' ? TONE_CRITICAL : TONE_ATTENTION,
          })}
          <span class="sx2-path__name">${esc(t(`settings.security.path_${p.id}`))}</span>
        </span>
        <span class="sx2-path__desc">${esc(t(`settings.security.path_${p.id}_desc`, {
          skills: p.participants.join(' → '),
        }))}</span>
        <span class="sx2-tags">
          ${p.capabilities.map((c) => ui('uiTag', { label: t(`settings.security.capability_${c}`) })).join('')}
          ${p.participants.map((id) => ui('uiButton', {
            label: id, role: 'ghost', size: 'sm',
            attrs: { 'data-sx2-action': 'detail', 'data-skill': id },
          })).join('')}
        </span>
      </li>`).join('')}
    </ul>
    <div class="sx2-rowfoot"><span></span>${runBtn}</div>`;
  }

  // ── 组装 ──────────────────────────────────────────────────────────────────

  function pageHtml(state) {
    const st = state.status || {};
    const c = counts(state);
    const attention = capabilityAttention(state);
    const comp = state.composition;
    const paths = (comp && comp.paths) || [];

    const skillsStatus = c.blocked > 0
      ? dx('st_skills', { checked: state.receipts.length, blocked: c.blocked })
      : dx('st_skills_clean', { checked: state.receipts.length });
    const coverageStatus = attention.length
      ? dx('st_coverage', {
        ok: ((st.capabilities || []).length - attention.length),
        attention: attention.length,
      })
      : dx('st_coverage_clean', { ok: (st.capabilities || []).length });

    return `
      ${heroHtml(state)}
      <section class="sx2-section">
        <h3 class="sx2-section__title">${esc(dx('section'))}</h3>
        <div class="sx2-rows">
          ${rowHtml({
            icon: 'shield-check',
            title: dx('row_skills'),
            status: skillsStatus,
            tone: c.blocked > 0 ? TONE_CRITICAL : (c.risk > 0 ? TONE_ATTENTION : null),
            open: state.openRow === 'skills',
            bodyHtml: skillsBodyHtml(state),
          })}
          ${rowHtml({
            icon: 'search',
            title: dx('row_coverage'),
            status: (st.capabilities || []).length ? coverageStatus : t('settings.security.scanner_not_present_sub'),
            tone: attention.length ? TONE_ATTENTION : null,
            open: state.openRow === 'coverage',
            bodyHtml: coverageBodyHtml(state),
          })}
          ${rowHtml({
            icon: 'git-branch',
            title: dx('row_composition'),
            status: !comp ? dx('st_composition_idle')
              : paths.length ? dx('st_composition_paths', { n: paths.length })
                : dx('st_composition_clean'),
            tone: paths.length ? TONE_ATTENTION : null,
            open: state.openRow === 'composition',
            bodyHtml: compositionBodyHtml(state),
          })}
        </div>
      </section>
      ${pickerHtml(state)}
      <p class="sx2-foot">${esc(t('settings.security.protection_sub'))}</p>`;
  }

  /** 技能详情抽屉内容（沿用共享 uiDrawer；只在点「详情」时用到）。 */
  function drawerBodyHtml(state) {
    const d = state.drawer || {};
    if (d.loading) {
      return ui('uiSkeleton', { ariaLabel: t('settings.security.loading'), lines: [46, 100, 88, 72] });
    }
    const e = d.evidence;
    if (!e) return ui('uiEmptyState', {
      kind: 'explained', title: t('settings.security.detail_failed'),
      hint: t('settings.security.detail_failed_hint'), icon: 'warning',
    });
    const sevFilter = d.filter || 'all';
    let findings = (e.findings || []).slice().sort((a, b) =>
      (SEV_ORDER[b.severity] - SEV_ORDER[a.severity]) || a.file.localeCompare(b.file));
    if (sevFilter === 'active') findings = findings.filter((f) => !f.suppressed);
    else if (sevFilter === 'suppressed') findings = findings.filter((f) => f.suppressed);
    else if (sevFilter !== 'all') findings = findings.filter((f) => f.severity === sevFilter);

    const sc = e.severityCounts || {};
    const verdictTone = e.hardBlocked || e.confirmedCritical ? TONE_CRITICAL
      : e.outcome === 'pass' ? TONE_SUCCESS
        : e.outcome === 'restricted' ? TONE_ATTENTION : TONE_NEUTRAL;
    const verdictLabel = e.hardBlocked ? t('settings.security.verdict_hard_blocked')
      : e.confirmedCritical ? t('settings.security.verdict_confirmed_critical')
        : e.outcome === 'pass' ? t('settings.security.decision_pass')
          : e.outcome === 'restricted' ? t('settings.security.decision_risk')
            : e.outcome === 'blocked' ? t('settings.security.decision_blocked')
              : t('settings.security.decision_unknown');

    // 列表行不再逐行重复「扫描方式 / 隔离状态」（每行都一样是噪音），
    // 改为在这里说明这一次检查是怎么做的。
    const rc = d.receipt || {};
    const howRows = [
      rc.scanner === 'deep' ? t('skills.security_scanner_deep')
        : rc.scanner ? t('skills.security_scanner_local') : '',
      rc.isolated ? '' : t('skills.security_not_isolated'),
      rc.rulesDegraded ? t('skills.security_rules_degraded') : '',
      typeof rc.violationCount === 'number' && rc.violationCount > 0
        ? `${rc.violationCount} ${t('settings.security.col_findings')}` : '',
    ].filter(Boolean);

    return `
      <div class="sx2-dwhead">
        ${ui('uiStatusPill', { label: verdictLabel, tone: verdictTone })}
        <span class="sx2-dwhead__score" data-band="${esc(scoreBand(e.score))}">${esc(String(e.score))}</span>
        <span class="sx2-dwhead__sep">·</span>
        <span class="sx2-note">${esc(fmtTime(e.scannedAt))}</span>
      </div>
      ${howRows.length ? `<p class="sx2-note sx2-dwhow">${esc(howRows.join(' · '))}</p>` : ''}
      <div class="sx2-filter">
        ${ui('uiSegmentedControl', {
          ariaLabel: t('settings.security.sev_filter_aria'),
          value: sevFilter,
          items: [
            { label: t('settings.security.filter_all'), value: 'all', count: (e.findings || []).length },
            { label: t('settings.security.filter_active'), value: 'active', count: (e.findings || []).filter((f) => !f.suppressed).length },
            ...SEVERITIES.filter((s) => (sc[s] || 0) > 0).map((s) => ({ label: sevLabel(s), value: s, count: sc[s] })),
          ],
          attrs: { 'data-sx2-role': 'sev-filter' },
        })}
      </div>
      ${findings.length ? `<ul class="sx2-findings">${findings.map(findingCard).join('')}</ul>`
        : ui('uiEmptyState', {
          kind: 'quiet',
          title: sevFilter === 'all' ? t('settings.security.no_findings') : t('settings.security.no_findings_filtered'),
        })}`;
  }

  function findingCard(f) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    const tags = [
      ...f.cwe.map((c) => ui('uiTag', { label: c })),
      ...f.owaspLlm.map((c) => ui('uiTag', { label: `OWASP ${c}` })),
      ...(f.owaspAst || []).map((c) => ui('uiTag', { label: c })),
    ].join(' ');
    return `<li class="sx2-finding" data-severity="${esc(f.severity)}">
      <span class="sx2-finding__head">
        ${ui('uiStatusPill', { label: sevLabel(f.severity), tone: sevTone(f.severity) })}
        <span class="sx2-finding__rule">${esc(f.ruleId)}</span>
        <span class="sx2-finding__loc">${esc(loc)}</span>
      </span>
      <span class="sx2-finding__desc">${esc(f.description)}</span>
      ${f.remediation ? `<span class="sx2-fix">
        <span class="sx2-fix__label">${esc(t('settings.security.field_remediation'))}</span>
        <span>${esc(f.remediation)}</span>
      </span>` : ''}
      ${tags ? `<details class="sx2-disc"><summary>标准映射</summary>
        <div class="sx2-tags">${tags}</div></details>` : ''}
    </li>`;
  }

  window.__sx2 = { pageHtml, drawerBodyHtml, scoreBand, kind, counts };
})();
