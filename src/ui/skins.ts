import { v1GridSkin } from './v1-grid';
import { v2DashboardSkin } from './v2-dashboard';
import { v3SidebarSkin } from './v3-sidebar';
import { v4WidgetSkin } from './v4-widget';
import { SkinDefinition } from '@/core/types/skin';

export const allSkins: SkinDefinition[] = [v1GridSkin, v2DashboardSkin, v3SidebarSkin, v4WidgetSkin];
export const defaultSkinId = 'v1-grid';
