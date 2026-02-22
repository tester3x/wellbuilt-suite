import React from 'react';

export interface SkinDefinition {
  id: string;
  name: string;
  description: string;
  screens: {
    CompanySelectScreen: React.ComponentType;
    LoginScreen: React.ComponentType;
    HomeScreen: React.ComponentType;
    AppDetailScreen: React.ComponentType;
    SettingsScreen: React.ComponentType;
  };
}
