import React from 'react';
import { useSkin } from '@/core/context/SkinContext';

export default function SettingsRoute() {
  const { skin } = useSkin();
  const Screen = skin.screens.SettingsScreen;
  return <Screen />;
}
