import { OntologyError } from './model';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pdfBufferToPages } from '../../../util/extract-pdf';
import { docxBufferToMarkdown } from '../../../util/extract-docx';

export const ONTOLOGY_IMPORT_TEXT_MAX_CHARS = 100_000;
export const ONTOLOGY_CANDIDATE_CHUNK_MAX_CHARS = 3_800;

/** Split plain text without dropping or altering a character or splitting a surrogate pair. */
export function splitOntologyImportText(input: string): string[] {
  if (typeof input !== 'string' || !input.trim()) throw new OntologyError('invalid_input', '资料内容为空');
  if (input.length > ONTOLOGY_IMPORT_TEXT_MAX_CHARS) throw new OntologyError('capacity_exceeded', '提取文本超过10万字；请先拆分资料再导入');
  const chunks: string[] = [];
  let chunk = '', length = 0;
  for (const point of input) {
    if (length + point.length > ONTOLOGY_CANDIDATE_CHUNK_MAX_CHARS) {
      chunks.push(chunk); chunk = ''; length = 0;
    }
    chunk += point; length += point.length;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export async function extractOntologyImportFile(filePath: string): Promise<{ name: string; text: string }> {
  const name = path.basename(filePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new OntologyError('capacity_exceeded', '文件必须小于10 MB');
  const buffer = await fs.readFile(filePath), ext = path.extname(name).toLowerCase();
  let content: string;
  if (ext === '.pdf') content = (await pdfBufferToPages(buffer)).map((page, index) => `\n--- 第 ${index + 1} 页 ---\n${page}`).join('\n');
  else if (ext === '.docx') content = await docxBufferToMarkdown(buffer);
  else if (['.md', '.markdown', '.txt'].includes(ext)) content = buffer.toString('utf8');
  else throw new OntologyError('unsupported_file', '支持 Markdown、TXT、PDF 和 DOCX 文件');
  if (content.includes('\u0000')) throw new OntologyError('invalid_input', '文件不是可读取的文本文档');
  if (content.length > ONTOLOGY_IMPORT_TEXT_MAX_CHARS) throw new OntologyError('capacity_exceeded', '提取文本超过10万字；请先拆分资料再导入');
  if (!content.trim()) throw new OntologyError('invalid_input', '没有从该文件中提取到可读取文字');
  return { name: name.slice(0, 240), text: content };
}
