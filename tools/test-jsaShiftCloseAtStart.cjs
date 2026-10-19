const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const moduleFixture={exports:{}};let reads=0;
const source=ts.transpileModule(fs.readFileSync('src/core/services/shiftJsaCloseLive.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
new Function('require','module','exports',source)(()=>new Proxy({},{get:()=>()=>{reads++;throw Error('Legacy JSA reader must not run at clock-out');}}),moduleFixture,moduleFixture.exports);
(async()=>{assert.deepEqual(await moduleFixture.exports.suiteShiftJsaCloseGate(),{kind:'not_required',reason:'start_of_work'});assert.equal(reads,0);console.log('Live clock-out composition passed: no legacy reads, no fabricated signature, no extra JSA ceremony.');})().catch(e=>{console.error(e);process.exitCode=1});
