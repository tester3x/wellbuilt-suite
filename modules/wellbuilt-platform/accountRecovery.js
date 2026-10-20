const {classifyPlatformFailure}=require('./policy');
const codes=new Set(['functions/unavailable','functions/deadline-exceeded','auth/network-request-failed','platform/superseded','platform/signed-out','platform/access-denied','functions/permission-denied','functions/unauthenticated','auth/user-disabled','auth/user-token-expired']);
function diagnostic(error){const value=String(error?.code||'');return {code:codes.has(value)?value:'unknown',kind:classifyPlatformFailure(error)};}
/** Bounded recovery only. Every attempt re-reads the protected account and live SDK owner. */
async function restoreWithRecovery({restore,isActive,wait,report}){
 for(let attempt=0;;attempt++){
  if(!isActive())throw Object.assign(Error('Account check cancelled.'),{code:'platform/superseded'});
  try{return await restore();}catch(error){
   const detail=diagnostic(error);report({...detail,attempt:attempt+1});
   if((detail.kind!=='transport'&&detail.code!=='platform/superseded')||attempt>=2||!isActive())throw error;
   await wait([500,1500][attempt]);
  }
 }
}
module.exports={diagnostic,restoreWithRecovery};
