import { SkinDefinition } from '@/core/types/skin';
import CompanySelectScreen from './screens/CompanySelectScreen';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import AppDetailScreen from './screens/AppDetailScreen';
import SettingsScreen from './screens/SettingsScreen';

export const v4WidgetSkin: SkinDefinition = {
  id: 'v4-widget',
  name: 'Widget Board',
  description: 'iOS-style tile & widget layout',
  screens: {
    CompanySelectScreen,
    LoginScreen,
    HomeScreen,
    AppDetailScreen,
    SettingsScreen,
  },
};
