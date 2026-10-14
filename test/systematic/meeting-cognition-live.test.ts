/** Opt-in live provider acceptance. Synthetic material, isolated data root; encrypted config copies are removed afterwards. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const enabled=process.env.COGSEED_LIVE_MEETING_TEST==='1';
const suite=enabled?describe:describe.skip;
let root='',oldRoot:string|undefined,uid='',report:any={};
suite('真实模型：对话临时信息不形成长期认知',()=>{
 beforeAll(async()=>{
  const source=process.env.COGSEED_LIVE_SOURCE_CONFIG_DIR;uid=process.env.COGSEED_LIVE_SOURCE_UID||'';
  if(!source||!uid)throw new Error('explicit source config directory and UID required');
  root=fs.mkdtempSync(path.join(os.tmpdir(),'cogseed-meeting-live-'));oldRoot=process.env.COGSEED_WORKSPACE_ROOT;process.env.COGSEED_WORKSPACE_ROOT=root;vi.resetModules();
  const target=path.join(root,uid,'local/config');fs.mkdirSync(target,{recursive:true,mode:0o700});
  for(const name of ['auth-profiles.json','account.json']){const file=path.join(source,name);if(fs.existsSync(file))fs.copyFileSync(file,path.join(target,name));}
  const {activateUser}=await import('../../src/main/features/users');activateUser(uid);
 });
 afterAll(()=>{
  if(process.env.COGSEED_LIVE_MEETING_REPORT)fs.writeFileSync(process.env.COGSEED_LIVE_MEETING_REPORT,JSON.stringify(report,null,2));
  if(oldRoot===undefined)delete process.env.COGSEED_WORKSPACE_ROOT;else process.env.COGSEED_WORKSPACE_ROOT=oldRoot;
  if(root)fs.rmSync(root,{recursive:true,force:true});
 });
 it('自然语言资料和纠错回答不能绕过夜间提取确认形成长期记录',async()=>{
  const {appendVisible}=await import('../../src/main/features/group_chat/visibility');
  const {streamChatWithModel}=await import('../../src/main/model/core-agent/client');
  const {readOntologyDocument}=await import('../../src/main/features/cognition/ontology/service');
  const {chatAttachmentDir}=await import('../../src/main/paths');
  const cid='meeting-live-system';const dir=chatAttachmentDir(uid,cid);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'meeting.txt'),'09:30 主持人：今天讨论包智能体。procedure 含义不明。');
  const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
  const turns=[
   '请根据会议.txt建立“系统验收9:30站会”本体，正式保存到本体页面，不只交付文档。会议频率是每个工作日09:30；产品名是报销智能体。procedure 含义不知道，请保留待回填。',
   '纠正并记住：procedure 是发布流程；转写中的“包智能体”应为“报销智能体”。请回填同一个本体，保存这个明确的纠错对，不要创建第二个本体。',
   '请查询刚才的站会本体与纠错依据，说明确认的频率、procedure含义和规范产品名；不能猜测任何未知发言人。',
  ];
  const receipts:any[]=[];const results:any[]=[];
  for(const [index,text] of turns.entries()){
   const id=`live-human-${index}`;
   await appendVisible(uid,cid,{id,ts:new Date().toISOString(),from:'user',to:['commander'],text,...(index===0?{attachments:['meeting.txt']}: {})},['commander']);
   let result={ok:false,text:'',error:''}; const toolInputs:any[]=[];
   for await (const event of streamChatWithModel({userId:uid,cid,sessionId:`gconv-${cid}`,turnId:`live-turn-${index}`,ephemeralSession:true,workingDir:workspace,sourceMessageId:id,sourceMessageFromUser:true,sourceMessageText:text,message:text,skillList:[],maxToolLoops:12,onCognitionSaveReceipt:r=>{receipts.push(r);}})) {
    if(event.type==='final')result={ok:true,text:event.text||'',error:''};
    if(event.type==='error')result.error=event.text||'';
    if(event.type==='progress' && event.event?.stream==='tool' && event.event.data?.phase==='start')toolInputs.push({name:event.event.data.name,arguments:event.event.data.arguments});
   }
   report={...report,toolInputs};
   results.push({ok:result.ok,text:result.text,error:result.error});report={...report,results,receiptCount:receipts.length};
   expect(result.ok).toBe(true);
   await appendVisible(uid,cid,{id:`live-reply-${index}`,ts:new Date().toISOString(),from:'commander',to:['user'],text:result.text},['commander']);
   const doc=readOntologyDocument(uid);
   const modules=Object.values(doc.records).filter(r=>r.kind==='module'&&r.status==='active');
   expect(modules).toHaveLength(0);
   expect(receipts).toHaveLength(0);
   const { loadGlossary } = await import('../../src/main/features/transcript_glossary');
   expect(loadGlossary(uid).entries).toHaveLength(0);
   expect(toolInputs.some(tool => ['personal_field_remember', 'ontology_slot_remember', 'cognition_ontology_save', 'transcript_remember_correction'].includes(tool.name))).toBe(false);
   report={...report,records:doc.records};
  }
  report={...report,passed:true,formalRecordCount:Object.keys(readOntologyDocument(uid).records).length};
 },0);
});
