/** Model-facing draft adapter. Persistence IDs, definition metadata and relation/attribute distinction belong to the host. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readOntologyDocument } from './service';
import { saveConversationOntology, verifyConversationEvidence, type ConversationWriteContext } from './conversation-commands';
import { ontologyModuleVisibleToTask } from './query';
import { OntologyError } from './model';
const evidence=z.object({messageId:z.string(),quote:z.string().min(1).max(2000),attachmentName:z.string().optional(),certainty:z.enum(['confirmed','inferred','unknown'])}).strict();
const key=z.string().trim().min(1).max(120);
const draftSchema=z.object({requestId:key,expectedRevision:z.number().int().nonnegative(),module:z.object({id:z.string().optional(),name:key,description:z.string().max(4000).optional()}).strict(),evidence,
 types:z.array(z.object({key,name:key}).strict()).max(20).default([]),
 entities:z.array(z.object({key,id:z.string().optional(),name:key,type:key,description:z.string().max(4000).optional(),aliases:z.array(key).max(20).optional(),evidence}).strict()).max(30).default([]),
 facts:z.array(z.object({key,subject:key,relation:key,value:z.union([z.string().max(10000),z.number().finite(),z.boolean()]).optional(),target:key.optional(),from:z.string().nullable().optional(),until:z.string().nullable().optional(),evidence}).strict()).max(30).default([]),
}).strict();
export async function saveConversationOntologyDraft(userId:string,input:unknown,options:ConversationWriteContext){
 const draft=draftSchema.parse(input),doc=readOntologyDocument(userId);
 const stableId=(seed:string)=>'ont-'+createHash('sha256').update(userId+':'+seed).digest('hex').slice(0,24);
 const moduleId=draft.module.id||stableId('conversation-module:'+options.cid+':'+draft.module.name);
 const module=doc.records[moduleId];
 const commandId=stableId('draft:'+draft.requestId+':'+JSON.stringify(draft));
 const previous=doc.receipts[`chat-${options.cid}-${commandId}`.slice(0,160)];
 if(previous){
  if(!module || module.kind!=='module' || module.status!=='active' || !ontologyModuleVisibleToTask(module,options.context))throw new OntologyError('not_authorized','saved module is no longer available to this task');
  for(const proof of [draft.evidence,...draft.entities.map(e=>e.evidence),...draft.facts.map(f=>f.evidence)])await verifyConversationEvidence(userId,options.cid,proof);
  const records=previous.changedIds.map(id=>doc.records[id]);
  if(records.some(record=>record.access!=='task'))throw new OntologyError('not_authorized','saved record access changed');
  return {saved:true,duplicate:true,receipt:previous,moduleId,moduleIds:[moduleId],records,citations:records.map(record=>`[[ontology:${moduleId}/${record.id}@${record.version}]]`),pendingIds:Object.values(doc.records).filter(record=>record.kind!=='module'&&record.moduleId===moduleId&&record.status==='active'&&record.certainty&&record.certainty!=='confirmed').map(record=>record.id),keyToId:{}};
 }
 if(module && (module.kind!=='module'||module.name!==draft.module.name))throw new OntologyError('invalid_input','module ID and name do not match');
 const actions:any[]=[],proofs:any[]=[],keys:Record<string,string>=Object.create(null),typeIds:Record<string,string>=Object.create(null),entityIds:Record<string,string>=Object.create(null);
 const add=(recordId:string,record:Record<string,unknown>,proof:z.infer<typeof evidence>)=>{actions.push({intent:'create',recordId,record,sourceLabel:'对话内容草稿'});proofs.push(proof);};
 if(!module)add(moduleId,{kind:'module',name:draft.module.name,description:draft.module.description||'',scope:{kind:'personal'}},draft.evidence);
 for(const type of draft.types){
  const id=stableId(moduleId+':type:'+type.key);keys[type.key]=id;typeIds[type.key]=id;
  if(!doc.records[id])add(id,{kind:'definition',moduleId,name:type.name,description:'',definitionKind:'type',subjectTypes:[],objectTypes:[],valueType:'entity',cardinality:'many',cardinalityAnchor:'subject'},draft.evidence);
 }
 for(const entity of draft.entities){
  const id=entity.id||stableId(moduleId+':entity:'+entity.key);keys[entity.key]=id;entityIds[entity.key]=id;
  const typeId=typeIds[entity.type]||entity.type;
  if(doc.records[id]){
   const previous=doc.records[id];if(previous.kind!=='entity'||previous.moduleId!==moduleId||previous.name!==entity.name||previous.typeId!==typeId)throw new OntologyError('already_exists','entity key already identifies a different entity; query and explicitly correct it');
  }else add(id,{kind:'entity',moduleId,name:entity.name,typeId,description:entity.description||'',aliases:entity.aliases||[],identityStatus:entity.evidence.certainty==='confirmed'?'confirmed':'unresolved'},entity.evidence);
 }
 for(const fact of draft.facts){
  if((fact.value===undefined)===(fact.target===undefined))throw new OntologyError('invalid_input','fact needs exactly one literal value or entity target');
  const subjectId=entityIds[fact.subject]||fact.subject;
  const subject=actions.find(a=>a.recordId===subjectId)?.record||doc.records[subjectId];
  if(subject?.kind!=='entity')throw new OntologyError('invalid_input','fact subject must be an entity key or queried entity ID');
  const objectId=fact.target?(entityIds[fact.target]||fact.target):undefined;
  const target=objectId?(actions.find(a=>a.recordId===objectId)?.record||doc.records[objectId]):undefined;
  if(objectId && target?.kind!=='entity')throw new OntologyError('invalid_input','fact target must be an entity');
  const valueType=objectId?'entity':typeof fact.value==='number'?'number':typeof fact.value==='boolean'?'boolean':'text';
  const definitionId=stableId(moduleId+':property:'+fact.relation+':'+subject.typeId+':'+(target?.typeId||valueType));
  if(!doc.records[definitionId]&&!actions.some(a=>a.recordId===definitionId))add(definitionId,{kind:'definition',moduleId,name:fact.relation,description:'',definitionKind:objectId?'relation':'attribute',subjectTypes:[subject.typeId],objectTypes:target?[target.typeId]:[],valueType,cardinality:'many',cardinalityAnchor:'subject'},draft.evidence);
  const id=stableId(moduleId+':fact:'+fact.key);keys[fact.key]=id;
  if(doc.records[id])throw new OntologyError('already_exists','fact key already exists; query then use correct/change with the recorded version');
  add(id,{kind:'assertion',moduleId,subjectId,definitionId,object:objectId?{kind:'entity',id:objectId}:{kind:'literal',valueType,value:fact.value},validity:{from:fact.from??null,until:fact.until??null,precision:'day',timezone:'Asia/Shanghai'}},fact.evidence);
 }
 if(!actions.length)throw new OntologyError('invalid_input','draft has no new content');
 if(actions.length>50)throw new OntologyError('capacity_exceeded','draft exceeds 50 changes; split schema and instances into separate drafts');
 const result=await saveConversationOntology(userId,{command:{commandId,expectedRevision:draft.expectedRevision,actions},evidence:proofs},options);
 return {...result,moduleId,keyToId:keys,typeIds,entityIds};
}
