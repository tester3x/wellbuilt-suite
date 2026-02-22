import { SkinDefinition } from '@/core/types/skin';
import CompanySelectScreen from './screens/CompanySelectScreen';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import AppDetailScreen from './screens/AppDetailScreen';
import SettingsScreen from './screens/SettingsScreen';

export const v2DashboardSkin: SkinDefinition = {
  id: 'v2-dashboard',
  name: 'Command Center',
  description: 'Enterprise dashboard with stats & list view',
  screens: {
    CompanySelectScreen,
    LoginScreen,
    HomeScreen,
    AppDetailScreen,
    SettingsScreen,
  },
};
