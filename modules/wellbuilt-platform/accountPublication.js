const transportCodes=new Set(['functions/unavailable','functions/deadline-exceeded','auth/network-request-failed']);
/** Only an explicit verified sign-in may retry publishing a new device grant.
 * Never turn a restored SDK session into permission to undo a device sign-out. */
async function publishWithRecovery({publish,isCurrent,explicit,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),report=()=>{}}){
 try{return await publish();}catch(error){
  if(!explicit||!transportCodes.has(error?.code)||!isCurrent())throw error;
  report({event:'retry',code:error.code});await wait(500);
  if(!isCurrent())return;
  try{return await publish();}catch(second){report({event:'failed',code:transportCodes.has(second?.code)?second.code:'other'});throw second;}
 }
}
module.exports={publishWithRecovery};
