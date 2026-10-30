const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {publishWithRecovery}=require('../modules/wellbuilt-platform/accountPublication');
const timeout=()=>Object.assign(Error('timed out'),{code:'functions/deadline-exceeded'});
test('explicit verified login retries a lost publication reply once',async()=>{
 let calls=0;const waits=[],reports=[];
 await publishWithRecovery({explicit:true,isCurrent:()=>true,publish:async()=>{if(++calls===1)throw timeout();},wait:async ms=>waits.push(ms),report:d=>reports.push(d)});
 assert.equal(calls,2);assert.deepEqual(waits,[500]);assert.equal(reports[0].code,'functions/deadline-exceeded');
});
test('background SDK restoration never retries as an explicit login',async()=>{
 let calls=0;await assert.rejects(()=>publishWithRecovery({explicit:false,isCurrent:()=>true,publish:async()=>{calls++;throw timeout();}}));assert.equal(calls,1);
});
test('account switch while waiting prevents publishing the prior owner again',async()=>{
 let calls=0,current=true;await publishWithRecovery({explicit:true,isCurrent:()=>current,publish:async()=>{calls++;throw timeout();},wait:async()=>{current=false;}});assert.equal(calls,1);
});
test('permission refusal is not retried',async()=>{
 let calls=0;await assert.rejects(()=>publishWithRecovery({explicit:true,isCurrent:()=>true,publish:async()=>{calls++;throw Object.assign(Error('denied'),{code:'functions/permission-denied'});}}));assert.equal(calls,1);
});
test('second transport failure is bounded and remains an error',async()=>{
 let calls=0;await assert.rejects(()=>publishWithRecovery({explicit:true,isCurrent:()=>true,publish:async()=>{calls++;throw timeout();},wait:async()=>{}}));assert.equal(calls,2);
});
test('successful publication is not repeated',async()=>{
 let calls=0;await publishWithRecovery({explicit:true,isCurrent:()=>true,publish:async()=>{calls++;}});assert.equal(calls,1);
});
test('real app wrapper gives cold requests time and uses guarded publication recovery',()=>{
 const file=fs.existsSync('src/services/deviceAccount.ts')?'src/services/deviceAccount.ts':'src/core/services/deviceAccount.ts';
 const source=fs.readFileSync(file,'utf8');const deadline=Number(source.match(/timeout:\s*(\d+)/)[1]);
 assert(deadline>=45000,'shared login must outlast the observed 18.25-second cold request');
 assert(source.includes('await publishWithRecovery({explicit,isCurrent,'));
});
