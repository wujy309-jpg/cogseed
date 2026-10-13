import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf8');

/**
 * 只改状态的同步（Hub 停用、要求的客户端版本变化）不会"拉取新内容"，界面原来不刷新卡片，
 * 用户会继续点一个其实已被停用的 Agent。主进程在本机安装记录有任何变化时推送
 * `marketplace:installs-changed`，渲染进程据此重读 Agent / Skill 列表。
 * 这里锁住这条链路的三个接点，防止被改回只在 `pulled > 0` 时刷新。
 */
describe('marketplace:installs-changed 链路', () => {
  it('主进程：同步结束后，任何本机变化（含只改状态的更新）都广播该事件', () => {
    const main = read('src/main/index.ts');
    expect(main).toMatch(/serverCheck\.updated_agents/);
    expect(main).toMatch(/serverCheck\.updated_skills/);
    expect(main).toMatch(/broadcastToRenderer\('marketplace:installs-changed'/);
  });

  it('预加载白名单按 marketplace: 前缀放行，无需另行登记', () => {
    const preload = read('src/main/preload.js');
    const line = preload.split('\n').find((l) => l.includes('PUSH_EVENT_PREFIXES ='));
    expect(line).toContain("'marketplace:'");
  });

  it('渲染进程：订阅该事件并复用同一份刷新逻辑；原有"拉取新内容后刷新"仍走它', () => {
    const renderer = read('src/renderer/modules/marketplace.js');
    expect(renderer).toMatch(/onPushEvent\('marketplace:installs-changed',\s*\(\)\s*=>\s*\{\s*_mpRefreshInstalledCaches\(\)/);
    expect(renderer).toMatch(/status\.pulled > 0\) \{\s*_mpRefreshInstalledCaches\(\)/);
    expect(renderer).toMatch(/function _mpRefreshInstalledCaches\(\)/);
  });
});
