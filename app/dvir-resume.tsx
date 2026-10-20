/** Recovery requests carry no inspection authority. Resolve the current Suite
 * shift and matching receipt before launching the existing governed handoff. */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router, useRootNavigationState, useLocalSearchParams } from 'expo-router';
import { getCurrentShiftId } from '@/core/services/shiftTracking';
import { resumeShiftInspection } from '@/core/services/dvirGate/resumeShiftInspection';
import { useAuth } from '@/core/context/AuthContext';
import { createSuiteDvirGate, makeDvirSsoGetter } from '@/core/services/dvirGate';
import { colors } from '@/core/theme';

export default function DvirResumeScreen() {
  const { user, loading, shiftActive } = useAuth();
  const navigation = useRootNavigationState();
  const params = useLocalSearchParams<{shiftId?:string;phase?:string}>();
  const busy = useRef(false);
  const started = useRef(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('Restoring your shift inspection...');
  const resume = async () => {
    if (busy.current || loading || !navigation?.key) return;
    busy.current = true; setWorking(true);
    try {
      if (!user || !shiftActive) {
        setMessage('No active shift is ready. Return to Suite to restore or start your shift.');
        return;
      }
      const gate = createSuiteDvirGate({ getSso: makeDvirSsoGetter(user), isShiftActive: () => shiftActive });
      const result = await resumeShiftInspection({active:shiftActive,requestedShift:params.shiftId,phase:params.phase}, {
        currentShift:getCurrentShiftId,
        complete:(id,phase)=>phase==='post_trip'?gate.isPostTripComplete(id):gate.isPreTripComplete(id),
        launch:(id,phase)=>gate.launchPhase(phase,id),
      });
      setMessage(result === 'launched' ? 'Your inspection is opening. If interrupted, tap Resume inspection again.'
        : result === 'complete' ? 'This inspection is already recorded for your current shift.'
        : 'This request does not match your active shift. Return to Suite home.');
    } catch {
      setMessage('Could not reopen the inspection. Your shift is still open. Try again.');
    } finally { busy.current = false; setWorking(false); }
  };
  useEffect(() => {
    if (loading || !navigation?.key || started.current) return;
    started.current = true; void resume();
  }, [loading, navigation?.key, user, shiftActive]);
  return <View style={{flex:1,backgroundColor:colors.bg.primary,justifyContent:'center',padding:28}}>
    {(loading || working) && <ActivityIndicator color={colors.brand.accent}/>}
    <Text style={{color:colors.text.primary,textAlign:'center',fontSize:18,marginVertical:20}}>{message}</Text>
    <Pressable disabled={loading || working} accessibilityRole="button" onPress={() => void resume()} style={{padding:16}}>
      <Text style={{color:colors.brand.accent,textAlign:'center',fontSize:18}}>Resume inspection</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={() => router.replace('/home')} style={{padding:16}}>
      <Text style={{color:colors.brand.accent,textAlign:'center'}}>Suite home</Text>
    </Pressable>
  </View>;
}
