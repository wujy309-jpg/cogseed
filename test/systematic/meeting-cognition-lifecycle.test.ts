/** 系统性任务场景：真实工具入口→真实保存→页面读模型→纠正→转写再次使用→恢复。
 * 仅 provider 文本以确定性用户材料替代；不 mock 本体、词表、查询、纠错或磁盘。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderCognition } from '../renderer/helpers/cognition-renderer';
let root: string, oldRoot: string | undefined;
const uid='system-meeting-user', cid='meeting-lifecycle';
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'cogseed-meeting-system-'));oldRoot=process.env.COGSEED_WORKSPACE_ROOT;process.env.COGSEED_WORKSPACE_ROOT=root;vi.resetModules();});
afterEach(()=>{if(oldRoot===undefined) delete process.env.COGSEED_WORKSPACE_ROOT;else process.env.COGSEED_WORKSPACE_ROOT=oldRoot;fs.rmSync(root,{recursive:true,force:true});});
async function setup() {
 const [{appendVisible},{chatAttachmentDir},{createOntologyTools},{createTranscriptMemoryTools},{readOntologyView}]=await Promise.all([
  import('../../src/main/features/group_chat/visibility'),import('../../src/main/paths'),import('../../src/main/model/core-agent/ontology-tools'),import('../../src/main/model/core-agent/transcript-memory-tools'),import('../../src/main/features/cognition/ontology/service')]);
 const quote='请建立9:30站会本体，会议频率是每个工作日9:30。产品名是报销智能体。procedure 不知道，后续回填。';
 await appendVisible(uid,cid,{id:'human-create',ts:new Date().toISOString(),from:'user',to:['commander'],text:quote,attachments:['meeting.txt']},['commander']);
 const dir=chatAttachmentDir(uid,cid);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'meeting.txt'),'主持人：包智能体进展待讨论。procedure 含义不明。');
 const tools=createOntologyTools({userId:uid,cid,allowConversationWrite:true}), save=tools.find(t=>t.name==='cognition_ontology_save')!,query=tools[0];
 const create=(recordId:string,record:any)=>({intent:'create',recordId,record,sourceLabel:'用户提供的会议材料'});
 const type=(name:string)=>({kind:'definition',moduleId:'meeting',name,description:'',definitionKind:'type',subjectTypes:[],objectTypes:[],valueType:'entity',cardinality:'many',cardinalityAnchor:'subject'});
 const attribute=(name:string)=>({...type(name),definitionKind:'attribute',subjectTypes:['meeting-type'],valueType:'text',cardinality:'one'});
 const entity=(name:string,typeId:string)=>({kind:'entity',moduleId:'meeting',name,typeId,description:'',aliases:[],identityStatus:'confirmed'});
 const fact=(definitionId:string,value:string)=>({kind:'assertion',moduleId:'meeting',subjectId:'meeting-series',definitionId,object:{kind:'literal',valueType:'text',value},validity:{from:'2026-10-09',until:null,precision:'day',timezone:'Asia/Shanghai'}});
 const actions=[create('meeting',{kind:'module',name:'9:30站会',description:'例行会议',scope:{kind:'personal'}}),create('meeting-type',type('会议')),create('product-type',type('产品')),create('frequency',attribute('频率')),create('procedure',attribute('procedure含义')),create('meeting-series',entity('9:30早会','meeting-type')),create('expense',entity('报销智能体','product-type')),create('frequency-fact',fact('frequency','每个工作日9:30')),create('unknown-fact',fact('procedure','未确认'))];
 const evidence=actions.map((_,index)=>({messageId:'human-create',quote:index===8?'procedure 不知道，后续回填。':index===6?'产品名是报销智能体。':index===7?'会议频率是每个工作日9:30。':'请建立9:30站会本体',certainty:index===8?'unknown':'confirmed'}));
 return {appendVisible,readOntologyView,quote,save,query,tools,correctionTools:createTranscriptMemoryTools({userId:uid,cid,allowConversationWrite:true}),command:{commandId:'create-meeting',expectedRevision:0,actions},evidence};
}
const payload=(result:any)=>JSON.parse(result.content);
describe('会议本体与转写完整用户任务',()=>{
 it('创建可见、可查、可追溯；未知不变成确定事实，重试和冷启动不重复创建',async()=>{
  const s=await setup();const result=payload(await s.save.execute({command:s.command,evidence:s.evidence}));expect(result.saved).toBe(true);expect(result.pendingIds).toEqual(['unknown-fact']);
  const snapshot=await s.readOntologyView(uid);expect(snapshot.records.meeting.name).toBe('9:30站会');
  expect(renderCognition({name:'overview'},{ontologySnapshot:snapshot})).toContain('9:30站会');
  const read=payload(await s.query.execute({query:'9:30站会'}));expect(read.facts.some((f:any)=>f.statement.includes('每个工作日9:30'))).toBe(true);expect(read.facts.some((f:any)=>f.statement.includes('未确认'))).toBe(false);expect(read.uncertainFacts).toHaveLength(1);
  expect(payload(await s.save.execute({command:s.command,evidence:s.evidence})).duplicate).toBe(true);
  vi.resetModules();const restarted=await import('../../src/main/features/cognition/ontology/service');expect(restarted.readOntologyDocument(uid).history).toHaveLength(9);
  const bridge=await import('../../src/main/features/transcript_ontology_bridge');expect(bridge.collectCanonicalNames(uid).some(n=>n.name==='报销智能体')).toBe(true);
 });
 it('明确回填更新原事实链并关闭未知；确认纠错可用于同会议后续文档，无关会议不能使用',async()=>{
  const s=await setup();await s.save.execute({command:s.command,evidence:s.evidence});
  const quote='纠正并记住：procedure 是发布流程，包智能体应为报销智能体。';
  await s.appendVisible(uid,cid,{id:'human-correct',ts:'2026-10-09T10:02:00',from:'user',to:['commander'],text:quote},['commander']);
  const corrected=payload(await s.save.execute({command:{commandId:'fill-procedure',expectedRevision:1,actions:[{intent:'correct',recordId:'unknown-fact',expectedVersion:1,object:{kind:'literal',valueType:'text',value:'发布流程'},sourceLabel:'用户纠正'}]},evidence:[{messageId:'human-correct',quote,certainty:'confirmed'}]}));
  expect(corrected.saved).toBe(true);expect(corrected.pendingIds).toEqual([]);
  const doc=await s.readOntologyView(uid);expect(doc.records['unknown-fact'].status).toBe('corrected');expect(doc.history.some(h=>h.after.kind==='assertion' && h.after.supersedesId==='unknown-fact')).toBe(true);
  const read=payload(await s.query.execute({query:'9:30站会'}));expect(read.uncertainFacts).toHaveLength(0);expect(read.facts.some((f:any)=>f.statement.includes('发布流程'))).toBe(true);
  const remember=s.correctionTools.find(t=>t.name==='transcript_remember_correction')!;
  const input={wrong:'包智能体',correct:'报销智能体',attachmentName:'meeting.txt',sourceMessageId:'human-create',confirmationMessageId:'human-correct',quote,moduleId:'meeting',entityId:'expense'};
  expect(payload(await remember.execute(input)).saved).toBe(true);expect(payload(await remember.execute(input)).duplicate).toBe(true);
  const {createTranscriptMemoryTools}=await import('../../src/main/model/core-agent/transcript-memory-tools');
  const next=createTranscriptMemoryTools({userId:uid,cid:'next-meeting',allowConversationWrite:true}).find(t=>t.name==='transcript_corrections_query')!;
  const reused=payload(await next.execute({moduleId:'meeting'}));expect(reused.entries).toHaveLength(1);expect(reused.entries[0].scope.global).toBe(false);
  const {scanText,applyCorrections}=await import('../../src/main/features/transcript_auto_correct');
  const text='包智能体进展待讨论。';const scan=scanText(text,reused.entries,{docId:'next-document',scenarioTags:['ontology:meeting']});
  expect(applyCorrections(text,scan.candidates,{acceptedIds:scan.candidates.map(c=>c.entryRef)}).text).toBe('报销智能体进展待讨论。');
  expect(scanText(text,reused.entries,{docId:'unrelated'}).candidates).toHaveLength(0);
 });
 it('伪造来源、附件越界、过期版本和推断确认不能落库；失败不伪装成成功',async()=>{
  const s=await setup();const bad=s.evidence.map(e=>({...e,quote:'不存在的用户确认'}));
  expect(payload(await s.save.execute({command:s.command,evidence:bad})).saved).toBe(false);expect((await s.readOntologyView(uid)).revision).toBe(0);
  const foreign=s.evidence.map(e=>({...e,attachmentName:'../meeting.txt'}));expect(payload(await s.save.execute({command:s.command,evidence:foreign})).saved).toBe(false);
  await s.save.execute({command:s.command,evidence:s.evidence});
  expect(payload(await s.save.execute({command:{...s.command,commandId:'stale'},evidence:s.evidence})).code).toBe('baseline_changed');
  const remember=s.correctionTools.find(t=>t.name==='transcript_remember_correction')!;
  expect(payload(await remember.execute({wrong:'procedure',correct:'发布流程',attachmentName:'meeting.txt',sourceMessageId:'human-create',confirmationMessageId:'human-create',quote:'我猜可能是发布流程。'})).saved).toBe(false);
  const {loadGlossary}=await import('../../src/main/features/transcript_glossary');expect(loadGlossary(uid).entries).toHaveLength(0);
 });
 it('中断后保留已保存认知，旧孤立运行收尾；已完成和本进程新运行不被误停',async()=>{
  const s=await setup();await s.save.execute({command:s.command,evidence:s.evidence});
  const store=await import('../../src/main/features/group_chat/run_store');
  const make=(id:string)=>store.createRun({uid,cid,runId:id,submittedText:'继续会议本体修正',memberAgentIds:[],mentionAgentIds:[]});
  await make('old-interrupted');await make('current-live');await make('already-completed');
  await store.updateRun(uid,cid,'already-completed',run=>({...run,status:'completed'}));
  const file=store.runFileOf(uid,cid,'old-interrupted');const old=JSON.parse(fs.readFileSync(file,'utf8'));old.created_at='2000-01-01T00:00:00Z';old.updated_at=old.created_at;fs.writeFileSync(file,JSON.stringify(old));
  expect(await store.recoverAbandonedCommanderRuns(uid,cid,Date.now()-process.uptime()*1000)).toBe(1);
  expect(await store.readRun(uid,cid,'old-interrupted')).toMatchObject({status:'stopped',interruption_reason:'application_interrupted'});
  expect((await store.readRun(uid,cid,'current-live'))?.status).toBe('running');expect((await store.readRun(uid,cid,'already-completed'))?.status).toBe('completed');
  expect(await store.recoverAbandonedCommanderRuns(uid,cid,Date.now()-process.uptime()*1000)).toBe(0);
  vi.resetModules();const cold=await import('../../src/main/features/cognition/ontology/service');expect(cold.readOntologyDocument(uid).records['meeting']).toMatchObject({name:'9:30站会',version:1});
 });
 it('并发重试只有一次提交，重复新建不能分裂本体；错误批次原子拒绝且拒绝权限扩张',async()=>{
  const s=await setup();const results=await Promise.all([s.save.execute({command:s.command,evidence:s.evidence}),s.save.execute({command:s.command,evidence:s.evidence})]);
  expect(results.map(payload).every(r=>r.saved)).toBe(true);expect((await s.readOntologyView(uid)).revision).toBe(1);
  const duplicate={commandId:'duplicate-module',expectedRevision:1,actions:[{...s.command.actions[0],recordId:'meeting-copy'}]};
  expect(payload(await s.save.execute({command:duplicate,evidence:[s.evidence[0]]})).code).toBe('already_exists');
  const invalid={commandId:'invalid-batch',expectedRevision:1,actions:[{intent:'create',recordId:'new-type',record:{...s.command.actions[1].record,name:'新类型'},sourceLabel:'来源'}, {intent:'create',recordId:'bad-entity',record:{...s.command.actions[5].record,typeId:'missing-type'},sourceLabel:'来源'}]};
  expect(payload(await s.save.execute({command:invalid,evidence:[s.evidence[0],s.evidence[0]]})).saved).toBe(false);expect((await s.readOntologyView(uid)).records['new-type']).toBeUndefined();
  const escalation={commandId:'scope-escalation',expectedRevision:1,actions:[{intent:'update',recordId:'expense',expectedVersion:1,patch:{access:'owner_only'},sourceLabel:'来源'}]};
  expect(payload(await s.save.execute({command:escalation,evidence:[s.evidence[6]]})).saved).toBe(false);expect((await s.readOntologyView(uid)).revision).toBe(1);
 });

 it('模型友好草稿自动生成稳定标识与规范字段，中文键和文字属性无需模型拼底层定义',async()=>{
  const s=await setup();const proof={messageId:'human-create',quote:'请建立9:30站会本体',certainty:'confirmed'};
  const draft={requestId:'创建会议本体',expectedRevision:0,module:{name:'9:30站会'},evidence:proof,types:[{key:'会议类',name:'会议'}],entities:[{key:'这场会',name:'9:30站会',type:'会议类',evidence:proof}],facts:[{key:'周期',subject:'这场会',relation:'频率',value:'每个工作日9:30',from:'2026-10-09',evidence:{messageId:'human-create',quote:'会议频率是每个工作日9:30。',certainty:'confirmed'}}]};
  const result=payload(await s.save.execute({draft}));expect(result.saved).toBe(true);expect(result.moduleId).toMatch(/^ont-[a-f0-9]+$/);expect(result.keyToId['周期']).toBeTruthy();
  const doc=await s.readOntologyView(uid);expect(Object.values(doc.records).some(r=>r.kind==='definition'&&r.name==='频率'&&r.definitionKind==='attribute'&&r.valueType==='text')).toBe(true);
  expect(payload(await s.save.execute({draft})).duplicate).toBe(true);expect((await s.readOntologyView(uid)).revision).toBe(1);
 });

 it('未确认发言人可以保存待回填信息，但禁止将其关系作为确定事实使用',async()=>{
  const s=await setup();await s.save.execute({command:s.command,evidence:s.evidence});
  const quote='请回填本体发言人身份：不知道是谁，只确认不是主持人。';await s.appendVisible(uid,cid,{id:'human-unknown-person',ts:'2026-10-09T10:03:00',from:'user',to:['commander'],text:quote},['commander']);
  const proof={messageId:'human-unknown-person',quote,certainty:'unknown'};
  const draft={requestId:'保留未确认身份',expectedRevision:1,module:{id:'meeting',name:'9:30站会'},evidence:proof,types:[{key:'person',name:'人物'}],entities:[{key:'unknown-person',name:'待核对发言人',type:'person',evidence:proof}],facts:[{key:'unknown-person-note',subject:'unknown-person',relation:'身份说明',value:'不知道是谁',from:'2026-10-09',evidence:proof}]};
  const saved=payload(await s.save.execute({draft}));expect(saved.saved).toBe(true);
  const read=payload(await s.query.execute({query:'9:30站会'}));expect(read.facts.some((f:any)=>f.statement.includes('待核对发言人'))).toBe(false);expect(read.uncertainFacts.some((f:any)=>f.statement.includes('待核对发言人'))).toBe(true);
  const answer='请回填：这个发言人的名字是李四。';await s.appendVisible(uid,cid,{id:'human-identity',ts:'2026-10-09T10:05:00',from:'user',to:['commander'],text:answer},['commander']);
  const actual=await s.readOntologyView(uid),personId=saved.keyToId['unknown-person'];
  const resolved=payload(await s.save.execute({command:{commandId:'resolve-person',expectedRevision:actual.revision,actions:[{intent:'update',recordId:personId,expectedVersion:actual.records[personId].version,patch:{name:'李四'},sourceLabel:'用户身份确认'}]},evidence:[{messageId:'human-identity',quote:answer,certainty:'confirmed'}]}));
  expect(resolved.saved).toBe(true);expect((await s.readOntologyView(uid)).records[personId]).toMatchObject({identityStatus:'confirmed',certainty:'confirmed',name:'李四'});

 });

 it('仅写文件不能宣告本体完成；正式回读成功且回执展示失败时仍如实保留保存结果',async()=>{
  const s=await setup();const {auditConversationOntologyCompletion}=await import('../../src/main/features/cognition/ontology/completion-audit');
  fs.writeFileSync(path.join(root,'meeting-ontology.md'),'# 9:30站会本体已创建');
  expect(await auditConversationOntologyCompletion(uid,cid)).toMatchObject({required:true,saved:false});
  const {createOntologyTools}=await import('../../src/main/model/core-agent/ontology-tools');
  const save=createOntologyTools({userId:uid,cid,allowConversationWrite:true,onCognitionSaveReceipt:()=>{throw Error('UI unavailable');}}).find(tool=>tool.name==='cognition_ontology_save')!;
  const result=payload(await save.execute({command:s.command,evidence:s.evidence}));expect(result.saved).toBe(true);expect(result.receiptSurface).toBe('unavailable');
  expect(await auditConversationOntologyCompletion(uid,cid)).toMatchObject({required:true,saved:true});
 });

});
