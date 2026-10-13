import React,{useEffect,useState,useRef} from 'react';
import {ActivityIndicator,Pressable,Text,View} from 'react-native';
import {router,useLocalSearchParams} from 'expo-router';
import {authorizeEquipmentAppAccess} from '../src/core/services/equipmentAppAccessRuntime';
import {colors} from '../src/core/theme';
export default function EquipmentAccess(){
 const params=useLocalSearchParams();const [failure,setFailure]=useState<string|null>(null);
 const cancelled=useRef(false);
 const leave=()=>{cancelled.current=true;router.dismissTo('/home');};
 const state=params.state;const challenge=params.codeChallenge;
 useEffect(()=>{let active=true;cancelled.current=false;setFailure(null);
   void authorizeEquipmentAppAccess(params,()=>active&&!cancelled.current).then(()=>{if(active&&!cancelled.current)router.dismissTo('/home');}).catch(error=>{
     // Closed diagnostic categories only: never log request values or server messages.
     const allowed=['invalid_request','session_missing','session_unverified','connection_unavailable','session_changed','account_changed','not_authorized','invalid_response'];
     const reason=allowed.includes(error?.message)?error.message:['functions/unauthenticated','functions/permission-denied','functions/unavailable','functions/deadline-exceeded'].includes(error?.code)?error.code:'handoff_failed';
     console.info('[EquipmentAccess] '+reason);
     if(active&&!cancelled.current)setFailure(reason);
   });
   return()=>{active=false;};
 },[state,challenge]);
 return <View style={{flex:1,backgroundColor:colors.bg.primary,justifyContent:'center',padding:28,gap:20}}>
 <Text style={{color:colors.text.primary,fontSize:20}}>{failure==='session_missing'||failure==='session_unverified'?'Sign in to Suite again to connect Equipment. Your saved work is unchanged.':failure?'Could not connect to Equipment. Return to Suite and retry.':'Connecting to Equipment…'}</Text>
 {failure?<Text style={{color:colors.text.secondary}}>Code: {failure}</Text>:<ActivityIndicator color={colors.brand.accent}/>}
 <Pressable accessibilityRole="button" onPress={leave} style={{minHeight:56,justifyContent:'center',padding:16,backgroundColor:colors.brand.primary,borderRadius:12}}><Text style={{color:colors.text.primary,fontSize:17}}>Return to Suite</Text></Pressable>
 </View>;
}
