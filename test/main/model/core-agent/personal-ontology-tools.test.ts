import { beforeEach, describe, expect, it, vi } from 'vitest';

const templateMock = vi.hoisted(() => ({
  describeRoleTemplateFieldRef: vi.fn(),
  listRoleTemplateFieldTargets: vi.fn(),
}));

vi.mock('../../../../src/main/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
vi.mock('../../../../src/main/features/personal_ontology_contract', () => templateMock);

import { createPersonalOntologyTools } from '../../../../src/main/model/core-agent/personal-ontology-tools';

describe('Personal Ontology agent tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    templateMock.listRoleTemplateFieldTargets.mockResolvedValue([]);
    templateMock.describeRoleTemplateFieldRef.mockReturnValue(null);
  });

  it('does not expose the legacy unscoped graph reader and keeps the template field helper', async () => {
    templateMock.listRoleTemplateFieldTargets.mockResolvedValue([
      { parentLabel: '周报', fieldRef: 'opaque-field-ref', label: '接收人' },
    ]);
    templateMock.describeRoleTemplateFieldRef.mockReturnValue({ fieldName: '接收人', section: '固定格式' });
    const tools = createPersonalOntologyTools({ userId: 'user-a' });
    expect(tools.map((tool) => tool.name)).toEqual(['personal_ontology_fields']);

    const result = await tools[0].execute({});
    expect(result.content).toContain('接收人');
    expect(templateMock.listRoleTemplateFieldTargets).toHaveBeenCalledWith('user-a');
  });

  it('tells the model not to guess when no template fields are installed', async () => {
    const [tool] = createPersonalOntologyTools({ userId: 'user-a' });
    await expect(tool.execute({})).resolves.toMatchObject({ content: expect.stringContaining('不要猜测字段名') });
  });
});
