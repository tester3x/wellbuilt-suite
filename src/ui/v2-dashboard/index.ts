import { SkinDefinition } from '@/core/types/skin';
import CompanySelectScreen from './screens/CompanySelectScreen';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import AppDetailScreen from './screens/AppDetailScreen';
// Use v1-grid SettingsScreen for full driver profile (v2 version only had language/skin)
import SettingsScreen from '@/ui/v1-grid/screens/SettingsScreen';

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
