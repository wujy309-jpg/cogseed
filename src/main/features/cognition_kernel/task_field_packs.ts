/**
 * cognition_kernel/task_field_packs — 任务字段需求包（S2）。
 *
 * 419/438 的"任务侧声明所需字段"：一个任务包声明它开工前需要哪些个人字段，
 * 由取件窗口（resolve.ts）算出"已有/缺"。字段名与两个参考实现对齐：
 *   报销 → expense-assistant 的 required_fields（工号/卡号/审批人/抬头…）
 *   招投标 → bid-assistant 的 A-box 个人节点（身份证号/执业资格/业绩…）
 *
 * 注意边界：包只声明"要哪些**个人**字段"；任务自己的结构（单据类目、字段定义）
 * 属于任务侧，不写进个人档案。
 */

import type { PersonalFieldRef } from './types';

export interface TaskFieldPack {
  id: string;
  title: string;
  /** 该任务开工前必须齐备的个人字段（顺序即提问顺序）。 */
  fields: readonly PersonalFieldRef[];
}

/** 报销（参考实现 expense-assistant / Jev 插件的 required_fields 归并去重）。 */
const EXPENSE_FIELDS: readonly PersonalFieldRef[] = [
  { fieldName: '姓名' },
  { fieldName: '工号' },
  { fieldName: '部门' },
  { fieldName: '岗位' },
  { fieldName: '银行卡号' },
  { fieldName: '开户行' },
  { fieldName: '审批人' },
  { fieldName: '成本中心' },
  { fieldName: '项目归属' },
  { fieldName: '发票抬头' },
  { fieldName: '纳税人识别号' },
  { fieldName: '常驻城市' },
  { fieldName: '住宿标准' },
  { fieldName: '常用交通工具' },
  { fieldName: '费用承担部门' },
  { fieldName: '联系电话' },
  { fieldName: '工作邮箱' },
  { fieldName: '提交窗口' },
  { fieldName: '是否需行程单' },
  { fieldName: '报销备注偏好' },
];

/** 招投标（参考实现 bid-assistant 的个人 A-box 节点）。 */
const BID_FIELDS: readonly PersonalFieldRef[] = [
  { fieldName: '姓名' },
  { fieldName: '身份证号' },
  { fieldName: '学历' },
  { fieldName: '执业资格证书编号' },
  { fieldName: '社保缴纳地' },
  { fieldName: '拟任项目角色' },
  { fieldName: '代表业绩' },
  { fieldName: '联系电话' },
  { fieldName: '工作邮箱' },
  { fieldName: '投标保证金账户' },
  { fieldName: '开户许可证号' },
  { fieldName: '公司授权代表' },
];

export const TASK_FIELD_PACKS: Record<string, TaskFieldPack> = {
  expense: { id: 'expense', title: '报销', fields: EXPENSE_FIELDS },
  bid: { id: 'bid', title: '招投标', fields: BID_FIELDS },
};

export function getTaskFieldPack(packId: string): TaskFieldPack | undefined {
  return TASK_FIELD_PACKS[String(packId ?? '').trim()];
}
