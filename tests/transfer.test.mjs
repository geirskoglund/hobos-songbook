import test from 'node:test';
import assert from 'node:assert/strict';
import {transferPlan} from '../src/domain/transfer.ts';
const song=(id,book,filename,title=id)=>({id,songbookId:book,title,origin:{filename}});
test('transfer: imported names match only other songs in the destination, including their extension',()=>{
 const rows=[song('a','source','same.txt'),song('b','target','same.txt'),song('c','other','same.txt'),song('d','target','same.cho')];
 const plan=transferPlan(rows,'source','target');assert.deepEqual(plan.matches.map(m=>[m.songId,m.matches]),[['a',['b']]]);
 assert.equal(transferPlan(rows,'source','empty').matches.length,0);
});
test('transfer: app-created songs use their stored file name and never match through an empty origin',()=>{
 const rows=[song('a','source','','Changed title'),song('b','target','','Other title'),song('c','target','','Changed title')];
 assert.deepEqual(transferPlan(rows,'source','target',{a:'Original name.cho',b:'Original name.cho'}).matches[0].matches,['b']);
 assert.deepEqual(transferPlan(rows,'source','target').matches[0].matches,['c']);
});
test('transfer: candidate changes invalidate approval without treating an unrelated book as a change',()=>{
 const rows=[song('a','source','a.cho'),song('b','target','a.cho')],plan=transferPlan(rows,'source','target');
 assert.equal(transferPlan([...rows,song('c','other','a.cho')],'source','target').signature,plan.signature);
 assert.notEqual(transferPlan([...rows,song('c','target','a.cho')],'source','target').signature,plan.signature);
});
