import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

/**
 * The composer's member list lives in localStorage (`chat.membersByCid`) while the
 * backend `members.json` is authoritative, and the two had drifted: opening a
 * conversation seeded nothing into the composer, so a selected `@` agent never
 * reached dispatch (M1). The `@` chip was also undeletable at its boundary (M3).
 * Both decisions are layout-free, so they are pinned here against the real source
 * with a minimal fake DOM — the Electron reproduction covers rendering.
 */
const source = fs.readFileSync(
  path.join(__dirname, '../../src/renderer/modules/conversation.js'),
  'utf8',
);

function extractFunction(name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

// ── minimal DOM ──────────────────────────────────────────────────────────────
type FakeNode = {
  nodeType: number;
  parentNode: FakeNode | null;
  childNodes: FakeNode[];
  textContent: string;
  classList?: { contains: (c: string) => string | boolean };
  className?: string;
  previousSibling: FakeNode | null;
  nextSibling: FakeNode | null;
};

function node(kind: 'element' | 'text', text = '', className = ''): FakeNode {
  const n: FakeNode = {
    nodeType: kind === 'element' ? 1 : 3,
    parentNode: null,
    childNodes: [],
    textContent: text,
    previousSibling: null,
    nextSibling: null,
  };
  if (kind === 'element') {
    n.className = className;
    n.classList = { contains: (c: string) => className.split(/\s+/).includes(c) };
  }
  return n;
}

function relink(parent: FakeNode, children: FakeNode[]): void {
  parent.childNodes = children;
  // The source calls removeChild; give the fake parent the same contract.
  (parent as unknown as { removeChild: (n: FakeNode) => void }).removeChild = (target: FakeNode) => {
    const next = parent.childNodes.filter((c) => c !== target);
    relink(parent, next);
  };
  children.forEach((child, i) => {
    child.parentNode = parent;
    child.previousSibling = i > 0 ? children[i - 1] : null;
    child.nextSibling = i < children.length - 1 ? children[i + 1] : null;
  });
}

function loadHelpers() {
  const sandbox: Record<string, unknown> = {
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    document: {
      createRange: () => ({
        setStart: () => {},
        selectNodeContents: () => {},
        collapse: () => {},
      }),
    },
    window: {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    `${extractFunction('_seedComposerFromBackendActors')}\n${extractFunction('_deleteAdjacentMentionChip')}\nthis.__seed = _seedComposerFromBackendActors;\nthis.__del = _deleteAdjacentMentionChip;`,
    sandbox,
  );
  return sandbox as unknown as {
    __seed: (actors: unknown) => void;
    __del: (editor: FakeNode, dir: 'backward' | 'forward') => boolean;
    composerMembers?: unknown;
    getSelection?: () => unknown;
  };
}

describe('composer › @ members (M1) and chip deletion (M3)', () => {
  it('M1: seeds unknown backend agents into the composer, idempotently, skipping commander/user', () => {
    const ctx = loadHelpers();
    const members: Array<{ kind: string; id: string; name?: string }> = [];
    ctx.composerMembers = {
      getMembers: () => members.slice(),
      addMember: (_target: string, member: { kind: string; id: string }) => { members.push({ ...member }); },
    };
    const actors = [
      { id: 'commander', name: 'CogSeed' },
      { id: 'user', name: 'User' },
      { id: 'agent-a', name: 'Agent A' },
      { id: 'agent-b' },
    ];
    ctx.__seed(actors);
    expect(members.map((m) => m.id)).toEqual(['agent-a', 'agent-b']);
    expect(members[1].name).toBe('agent-b'); // name falls back to the id
    // Second call must add nothing (already present).
    ctx.__seed(actors);
    expect(members).toHaveLength(2);
  });

  it('M1: tolerates a missing composer or malformed actor list', () => {
    const ctx = loadHelpers();
    expect(() => ctx.__seed([{ id: 'x' }])).not.toThrow(); // no composerMembers
    ctx.composerMembers = { getMembers: () => [], addMember: () => { throw new Error('boom'); } };
    expect(() => ctx.__seed([{ id: 'x' }])).not.toThrow(); // per-member failure swallowed
    expect(() => ctx.__seed(null)).not.toThrow();
  });

  it('M3: Backspace adjacent to a chip removes the whole chip and its space', () => {
    const ctx = loadHelpers();
    const chip = node('element', '', 'chat-rich-mention-chip');
    const space = node('text', ' x');
    const root = node('element');
    relink(root, [chip, space]);
    const range = { startContainer: root, startOffset: 1, collapsed: true };
    ctx.getSelection = () => ({ rangeCount: 1, isCollapsed: true, getRangeAt: () => range, removeAllRanges: () => {}, addRange: () => {} });
    expect(ctx.__del(root, 'backward')).toBe(true);
    expect(root.childNodes.length).toBe(1);
    expect(root.childNodes[0]).toBe(space);
    expect(space.textContent).toBe('x'); // one separating space dropped
  });

  it('M3: returns false when the caret is not at a chip boundary', () => {
    const ctx = loadHelpers();
    const text = node('text', 'hello');
    const root = node('element');
    relink(root, [text]);
    const range = { startContainer: text, startOffset: 2, collapsed: true };
    ctx.getSelection = () => ({ rangeCount: 1, isCollapsed: true, getRangeAt: () => range, removeAllRanges: () => {}, addRange: () => {} });
    expect(ctx.__del(root, 'backward')).toBe(false);
    expect(root.childNodes[0]).toBe(text);
  });
});
