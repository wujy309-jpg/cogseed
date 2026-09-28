import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Knowledge Base structural migrations', () => {
  const workbench = read('src/renderer/modules/kb-workbench.js');
  const quiz = read('src/renderer/modules/kb-quiz.js');
  const picker = read('src/renderer/modules/kb-picker.js');
  const discover = read('src/renderer/modules/kb-discover.js');

  it('routes Workbench overlays, tree, checkbox and layers through shared seams', () => {
    expect(workbench).toContain('window.uiTree({');
    expect(workbench).toContain('window.hydrateUiTrees(treeRoot)');
    expect(workbench).toContain('_uiCheckbox({');
    expect(workbench).toContain("uiModalController({ overlay, dialog, initialFocus: '#kb-fv-close' })");
    expect(workbench).toContain('initialFocus: \'#kb-mm-overlay-close\'');
    expect(workbench).not.toMatch(/z-index\s*:\s*\d+/i);
  });

  it('keeps quiz closure shared while business shortcuts stay IME-safe', () => {
    expect(quiz).toContain('onRequestClose: (reason) => _requestClose(reason)');
    expect(quiz).toContain('if (e.isComposing || e.keyCode === 229) return;');
    expect(quiz).not.toMatch(/if \(e\.key === 'Escape'\)/);
    expect(quiz).toContain('window.uiProgressBar({');
    expect(quiz).toContain('className: \'kb-qz-source-chip\'');
  });

  it('uses shared modal and tabs on adjacent KB surfaces', () => {
    expect(picker).toContain('window.uiModalController({');
    expect(picker).toContain('_kbPickerController.close(\'confirm\')');
    expect(discover).toContain('window.uiTabs({');
    expect(discover).toContain('window.hydrateUiTabs(host)');
  });
});
