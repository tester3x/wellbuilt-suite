import React,{useEffect,useState} from 'react';
import {AppState,View,Text,Pressable} from 'react-native';
import {useAuth} from '../context/AuthContext';
import {getCurrentShiftId} from '../services/shiftTracking';
import {preparedShiftJsa,prepareShiftJsa} from '../services/preparedShiftJsa';

/** Preparation remains visible until a complete, durable bundle is available.
 * Losing service never removes a previously prepared shift's content. */
export default function ShiftPreparation(){
 const {shiftActive}=useAuth();const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
 const [retry,setRetry]=useState(0);
 useEffect(()=>{if(!shiftActive)return;let live=true,running=false;
  const run=async()=>{if(running)return;running=true;const shiftId=await getCurrentShiftId();
   try{const {g}=await preparedShiftJsa.bundle();if(g.shiftId===shiftId&&live)setState('ready');}catch{if(live)setState('loading');}
   await prepareShiftJsa(shiftId||undefined);if(live){try{const {g}=await preparedShiftJsa.bundle();setState(g.shiftId===shiftId?'ready':'error');}catch{setState('error');}}
   running=false;
  };void run();const foreground=AppState.addEventListener('change',s=>{if(s==='active')void run();});
  const native=require('../../../modules/wellbuilt-platform'),connection=native?.addListener?.('connectionChanged',(v:any)=>{if(v.reachable)void run();});
  return()=>{live=false;foreground.remove();connection?.remove();};
 },[shiftActive,retry]);
 if(!shiftActive||state==='ready')return null;
 return <View style={{padding:12,backgroundColor:'#32280a'}}><Text style={{color:'#ffe295',textAlign:'center'}}>{state==='loading'?'Preparing offline jobs…':'Offline jobs are not ready yet. Connect to finish shift preparation.'}</Text>{state==='error'&&<Pressable onPress={()=>setRetry(v=>v+1)}><Text style={{color:'#ffffff',textAlign:'center',paddingTop:8}}>Retry preparation</Text></Pressable>}</View>;
}
