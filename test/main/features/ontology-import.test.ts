import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeMinimalDocx } from '../../../test/fixtures/make-minimal-docx';
import { makeMinimalPdf } from '../../../test/fixtures/make-minimal-pdf';

let temp: string;
beforeEach(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-ontology-import-')); });
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

describe('本体资料导入候选', () => {
  it('原样切分长文本、不切开 emoji，并保持每段在正式候选字数上限内', async () => {
    const { splitOntologyImportText } = await import('../../../src/main/features/cognition/ontology/import-text');
    const source = `${'甲'.repeat(3799)}😀${'乙'.repeat(4100)}`;
    const chunks = splitOntologyImportText(source);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.length <= 3800)).toBe(true);
    expect(chunks.join('')).toBe(source);
    expect(() => splitOntologyImportText('')).toThrow(/为空/);
  });
  it('仅读取用户选择的原始文本，专属资料形成函数已退休', async () => {
    const importing = await import('../../../src/main/features/cognition/ontology/import-text');
    const file = path.join(temp, '项目说明.md'), body = '项目说明\n'.repeat(1200);
    fs.writeFileSync(file, body);
    expect(await importing.extractOntologyImportFile(file)).toEqual({ name: '项目说明.md', text: body });
    expect(importing).not.toHaveProperty('submitOntologyImport');
    expect(fs.readFileSync(file, 'utf8')).toBe(body);
    expect(fs.readdirSync(temp)).toEqual(['项目说明.md']);
    expect(fs.existsSync(path.resolve(__dirname, '../../../src/main/features/cognition/ontology/import-extraction.ts'))).toBe(false);
  });
  it('支持 PDF 与 DOCX 的本地文本提取，不需要安装额外组件', async () => {
    const { extractOntologyImportFile } = await import('../../../src/main/features/cognition/ontology/import-text');
    const pdfPath = path.join(temp, '项目说明.pdf');
    const docxPath = path.join(temp, '项目说明.docx');
    fs.writeFileSync(pdfPath, makeMinimalPdf(['Weekly report recipient: Lin.']));
    fs.writeFileSync(docxPath, makeMinimalDocx({ paragraphs: ['Project owner: Lin.'] }));
    expect((await extractOntologyImportFile(pdfPath)).text).toContain('Weekly report recipient');
    expect((await extractOntologyImportFile(docxPath)).text).toContain('Project owner');
    expect(fs.readdirSync(temp)).toEqual(['项目说明.docx', '项目说明.pdf']);
  });
});
