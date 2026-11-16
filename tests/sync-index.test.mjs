import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedFiles} from '../src/sync/remote.ts';
import {newSyncState} from '../src/sync/model.ts';

test('Dropbox recursive FileMetadata may arrive without its parents; required book identity is fetched once',async()=>{
 const state=newSyncState('account'),lookups=[];
 const raw={async changes(){return{entries:[{id:'id:file',path:'/Songbooks/New/Private/song.cho',rev:'rev1',folder:false}],cursor:'cursor1',reset:true};},async locateFolder(path){lookups.push(path);return{id:'id:book',path};}};
 const index=indexedFiles(raw,state);await index.refresh();assert.deepEqual(await index.files.list('/Songbooks'),[{id:'id:book',path:'/Songbooks/New',folder:true}]);assert.deepEqual(lookups,['/Songbooks/New']);await index.files.list('/Songbooks');assert.equal(lookups.length,1);
});
test('Dropbox FileMetadata replacing a folder removes its descendants from the metadata cache',async()=>{
 const state=newSyncState('account');state.remote={cursor:'old',entries:{'/songbooks/a':{id:'id:folder',path:'/Songbooks/A',folder:true},'/songbooks/a/child':{id:'id:child',path:'/Songbooks/A/child',folder:false,rev:'old'}}};
 const index=indexedFiles({async changes(){return{entries:[{id:'id:new-file',path:'/Songbooks/A',rev:'new',folder:false}],cursor:'new',reset:false};}},state);await index.refresh();assert.equal(index.find('id:child'),undefined);assert.equal(index.find('/Songbooks/A').id,'id:new-file');
});
