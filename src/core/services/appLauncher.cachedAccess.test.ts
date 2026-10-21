import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function harness(){
 const opened:string[]=[],notices:string[]=[],stored=new Map<string,string>();
 let permitted:boolean|null=true,checks=0;
 const exports:any={};
 const mocks:any={
  '../../../modules/wellbuilt-platform/appAccess':{checkAppAccess:async()=>{checks++;return permitted;}},
  './platformRuntime.generated':{PLATFORM_APP_OPEN_HOST:'app-open',buildPlatformAppEntryUrl:({scheme}:any)=>scheme+'://app-open'},
  './equipmentAppAccessCore':{isEquipmentAppTarget:(scheme:string)=>scheme==='wbequipment',equipmentAppEntryUrl:()=> 'wbequipment://app-open'},
  'react-native':{Linking:{openURL:async(url:string)=>opened.push(url)},Alert:{alert:(...args:string[])=>notices.push(args.join(' '))},Platform:{OS:'android'}},
  'expo-secure-store':{getItemAsync:async(key:string)=>stored.get(key)||null,setItemAsync:async(key:string,value:string)=>stored.set(key,value)},
  '../localization/i18n':{__esModule:true,default:{t:(key:string)=>key}},
 };
 runInNewContext(ts.transpileModule(readFileSync('src/core/services/appLauncher.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URLSearchParams,require:(id:string)=>{assert.ok(id in mocks,id);return mocks[id];}});
 return {api:exports,opened,notices,checks:()=>checks,permit:(value:boolean|null)=>permitted=value};
}
for(const scheme of ['wbequipment','wellbuilt-tickets','wellbuiltmobile','jsaapp','wellbuilttimecard','tickettime'])test('tap-time cached account controls '+scheme+' without any Firebase dependency',async()=>{
 const h=harness();
 await h.api.launchWBApp({name:'App',scheme,startHost:'app-open'});assert.equal(h.opened.length,1);
 h.permit(false);await h.api.launchWBApp({name:'App',scheme,startHost:'app-open'});
 assert.equal(h.opened.length,1);assert.equal(h.notices.length,1);assert.equal(h.checks(),2);
 h.permit(true);await h.api.launchWBApp({name:'App',scheme,startHost:'app-open'});assert.equal(h.opened.length,2);
});
