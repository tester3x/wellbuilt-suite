import React from 'react';
import { useSkin } from '@/core/context/SkinContext';

export default function HomeRoute() {
  const { skin } = useSkin();
  const Screen = skin.screens.HomeScreen;
  return <Screen />;
}
