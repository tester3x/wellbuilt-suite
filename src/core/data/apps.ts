import { ImageSourcePropType } from 'react-native';
import { appColors } from '../theme';

export interface WellBuiltApp {
  id: string;
  name: string;
  /** Short name shown on cards (e.g. "Mobile", "Tickets") */
  shortName: string;
  subtitle: string;
  description: string;
  icon: string; // MaterialCommunityIcons name
  /** Optional logo image for detail screen */
  logo?: ImageSourcePropType;
  color: string;
  gradientKey: 'appCardMobile' | 'appCardDashboard' | 'appCardTicket' | 'appCardJSA';
  features: string[];
  version: string;
  platform: 'mobile' | 'web' | 'both';
  status: 'active' | 'beta' | 'coming-soon';
  /** URL scheme for deep linking (e.g. "wellbuiltmobile://") */
  scheme?: string;
  /** Android package name for intent-based launching */
  androidPackage?: string;
}

export const wellbuiltApps: WellBuiltApp[] = [
  {
    id: 'wellbuilt-mobile',
    name: 'WellBuilt Mobile',
    shortName: 'Mobile',
    subtitle: 'Field Operations',
    description: 'The primary field app for drivers to record well levels, manage pulls, and track performance in real-time.',
    icon: 'oil',
    logo: require('../../../assets/wellbuilt-logo.png'),
    color: appColors.mobile,
    gradientKey: 'appCardMobile',
    features: [
      'Interactive tank level recording',
      'Real-time driver performance tracking',
      'Pull history & summary views',
      'Offline packet queue with auto-sync',
      'Manager dashboard access',
      'Well alerts & notifications',
    ],
    version: '2.1.0',
    platform: 'mobile',
    status: 'active',
    scheme: 'wellbuiltmobile',
    androidPackage: 'com.wellbuiltmobile.app',
  },
  {
    id: 'wellbuilt-dashboard',
    name: 'WellBuilt Dashboard',
    shortName: 'Dashboard',
    subtitle: 'Management Console',
    description: 'Web-based monitoring dashboard for managers to view well statuses, route performance, and analytics across the operation.',
    icon: 'monitor-dashboard',
    color: appColors.dashboard,
    gradientKey: 'appCardDashboard',
    features: [
      'Real-time well status monitoring',
      'Route-based organization',
      'Performance analytics',
      'Table & card view modes',
      'Admin panel for IT/admin roles',
      'Well detail pages with history',
    ],
    version: '0.1.0',
    platform: 'web',
    status: 'active',
  },
  {
    id: 'water-ticket',
    name: 'WellBuilt Tickets',
    shortName: 'Tickets',
    subtitle: 'Ticket Management',
    description: 'Digital water hauling ticket system with Bluetooth thermal printer integration for field receipts and record-keeping.',
    icon: 'ticket-confirmation',
    color: appColors.waterTicket,
    gradientKey: 'appCardTicket',
    features: [
      'Digital ticket creation & management',
      'Bluetooth thermal printer support',
      'NDIC well data integration',
      'Ticket block numbering system',
      'Offline-first architecture',
      'PDF receipt generation',
    ],
    version: '1.0.0',
    platform: 'mobile',
    status: 'active',
    scheme: 'wellbuilt-tickets',
    androidPackage: 'com.testerxxx.waterticket',
  },
  {
    id: 'wellbuilt-jsa',
    name: 'WellBuilt JSA',
    shortName: 'JSA',
    subtitle: 'Job Safety Analysis',
    description: 'Job Safety Analysis app for field crews to complete safety assessments before starting work on well sites.',
    icon: 'shield-check',
    color: appColors.jsa,
    gradientKey: 'appCardJSA',
    features: [
      'Pre-job safety checklists',
      'Hazard identification',
      'Risk assessment forms',
      'Digital signatures',
      'Safety record keeping',
      'Compliance reporting',
    ],
    version: '1.0.0',
    platform: 'mobile',
    status: 'active',
  },
];
