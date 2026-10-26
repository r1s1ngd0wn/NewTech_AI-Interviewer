const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createScenarioCatalog}=require('../src/services/scenarioCatalog');

function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scenario-catalog-'));const filePath=path.join(dir,'overrides.json');const scenarios=[
 {id:'first',title:'Alpha',industry:'Tech',seniority:'Junior',questionType:'Behavioral',questions:[{id:'q1',text:'Secret question',keywords:['private']}],persona:'private persona'},
 {id:'second',title:'Beta',industry:'Finance',seniority:'Senior',questionType:'Technical',questions:[{id:'q1',text:'Other question'}]},
 ];return {dir,filePath,scenarios,catalog:createScenarioCatalog({scenarios,filePath,fs})};}

test('scenario metadata and status persist without changing question content',async()=>{
 const f=fixture();try{
  const before=f.catalog.getScenario('first');
  const updated=await f.catalog.update('first',{title:'Renamed',industry:'Product',isActive:false});
  assert.equal(updated.title,'Renamed');assert.equal(updated.isActive,false);
  assert.equal(f.catalog.getScenario('first').questions[0].text,before.questions[0].text);
  assert.equal(f.catalog.getScenario('first').questions[0].keywords,before.questions[0].keywords);
  const restarted=createScenarioCatalog({scenarios:f.scenarios,filePath:f.filePath,fs});
  assert.equal(restarted.getScenario('first').title,'Renamed');assert.equal(restarted.isActive('first'),false);
  assert.equal(restarted.getPublicScenario('first').questions,undefined);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('inactive scenarios disappear from public browse and recommendations but remain in admin catalog',async()=>{
 const f=fixture();try{
  await f.catalog.update('first',{isActive:false});
  assert.deepEqual(f.catalog.listScenarios().map(x=>x.id),['second']);
  assert.deepEqual(f.catalog.recommendFor(null).map(x=>x.id),['second']);
  assert.equal(f.catalog.adminList({status:'all'}).total,2);
  assert.equal(f.catalog.adminList({status:'inactive'}).scenarios[0].id,'first');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('scenario update rejects content fields and unknown IDs',async()=>{
 const f=fixture();try{
  await assert.rejects(f.catalog.update('missing',{title:'No'}),e=>e.status===404);
  await assert.rejects(f.catalog.update('first',{questions:[]}),e=>e.status===400);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
