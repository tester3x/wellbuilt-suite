const React=require('react');
const {View,Text,Pressable,ActivityIndicator,AppState}=require('react-native');
/** Keeps the navigation tree mounted while protecting it during account adoption. */
module.exports=function AccountGate({restore,clearLocal,children}){
 const [state,setState]=React.useState({phase:'checking',error:null,generation:0});
 const active=React.useRef(true),running=React.useRef(null);
 const run=React.useCallback(()=>{
  if(running.current)return running.current;
  setState(s=>({...s,phase:'checking',error:null}));
  running.current=Promise.resolve().then(restore).then(result=>{
   if(active.current)setState(s=>({phase:'ready',error:null,generation:s.generation+(result==='restored'?1:0)}));
  },error=>{if(active.current)setState(s=>({...s,phase:'error',error}));})
   .finally(()=>{running.current=null;});return running.current;
 },[restore]);
 React.useEffect(()=>{active.current=true;void run();const sub=AppState.addEventListener('change',v=>{if(v==='active')void run();});return()=>{active.current=false;sub.remove();};},[run]);
 const [pending,setPending]=React.useState(false);
 React.useEffect(()=>{let timer;const unsubscribe=require('./delivery').subscribePending(()=>{setPending(true);clearTimeout(timer);timer=setTimeout(()=>setPending(false),6000);});return()=>{unsubscribe();clearTimeout(timer);};},[]);
 const ready=state.phase==='ready';
 const signIn=async()=>{try{await clearLocal?.();setState(s=>({phase:'ready',error:null,generation:s.generation+1}));}catch{}};
 return React.createElement(View,{style:{flex:1,backgroundColor:'#0b1020'}},
  React.createElement(View,{style:{flex:1,opacity:ready?1:0},pointerEvents:ready?'auto':'none'},React.createElement(React.Fragment,{key:state.generation},children)),
  ready&&pending&&React.createElement(View,{pointerEvents:'none',style:{position:'absolute',left:16,right:16,bottom:100,padding:14,borderRadius:12,backgroundColor:'#182335'}},React.createElement(Text,{style:{color:'white',textAlign:'center',fontSize:15}},'Saved on device; will send when connected.')),
  !ready&&React.createElement(View,{style:{position:'absolute',top:0,bottom:0,left:0,right:0,justifyContent:'center',padding:28}},
   state.phase==='checking'?React.createElement(ActivityIndicator,{color:'#e5b52e',size:'large'}):React.createElement(React.Fragment,null,
    React.createElement(Text,{style:{color:'white',fontSize:21,fontWeight:'600',marginBottom:16}},state.error?.code==='platform/access-denied'?'App access unavailable':state.error?.code==='platform/signed-out'?'Signed out of WellBuilt':'Your saved work is still on this device'),
    React.createElement(Text,{style:{color:'#cbd5e1',fontSize:17,marginBottom:24}},state.error?.code?.startsWith('platform/')?state.error.message:'Unable to finish opening this account. Check the connection and retry. You do not need to enter your password again.'),
    React.createElement(Pressable,{onPress:run,style:{padding:16,borderRadius:12,backgroundColor:'#e5b52e',marginBottom:14}},React.createElement(Text,{style:{textAlign:'center',fontWeight:'700',fontSize:17}},'Retry')),
    state.error?.code==='platform/signed-out'&&clearLocal&&React.createElement(Pressable,{onPress:signIn,style:{padding:16}},React.createElement(Text,{style:{color:'white',textAlign:'center',fontSize:17}},'Sign in')))));
};
