import React,{useEffect,useRef,useState} from 'react';
import {View,Text,TextInput,Pressable,ActivityIndicator} from 'react-native';
import {router} from 'expo-router';
import {getDriverSession} from '../src/core/services/driverAuth';
import {reverifyCurrentSuiteAccount} from '../src/core/services/secureDriverAuth';
import {colors} from '../src/core/theme';
export default function VerifySession(){
 const alive=useRef(true);const [name,setName]=useState('');const [passcode,setPasscode]=useState('');const [busy,setBusy]=useState(false);const [failed,setFailed]=useState(false);
 useEffect(()=>{alive.current=true;void getDriverSession().then(s=>{if(alive.current)setName(s?.displayName||'');});return()=>{alive.current=false;};},[]);
 const verify=async()=>{if(busy||!passcode)return;const credential=passcode;setPasscode('');setBusy(true);setFailed(false);try{await reverifyCurrentSuiteAccount(credential,()=>alive.current);if(alive.current)router.replace('/home');}catch{if(alive.current)setFailed(true);}finally{if(alive.current)setBusy(false);}};
 return <View style={{flex:1,backgroundColor:colors.bg.primary,padding:28,justifyContent:'center',gap:18}}>
 <Text style={{color:colors.text.primary,fontSize:24}}>Verify Suite sign-in</Text>
 <Text style={{color:colors.text.secondary}}>Enter the passcode for {name||'your current account'}. Your shift stays open and its inspection status stays unchanged.</Text>
 <TextInput accessibilityLabel="Account passcode" secureTextEntry autoCapitalize="none" autoCorrect={false} value={passcode} onChangeText={setPasscode} editable={!busy} placeholder="Passcode" placeholderTextColor={colors.text.secondary} style={{color:colors.text.primary,borderWidth:1,borderColor:colors.text.secondary,padding:14,borderRadius:8}} onSubmitEditing={()=>void verify()}/>
 {failed?<Text style={{color:colors.text.primary}}>Could not verify this same account. Check the passcode and connection, then retry.</Text>:null}
 {busy?<ActivityIndicator/>:<Pressable accessibilityRole="button" disabled={!name||!passcode} onPress={()=>void verify()} hitSlop={12}><Text style={{color:colors.brand.accent,fontSize:18}}>Verify sign-in</Text></Pressable>}
 <Pressable accessibilityRole="button" disabled={busy} onPress={()=>router.replace('/home')} hitSlop={12}><Text style={{color:colors.brand.accent}}>Return to Suite</Text></Pressable>
 </View>;
}
