const {createPlatformDeliveryRuntime}=require('./policy');
const native=require('./index');
let rn={};try{rn=require('react-native');}catch{}
let runtime;
const listeners=new Set();
exports.subscribePending=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
exports.getDelivery=()=>{
 if(runtime)return runtime;
 runtime=createPlatformDeliveryRuntime({now:()=>Date.now(),schedule:(fn,delay)=>{const timer=setTimeout(fn,delay);return()=>clearTimeout(timer);},notifyPending:()=>{for(const fn of listeners)fn();}});
 if(native?.connectionState){
  const refresh=()=>native.connectionState().then(s=>runtime.setReachable(s.reachable===true)).catch(()=>{});
  void refresh();native.addListener?.('connectionChanged',s=>runtime.setReachable(s.reachable===true));
  rn.AppState?.addEventListener('change',state=>{if(state==='active'){void refresh();void runtime.changed();}});
 }
 return runtime;
};
