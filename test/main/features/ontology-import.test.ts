import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeMinimalDocx } from '../../../test/fixtures/make-minimal-docx';
import { makeMinimalPdf } from '../../../test/fixtures/make-minimal-pdf';

const { submitCandidate } = vi.hoisted(() => ({ submitCandidate: vi.fn() }));
vi.mock('../../../src/main/features/cognition/candidate-submission', () => ({ submitCognitionCandidate: submitCandidate }));
let temp: string;
beforeEach(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-ontology-import-')); submitCandidate.mockReset(); });
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
  it('仅读取用户选择的文本文件，不复制原文件；文档内容经统一候选入口提交并可幂等重试', async () => {
    const { extractOntologyImportFile, submitOntologyImport } = await import('../../../src/main/features/cognition/ontology/import-text');
    const file = path.join(temp, '项目说明.md'), body = `${'项目说明\n'.repeat(1200)}`;
    fs.writeFileSync(file, body);
    const extracted = await extractOntologyImportFile(file);
    expect(extracted).toEqual({ name: '项目说明.md', text: body });
    const saved = new Map<string, { id: string }>();
    submitCandidate.mockImplementation(async (_uid: string, input: { captureKey: string }) => {
      if (!saved.has(input.captureKey)) saved.set(input.captureKey, { id: `candidate-${saved.size}` });
      return saved.get(input.captureKey);
    });
    const first = await submitOntologyImport('import-user', extracted.name, extracted.text);
    const second = await submitOntologyImport('import-user', extracted.name, extracted.text);
    expect(first.total).toBeGreaterThan(1);
    expect(first.submitted).toBe(first.total);
    expect(second.candidateIds).toEqual(first.candidateIds);
    expect(saved.size).toBe(first.total);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readdirSync(temp)).toEqual(['项目说明.md']);
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
