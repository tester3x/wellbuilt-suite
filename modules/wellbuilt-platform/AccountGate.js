const React=require('react');
const {View,Text,Pressable,ActivityIndicator,AppState}=require('react-native');
const ReadyContext=React.createContext(true);
/** Keeps navigation mounted; native boundaries must survive opacity/overlay transitions. */
module.exports=function AccountGate({restore,clearLocal,returnToHub,children}){
 const [state,setState]=React.useState({phase:'checking',error:null,generation:0});
 const active=React.useRef(true),running=React.useRef(null),queued=React.useRef(false),failed=React.useRef(false),reachable=React.useRef(null);
 const signingIn=React.useRef(false),revision=React.useRef(0);
 const {restoreWithRecovery}=require('./accountRecovery');
 const run=React.useCallback((recheck=false)=>{
  if(running.current){if(recheck)queued.current=true;return running.current;}
  if(!signingIn.current)setState(s=>({...s,phase:'checking',error:null}));
  running.current=(async()=>{
   do{
    queued.current=false;
    const attemptRevision=revision.current;
    try{
     const result=await restoreWithRecovery({restore,isActive:()=>active.current,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),report:detail=>console.info('WB_ACCOUNT_GATE '+JSON.stringify(detail))});
     if(active.current&&!queued.current&&attemptRevision===revision.current){signingIn.current=false;failed.current=false;setState(s=>({phase:'ready',error:null,generation:s.generation+(result==='restored'?1:0)}));}
    }catch(error){if(active.current&&!queued.current&&attemptRevision===revision.current){
     if(signingIn.current&&error?.code==='platform/signed-out'){failed.current=false;setState(s=>({...s,phase:'signing-in',error:null}));}
     else{signingIn.current=false;failed.current=true;setState(s=>({...s,phase:'error',error}));}
    }}
   }while(active.current&&queued.current);
  })().finally(()=>{running.current=null;});return running.current;
 },[restore]);
 React.useEffect(()=>{active.current=true;void run();const native=require('./index');
  const sub=AppState.addEventListener('change',v=>{if(v==='active')void run();});
  const account=native?.addListener?.('accountChanged',()=>{void run(true);});
  const connection=native?.addListener?.('connectionChanged',v=>{const restored=reachable.current===false&&v.reachable;reachable.current=v.reachable;if(v.reachable&&failed.current||restored&&running.current)void run(true);});
  return()=>{active.current=false;sub.remove();account?.remove();connection?.remove();};},[run]);
 React.useEffect(()=>{if(state.phase==='error')try{void require('expo-splash-screen').hideAsync().catch(()=>{});}catch{}},[state.phase]);
 const [pending,setPending]=React.useState(false);
 React.useEffect(()=>{let timer;const unsubscribe=require('./delivery').subscribePending(()=>{setPending(true);clearTimeout(timer);timer=setTimeout(()=>setPending(false),6000);});return()=>{unsubscribe();clearTimeout(timer);};},[]);
 const ready=state.phase==='ready'||state.phase==='signing-in';
 // This context releases local auth startup; it is not proof of authentication.
 // Interactive sign-in must let AuthProvider finish its signed-out session check.
 const everReady=React.useRef(false);if(ready)everReady.current=true;
 const signIn=async()=>{
  revision.current++;signingIn.current=true;
  try{await clearLocal?.();if(active.current)setState(s=>({phase:'signing-in',error:null,generation:s.generation+1}));}
  catch(error){signingIn.current=false;if(active.current)setState(s=>({...s,phase:'error',error}));}
 };
 return React.createElement(ReadyContext.Provider,{value:everReady.current},React.createElement(View,{collapsable:false,style:{flex:1,backgroundColor:'#0b1020'}},
  React.createElement(View,{collapsable:false,style:{flex:1,opacity:ready?1:0},pointerEvents:ready?'auto':'none'},React.createElement(React.Fragment,{key:state.generation},children)),
  ready&&pending&&React.createElement(View,{pointerEvents:'none',style:{position:'absolute',left:16,right:16,bottom:100,padding:14,borderRadius:12,backgroundColor:'#182335'}},React.createElement(Text,{style:{color:'white',textAlign:'center',fontSize:15}},'Saved on device; will send when connected.')),
  !ready&&React.createElement(View,{collapsable:false,style:{position:'absolute',top:0,bottom:0,left:0,right:0,justifyContent:'center',padding:28}},
   state.phase==='checking'?React.createElement(ActivityIndicator,{color:'#e5b52e',size:'large'}):React.createElement(React.Fragment,null,
    React.createElement(Text,{style:{color:'white',fontSize:21,fontWeight:'600',marginBottom:16}},state.error?.code==='platform/access-denied'?'App access unavailable':state.error?.code==='platform/signed-out'?'Signed out of WellBuilt':'Your saved work is still on this device'),
    React.createElement(Text,{style:{color:'#cbd5e1',fontSize:17,marginBottom:24}},state.error?.code?.startsWith('platform/')?state.error.message:'Unable to finish opening this account. Check the connection and retry. You do not need to enter your password again.'),
    state.error?.code!=='platform/signed-out'&&React.createElement(Pressable,{onPress:()=>run(),style:{padding:16,borderRadius:12,backgroundColor:'#e5b52e',marginBottom:14}},React.createElement(Text,{style:{textAlign:'center',fontWeight:'700',fontSize:17}},'Retry')),
    returnToHub&&React.createElement(Pressable,{onPress:returnToHub,style:{padding:16}},React.createElement(Text,{style:{color:'#a5b4fc',textAlign:'center',fontSize:17}},'Return to Suite')),
    state.error?.code==='platform/signed-out'&&clearLocal&&React.createElement(Pressable,{onPress:signIn,style:{padding:16}},React.createElement(Text,{style:{color:'white',textAlign:'center',fontSize:17}},'Sign in'))))));
};

module.exports.useAccountReady=()=>React.useContext(ReadyContext);
