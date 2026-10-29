const assert=require('node:assert/strict');
const {test}=require('node:test');
const {profileFor,validateReservation}=require('./android-local-release.cjs');
test('reservation requires the reconciled Suite branch and an annotated remote tag on exact source',()=>{
 const rows='abc refs/heads/codex/release\ntag refs/tags/android-release-v106\nabc refs/tags/android-release-v106^{}';
 assert.doesNotThrow(()=>validateReservation(rows,'abc','codex/release',106));
 assert.throws(()=>validateReservation(rows.replace('abc refs/heads/','other refs/heads/'),'abc','codex/release',106),/moved/);
 assert.throws(()=>validateReservation(rows.replace('abc refs/tags','other refs/tags'),'abc','codex/release',106),/reservation/);
 assert.throws(()=>validateReservation(rows+'\nnew refs/tags/android-release-v107','abc','codex/release',106),/higher/);
 assert.throws(()=>validateReservation(rows.split('\n').slice(0,2).join('\n'),'abc','codex/release',106),/annotated/);
});
test('profile inheritance retains release flags and rejects unknown/cyclic profiles',()=>{
 const profiles={preview:{env:{FLAG:'1'},android:{buildType:'apk'}},device:{extends:'preview',env:{OTHER:'2'}}};
 assert.deepEqual(profileFor(profiles,'device').env,{FLAG:'1',OTHER:'2'});
 assert.equal(profileFor(profiles,'device').android.buildType,'apk');
 assert.throws(()=>profileFor(profiles,'missing'));
 assert.throws(()=>profileFor({a:{extends:'b'},b:{extends:'a'}},'a'));
});
