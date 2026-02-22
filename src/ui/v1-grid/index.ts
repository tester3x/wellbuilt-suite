import { SkinDefinition } from '@/core/types/skin';
import CompanySelectScreen from './screens/CompanySelectScreen';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import AppDetailScreen from './screens/AppDetailScreen';
import SettingsScreen from './screens/SettingsScreen';

export const v1GridSkin: SkinDefinition = {
  id: 'v1-grid',
  name: 'Card Grid',
  description: 'Classic 2-column card layout',
  screens: {
    CompanySelectScreen,
    LoginScreen,
    HomeScreen,
    AppDetailScreen,
    SettingsScreen,
  },
};
