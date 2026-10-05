import { describe, expect, it } from 'vitest';
import { loadCognitionAssets } from './helpers/cognition-renderer';
function form() {
 const fields = ['summary', 'judgment', 'value', 'scope', 'uncertainty'].map(name => ({ dataset: { f: name }, value: '', selectionStart: 0, selectionEnd: 0, focused: false,
  focus() { this.focused = true; },
  setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; } }));
 const chips = ['personal', 'template'].map(id => ({ dataset: { id }, selected: id === 'personal', pressed: id === 'personal' ? 'true' : 'false',
  classList: { toggle(_name: string, selected: boolean) { chips.find(c => c.dataset.id === id)!.selected = selected; } },
  setAttribute(_name: string, value: string) { this.pressed = value; } }));
 const details = { open: false };
 return { dataset: { candType: 'personal' }, fields, chips, details,
  querySelectorAll(selector: string) { return selector === '[data-f]' ? fields : chips; }, querySelector() { return details; } };
}
function fixture() {
 const loaded = loadCognitionAssets({}, { name: 'overview', candCreate: '1' });
 let current: ReturnType<typeof form> | null = form();
 const main = { classList: { toggle() {} }, querySelector(selector: string) { return selector === '[data-manual-candidate]' ? current : null; }, scrollTop: 0,
  set innerHTML(html: string) { current = html.includes('data-manual-candidate') ? form() : null; } };
 const root = { innerHTML: '' }; const plain = { innerHTML: '' };
 loaded.context.document.getElementById = (id: string) => id === 'ca-root' ? root : id === 'ca-scroll' ? main : plain;
 return { ...loaded, current: () => current! };
}
describe('记一条：后台重画不丢草稿', () => {
 it('真实 render 重建表单后保留模板类型、多行正文、名称、高级条件和输入位置', () => {
  const f = fixture(); const old = f.current(); old.dataset.candType = 'template'; old.details.open = true;
  old.fields[0].value = '验收模板'; old.fields[1].value = '# {{活动}}\n责任人：{{负责人}}'; old.fields[3].value = 'global';
  old.fields[1].selectionStart = 3; old.fields[1].selectionEnd = 6; f.context.document.activeElement = old.fields[1];
  f.ns.render(); expect(f.current()).not.toBe(old);
  expect(f.current().dataset.candType).toBe('template'); expect(f.current().fields.map(field => field.value)).toEqual(['验收模板', '# {{活动}}\n责任人：{{负责人}}', '', 'global', '']);
  expect(f.current().fields[1].focused).toBe(true); expect(f.current().fields[1].selectionStart).toBe(3); expect(f.current().fields[1].selectionEnd).toBe(6);
  expect(f.current().chips.find(chip => chip.dataset.id === 'template')).toMatchObject({ selected: true, pressed: 'true' });
  expect(f.current().details.open).toBe(true);
 });
 it('取消后重新新建不恢复上一份草稿；后台刷新不能重开已关闭表单', () => {
  const f = fixture(); f.current().fields[0].value = '不应复活'; f.store.route.candCreate = ''; f.ns.render();
  expect(f.current()).toBeNull(); f.store.route.candCreate = '1'; f.ns.render(); expect(f.current().fields[0].value).toBe('');
 });
});
