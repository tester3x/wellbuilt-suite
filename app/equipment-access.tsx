import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Pressable,Text,View} from 'react-native';
import {router,useLocalSearchParams} from 'expo-router';
import {authorizeEquipmentAppAccess} from '../src/core/services/equipmentAppAccessRuntime';
import {colors} from '../src/core/theme';
export default function EquipmentAccess(){
 const params=useLocalSearchParams();const [failed,setFailed]=useState(false);
 const state=params.state;const challenge=params.codeChallenge;
 useEffect(()=>{let active=true;setFailed(false);
   void authorizeEquipmentAppAccess(params,()=>active).then(()=>{if(active)router.replace('/home');}).catch(()=>{if(active)setFailed(true);});
   return()=>{active=false;};
 },[state,challenge]);
 return <View style={{flex:1,backgroundColor:colors.bg.primary,justifyContent:'center',padding:28,gap:20}}>
 <Text style={{color:colors.text.primary,fontSize:20}}>{failed?'Could not connect to Equipment. Return to Suite and retry.':'Connecting to Equipment…'}</Text>
 {failed?<Pressable accessibilityRole="button" onPress={()=>router.replace('/home')}><Text style={{color:colors.brand.accent,fontSize:17}}>Return to Suite</Text></Pressable>:<ActivityIndicator color={colors.brand.accent}/>}
 </View>;
}
