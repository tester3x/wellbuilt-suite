import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resumeShiftInspection} from './resumeShiftInspection';
function setup(done=false){
  const calls:string[]=[];
  return {calls,deps:{currentShift:async()=> 'current',complete:async(id:string,phase:string)=>{calls.push('check/'+id+'/'+phase);return done;},launch:async(id:string,phase:string)=>{calls.push('launch/'+id+'/'+phase);return {launched:true};}}};
}
test('interrupted unscoped pre-trip recovers only the current shift',async()=>{const s=setup();assert.equal(await resumeShiftInspection({active:true},s.deps),'launched');assert.deepEqual(s.calls,['check/current/pre_trip','launch/current/pre_trip']);});
test('completed pre-trip never starts a duplicate',async()=>{const s=setup(true);assert.equal(await resumeShiftInspection({active:true},s.deps),'complete');assert.deepEqual(s.calls,['check/current/pre_trip']);});
test('off-shift, foreign shift and invalid phase cannot launch',async()=>{for(const input of [{active:false},{active:true,requestedShift:'old'},{active:true,phase:'bad'}]){const s=setup();await resumeShiftInspection(input,s.deps);assert.deepEqual(s.calls,[]);}});
test('explicit post-trip recovery preserves its phase',async()=>{const s=setup();assert.equal(await resumeShiftInspection({active:true,requestedShift:'current',phase:'post_trip'},s.deps),'launched');assert.deepEqual(s.calls,['check/current/post_trip','launch/current/post_trip']);});
test('a failed launch remains retryable',async()=>{const s=setup();let count=0;const deps={...s.deps,launch:async()=>({launched:++count>1})};await assert.rejects(resumeShiftInspection({active:true},deps));assert.equal(await resumeShiftInspection({active:true},deps),'launched');});

test('post-only arrival recovery never launches equipment pretending a pre-trip is complete',async()=>{
  const s=setup();
  const deps={...s.deps,canFinishCompletedArrival:async(id:string)=>id==='current'};
  assert.equal(await resumeShiftInspection({active:true},deps),'finish_shift');
  assert.deepEqual(s.calls,['check/current/pre_trip']);
  const explicitPost=setup();
  assert.equal(await resumeShiftInspection({active:true,phase:'post_trip'},{...explicitPost.deps,canFinishCompletedArrival:async()=>true}),'launched');
  assert.deepEqual(explicitPost.calls,['check/current/post_trip','launch/current/post_trip']);
});

test('unconfirmed recovery still opens the real pre-trip; foreign requests never inspect recovery',async()=>{
  const s=setup();let recoveries=0;
  const deps={...s.deps,canFinishCompletedArrival:async()=>{recoveries++;return false;}};
  assert.equal(await resumeShiftInspection({active:true,requestedShift:'foreign'},deps),'mismatch');
  assert.equal(recoveries,0);
  assert.equal(await resumeShiftInspection({active:true},deps),'launched');
  assert.equal(recoveries,1);
});
