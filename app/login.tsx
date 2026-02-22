import React from 'react';
import { useSkin } from '@/core/context/SkinContext';

export default function LoginRoute() {
  const { skin } = useSkin();
  const Screen = skin.screens.LoginScreen;
  return <Screen />;
}
