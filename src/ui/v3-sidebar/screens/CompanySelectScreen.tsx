// CompanySelectScreen is no longer used — auth goes directly to LoginScreen.
// This file is kept as a no-op redirect for backward compatibility.
import React from 'react';
import { router } from 'expo-router';

export default function CompanySelectScreen() {
  React.useEffect(() => { router.replace('/login'); }, []);
  return null;
}
