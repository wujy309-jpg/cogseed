/**
 * meeting.* IPC — 会议引用层（specs/013 · contracts/ipc.md · T013）
 *
 * 分层规则（照 transcript.ts:3-6，AGENTS.md §Layering）：本文件只做
 * **参数收敛 + 调用 features**，不写业务逻辑。所有 feature 调用都把
 * `ctx.userId` 作为首参，因此不存在"用当前活跃用户写别人的库"这条隐式路径。
 *
 * 通道列表（contracts/ipc.md §1 的完整规划；⏳ = features 未就绪，接线随
 * 对应任务（T034/T040/T050/T053/T054）补，不在 IPC 层预写空壳）：
 *   meeting.doc.get            —— 读统一文档模型（惰性创建；create:false 只读探测）
 *   meeting.assets.attach      —— 挂载资产引用（冻结版，幂等不覆盖 version）
 *   meeting.assets.detach      —— 摘除引用（只摘引用，不动资产）
 *   meeting.assets.list        —— 引用清单（现状对比/stale 是读时派生，T037）
 *   ⏳ meeting.conclusions.*    —— 纪要条目（T034/T035）
 *   ⏳ meeting.actions.*        —— 待办草稿（T040+，外发闸 assertActionDraftSendable）
 *   ⏳ meeting.refs.related     —— 跨会议关联（T050，只给建议不自动建立）
 *   ⏳ meeting.receipts.list    —— 回执汇总（T053，读既有 review-decision 账本过滤）
 *   ⏳ meeting.metrics.summary  —— 会议指标（T054，独立文件 meeting-metrics.jsonl）
 *
 * 错误口径：features 抛 `MeetingRefError` / `MeetingDocError`（带稳定 code 字段），
 * ipc/index.ts 的 dispatcher 会把 `err.code` 透传到 `{ ok:false, code }`——
 * 渲染层按 code 翻四语（kb.meetingRef.error_*），不上屏英文原文。
 */

import { safeId } from '../storage';
import * as meetingDoc from '../features/meeting_doc';
import * as meetingRefs from '../features/meeting_refs';

interface IpcContext {
  userId: string;
}

type Payload = Record<string, unknown>;

/** `docId` 非空 ≤1000（与 meeting_doc/meeting_refs 的 MAX_DOC_ID_CHARS 同界）。 */
function requireDocId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > meetingDoc.MAX_DOC_ID_CHARS) {
    throw new meetingDoc.MeetingDocError('invalid meeting docId', 'invalid_doc_id');
  }
  return id;
}

/** `assetId` 形状 + `safeId`（契约 §1.2：id 过 safeId，路径语义交给 features）。 */
function requireAssetId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 128 || !safeId(id)) {
    throw new meetingRefs.MeetingRefError('invalid meeting assetId', 'invalid_asset_id');
  }
  return id;
}

/** `via ∈ {attach, conclusion, action_draft}`（缺省 attach；语义归 features）。 */
function optionalVia(value: unknown): meetingRefs.MeetingRefVia | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'attach' || value === 'conclusion' || value === 'action_draft') return value;
  throw new meetingRefs.MeetingRefError('invalid meeting ref via', 'invalid_via');
}

export const invokeHandlers = {
  // ── 统一文档模型 ───────────────────────────────────────────────────────
  /**
   * `meeting.doc.get`：读/建/刷新会议文档（contracts/ipc.md §1.1）。
   * `displayPath` 只作展示标题（≤120 由 features 兜底截断）；说话人由主进程
   * 现算（渲染层不传正文/说话人，防时钟格式漂移事故）。`create:false` 且缺失
   * → `doc:null`（只读探测，不报错）。
   */
  'meeting.doc.get': async (payload: Payload, ctx: IpcContext) => {
    const docId = requireDocId(payload?.docId);
    const displayPath = typeof payload?.displayPath === 'string' ? payload.displayPath.trim() : '';
    if (displayPath.length > meetingDoc.MAX_TITLE_CHARS) {
      throw new meetingDoc.MeetingDocError('invalid meeting doc displayPath', 'invalid_input');
    }
    const create = payload?.create !== false;
    const doc = meetingDoc.getMeetingDoc(ctx.userId, docId, {
      create,
      ...(displayPath ? { title: displayPath } : {}),
    });
    return { doc, degraded: doc?.degraded ?? [] };
  },

  // ── 资产引用包 ─────────────────────────────────────────────────────────
  /**
   * `meeting.assets.attach`：挂载/确认一条资产引用（contracts/ipc.md §1.2）。
   * 准入判据、冻结版取值、幂等语义全在 meeting_refs（IPC 不重算）。
   */
  'meeting.assets.attach': async (payload: Payload, ctx: IpcContext) => {
    const docId = requireDocId(payload?.docId);
    const assetId = requireAssetId(payload?.assetId);
    const via = optionalVia(payload?.via);
    const { ref, pack } = await meetingRefs.attachMeetingAsset(ctx.userId, docId, assetId, via);
    return { ref, pack };
  },

  /** `meeting.assets.detach`：摘除一条引用（幂等：不存在时返回当前包）。 */
  'meeting.assets.detach': async (payload: Payload, ctx: IpcContext) => {
    const docId = requireDocId(payload?.docId);
    const assetId = requireAssetId(payload?.assetId);
    const pack = await meetingRefs.detachMeetingAsset(ctx.userId, docId, assetId);
    return { pack };
  },

  /** `meeting.assets.list`：本会议的引用清单（只读；缺失 → 空数组）。 */
  'meeting.assets.list': async (payload: Payload, ctx: IpcContext) => {
    const docId = requireDocId(payload?.docId);
    const refs = await meetingRefs.listMeetingAssetRefs(ctx.userId, docId);
    return { refs };
  },
};
