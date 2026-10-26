const test=require('node:test');
const assert=require('node:assert/strict');
process.env.STORE_BACKEND='memory';
const scenarioService=require('../src/services/scenarioService');
const sessions=require('../src/services/sessionService');
const {createMemoryPlanService}=require('../src/services/planService');
const scenarioId='scn_swe_junior_behavioral';

test('inactive scenario blocks new interview and plan creation while preserving old session and plan item updates',async()=>{
 const original=scenarioService.isActive;const plans=createMemoryPlanService();const user='scenario-lifecycle-test';let oldSession;
 try{
  scenarioService.isActive=()=>true;
  const created=await sessions.startSession(user,scenarioId);oldSession=created.session.id;
  await sessions.submitAnswer(user,oldSession,'I worked on a project with my team to deliver the result.');
  const plan=await plans.create(user,{title:'Existing',items:[{scenarioId,scheduledDate:'2026-10-27',status:'scheduled'}]});
  scenarioService.isActive=id=>id!==scenarioId;
  await assert.rejects(sessions.startSession('new-user',scenarioId),error=>error.status===409&&error.code==='SCENARIO_INACTIVE');
  const reopened=await sessions.startSession(user,scenarioId);
  assert.equal(reopened.session.id,oldSession);
  assert.equal(reopened.question.index,1);
  await assert.rejects(plans.create(user,{title:'New',items:[{scenarioId,scheduledDate:'2026-10-28'}]}),error=>error.code==='SCENARIO_INACTIVE');
  const item=plan.items[0];
  const updated=await plans.updateItem(user,item.id,{status:'done'});
  assert.equal(updated.status,'done');
 }finally{
  scenarioService.isActive=original;
  if(oldSession)await sessions.deleteSession(user,oldSession).catch(()=>{});
 }
});
