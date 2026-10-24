import React,{useRef,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,ScrollView,Text,TextInput} from 'react-native';
import {router} from 'expo-router';
import {useAuth} from '@/core/context/AuthContext';
import {colors} from '@/core/theme';
import {cancelSoftwareTestShift} from '@/core/services/workPeriodAuthority/cancelSoftwareTestShift';

export default function CancelSoftwareTestShiftScreen(){
 const {user,shiftActive,refreshShiftAuthority}=useAuth();
 const owner=useRef(user);owner.current=user;
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const latch=useRef(false);
 const cancel=async()=>{
  if(latch.current||!user?.companyId||!shiftActive)return;
  const captured=user;latch.current=true;setBusy(true);
  try{
   const result=await cancelSoftwareTestShift(reason,{driverId:captured.driverId,companyId:captured.companyId!});
   if(owner.current?.driverId!==captured.driverId||owner.current?.companyId!==captured.companyId)return;
   await refreshShiftAuthority();
   setMessage(result.hosEndPending?'Test cancelled. HOS end is saved for automatic delivery.':'Test cancelled and HOS ended. Original test records are preserved.');
  }catch(error){setMessage(error instanceof Error?error.message:'Test cancellation could not be confirmed.');}
  finally{latch.current=false;setBusy(false);}
 };
 return <ScrollView style={{flex:1,backgroundColor:colors.bg.primary}} contentContainerStyle={{padding:28,paddingTop:65}} keyboardShouldPersistTaps="handled">
  <Text style={{color:colors.text.primary,fontSize:26,fontWeight:'700',marginBottom:20}}>Cancel authorized software test</Text>
  <Text style={{color:colors.text.primary,fontSize:18,marginBottom:22}}>For an operator-authorized test session only. The server verifies the exact shift, closed test-well jobs and absence of inspections. Its original records and cancellation reason remain in the audit history.</Text>
  <TextInput accessibilityLabel="Test cancellation reason" value={reason} onChangeText={setReason} editable={!busy} maxLength={240} multiline placeholder="Reason for cancelling the software test" placeholderTextColor={colors.text.muted} style={{color:colors.text.primary,borderWidth:1,borderColor:colors.text.muted,borderRadius:12,minHeight:110,padding:16,fontSize:18}}/>
  {!!message&&<Text accessibilityRole="alert" style={{color:colors.text.primary,fontSize:18,marginTop:20}}>{message}</Text>}
  {busy&&<ActivityIndicator color={colors.brand.accent} style={{marginTop:20}}/>}
  <Pressable accessibilityRole="button" disabled={busy||!shiftActive||reason.trim().length<8} style={{padding:20,marginTop:20,opacity:busy||!shiftActive||reason.trim().length<8?0.4:1}} onPress={()=>Alert.alert('Cancel this software test?','Confirm no actual inspection, driving or hauling work was performed. The HOS test session will be ended.',[{text:'Keep shift',style:'cancel'},{text:'Cancel authorized test',style:'destructive',onPress:()=>void cancel()}])}><Text style={{color:colors.brand.accent,fontSize:18,textAlign:'center',fontWeight:'700'}}>Cancel authorized test</Text></Pressable>
  <Pressable accessibilityRole="button" disabled={busy} style={{padding:20}} onPress={()=>router.replace('/home')}><Text style={{color:colors.brand.accent,fontSize:18,textAlign:'center'}}>Suite home</Text></Pressable>
 </ScrollView>;
}
