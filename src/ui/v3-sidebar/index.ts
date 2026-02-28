import { SkinDefinition } from '@/core/types/skin';
import CompanySelectScreen from './screens/CompanySelectScreen';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import AppDetailScreen from './screens/AppDetailScreen';
// Use v1-grid SettingsScreen for full driver profile (v3 version only had language/skin)
import SettingsScreen from '@/ui/v1-grid/screens/SettingsScreen';

export const v3SidebarSkin: SkinDefinition = {
  id: 'v3-sidebar',
  name: 'Sidebar Nav',
  description: 'Desktop-style sidebar navigation layout',
  screens: {
    CompanySelectScreen,
    LoginScreen,
    HomeScreen,
    AppDetailScreen,
    SettingsScreen,
  },
};
