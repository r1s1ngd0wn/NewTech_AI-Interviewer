const test=require('node:test');
const assert=require('node:assert/strict');
const {authenticate}=require('../src/services/supabaseAuth');

function fakeDb({user,active=true}){
 return {auth:{async getUser(){return {data:{user},error:null};}},async rpc(){return {data:active,error:null};},from(){return {select(){return this;},eq(){return this;},async single(){return {data:{id:user.id,name:'Test',role:'user',created_at:'2026-01-01',target_industry:null,target_role:null,experience_level:null},error:null};}};}};
}
test('inactive Auth app metadata rejects backend API authentication with a clear code',async()=>{
 await assert.rejects(authenticate('token',fakeDb({user:{id:'user-1',app_metadata:{is_active:false}}})),error=>error.status===401&&error.code==='ACCOUNT_INACTIVE');
});
test('a revoked session is distinct from an inactive account',async()=>{
 await assert.rejects(authenticate('token',fakeDb({user:{id:'user-1',app_metadata:{is_active:true}},active:false})),error=>error.status===401&&error.code==='SESSION_REVOKED');
});
