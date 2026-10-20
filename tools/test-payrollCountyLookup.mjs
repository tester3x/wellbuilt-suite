import fs from 'node:fs';import ts from 'typescript';import vm from 'node:vm';import assert from 'node:assert/strict';
const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/core/services/payroll.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:m,exports:m.exports,require:()=>({})});
const {payrollCountyOperators:f}=m.exports;
const invoices=[{operator:'A',county:'Known'},{operator:'B',county:''},{operator:'B',county:''}];
assert.equal(f(invoices,null).length,0);assert.equal(f(invoices,{frostZones:{}}).length,0);
assert.equal(JSON.stringify(f(invoices,{frostZones:{'All Counties':{startDate:'2026-01-01'}}})),JSON.stringify(['B']));
console.log('County lookup skips unused frost geography and invoices already carrying a county.');
