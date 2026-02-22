import React from 'react';
import { useSkin } from '@/core/context/SkinContext';

export default function AppDetailRoute() {
  const { skin } = useSkin();
  const Screen = skin.screens.AppDetailScreen;
  return <Screen />;
}
