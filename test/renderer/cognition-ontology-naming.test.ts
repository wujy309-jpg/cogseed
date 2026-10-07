import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { loadCognitionAssets } from './helpers/cognition-renderer';

const rendererRoot = path.resolve(__dirname, '../../src/renderer');

describe('Ontology navigation copy', () => {
  it.each(['zh', 'en', 'ja', 'pt'] as const)('renders localized labels and scope on the real tree page (%s)', (locale) => {
    const translations = JSON.parse(
      fs.readFileSync(path.join(rendererRoot, 'locales', `${locale}.json`), 'utf8'),
    ) as Record<string, string>;
    const page = loadCognitionAssets({}, { name: 'tree' }, {
      t: (key: string) => translations[key] || key,
    });
    const rendered = page.render();

    expect(rendered).toContain(translations['cognition.tab_ontology']);
    expect(rendered).toContain(translations['cognition.ontology_entry_title']);
    expect(rendered).toContain(translations['cognition.ontology_entry_hint']);
    const treeLabel = rendered.match(/<text\b[^>]*class="trunk-name"[^>]*>([\s\S]*?)<\/text>/)?.[1]
      .replace(/<[^>]+>/g, '') || '';
    expect(Array.from(treeLabel)).toEqual(Array.from(translations['cognition.ontology_tree_label']));
    expect(translations['cognition.ontology_entry_hint']).toMatch(/ontolog|本体|オントロジー/i);
  });

  it('uses the Ontology name in the embedded workspace header', () => {
    // 2026-10-07 旧停驻页退役：工作台标题不再来自 index.html 壳，改锚
    // cognition-ontology.js 的 pageHeader 取词点（zh 兜底=本体）。
    const source = fs.readFileSync(path.join(rendererRoot, 'modules', 'cognition-ontology.js'), 'utf8');
    expect(source).toContain("title: text('title', '本体')");
  });

  it('keeps the selected ontology subpage during data rerenders and resets only on a new entry', () => {
    const page = loadCognitionAssets({}, { name: 'ontology' });
    const mount = vi.fn(async () => {});
    page.ns.mountPersonalOntology = mount;

    page.render();
    expect(mount).toHaveBeenLastCalledWith({ resetToOverview: true });

    page.render();
    expect(mount).toHaveBeenLastCalledWith({ resetToOverview: false });

    page.store.route.name = 'overview';
    page.render();
    page.store.route.name = 'ontology';
    page.render();
    expect(mount).toHaveBeenLastCalledWith({ resetToOverview: true });
  });
});
