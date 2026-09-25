/**
 * 扩权确认记忆（specs/010 T007 / US-303）。
 *
 * 守三条：
 *   ① 幂等——同键（assetId@toVersion）重复确认只保留一条；
 *   ② 有界——ack 列表保留最近 500 条，超出截断最旧；
 *   ③ 撤销生效——删键即恢复打扰；且 ack 文件里只有 id/版本/档位/时间，
 *      不含资产正文（T040 隐私口径的读盘原文断言）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let previousRoot: string | undefined;

beforeEach(() => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-esc-ack-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
});
afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const UID = 'u-esc-ack';

function ackFile(): string {
  return path.join(tmpDir, UID, 'cloud', 'recall', 'records', 'sensitivity-escalation-settings', 'settings.json');
}

async function modules() {
  return import('../../../../src/main/features/recall/escalation-ack-service');
}

describe('escalation ack service (specs/010 T007)', () => {
  it('defaults to an empty acknowledged list on first read (no migration needed)', async () => {
    const { readEscalationAcks } = await modules();
    const settings = await readEscalationAcks(UID);
    expect(settings.acknowledged).toEqual([]);
    expect(settings.schemaVersion).toBe(1);
  });

  it('acknowledges idempotently: the same assetId@toVersion stays a single entry', async () => {
    const { readEscalationAcks, acknowledgeEscalation } = await modules();
    await acknowledgeEscalation(UID, 'aa-1', '3', 'L2');
    await acknowledgeEscalation(UID, 'aa-1', '3', 'L2');
    const settings = await readEscalationAcks(UID);
    expect(settings.acknowledged).toHaveLength(1);
    expect(settings.acknowledged[0].key).toBe('aa-1@3');
    // 新 toVersion 是新键：新的提级必然重报（US-303 Edge Case）。
    await acknowledgeEscalation(UID, 'aa-1', '4', 'L2');
    expect((await readEscalationAcks(UID)).acknowledged.map((ack) => ack.key).sort())
      .toEqual(['aa-1@3', 'aa-1@4']);
  });

  it('bounds the list to the most recent 500 entries', async () => {
    const { readEscalationAcks, acknowledgeEscalation } = await modules();
    for (let i = 0; i < 505; i += 1) {
      await acknowledgeEscalation(UID, `aa-${i}`, String(i));
    }
    const settings = await readEscalationAcks(UID);
    expect(settings.acknowledged).toHaveLength(500);
    expect(settings.acknowledged[0].key).toBe('aa-5@5');
    expect(settings.acknowledged[499].key).toBe('aa-504@504');
  });

  it('revokes an ack by key — deleting it restores the nagging', async () => {
    const { readEscalationAcks, acknowledgeEscalation, revokeEscalationAck } = await modules();
    await acknowledgeEscalation(UID, 'aa-9', '2', 'L1');
    const settings = await readEscalationAcks(UID);
    await revokeEscalationAck(UID, settings.acknowledged[0].key);
    expect((await readEscalationAcks(UID)).acknowledged).toEqual([]);
    // 撤销不存在的键不报错（幂等纠正路径）。
    await revokeEscalationAck(UID, 'aa-none@7');
  });

  it('rejects malformed ids and versions, and stores no asset prose on disk', async () => {
    const { acknowledgeEscalation } = await modules();
    await expect(acknowledgeEscalation(UID, '../bad', '1')).rejects.toThrow(/invalid/);
    await expect(acknowledgeEscalation(UID, 'aa-1', 'v-x')).rejects.toThrow(/invalid/);
    await acknowledgeEscalation(UID, 'aa-1', '5', 'L2');
    // T040 的隐私口径：ack 文件里只有 id/版本/档位/时间——正文明示排查。
    const raw = fs.readFileSync(ackFile(), 'utf8');
    expect(raw).not.toContain('正文');
    const onDisk = JSON.parse(raw);
    expect(onDisk.acknowledged[0].assetId).toBe('aa-1');
    expect(onDisk.acknowledged[0].toVersion).toBe('5');
    expect(onDisk.acknowledged[0].level).toBe('L2');
  });
});
