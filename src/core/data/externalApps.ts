export interface ExternalApp {
  id: string;
  name: string;
  icon: string; // MaterialCommunityIcons name
  color: string;
  /** URL to open — app scheme first, web fallback */
  url: string;
  /** Fallback web URL if app isn't installed */
  webUrl?: string;
  /** Category for organizing in the picker */
  category: 'navigation' | 'weather' | 'communication' | 'tools' | 'reference';
}

/** Apps that are always pinned in Quick Links (not removable) */
export const pinnedApps: ExternalApp[] = [
  {
    id: 'google-maps',
    name: 'Maps',
    icon: 'google-maps',
    color: '#34A853',
    url: 'geo:',
    webUrl: 'https://maps.google.com',
    category: 'navigation',
  },
];

/** Full catalog of apps users can toggle on/off */
export const appCatalog: ExternalApp[] = [
  // Navigation
  {
    id: 'waze',
    name: 'Waze',
    icon: 'waze',
    color: '#33CCFF',
    url: 'waze://',
    webUrl: 'https://waze.com',
    category: 'navigation',
  },
  // Weather
  {
    id: 'weather',
    name: 'Weather',
    icon: 'weather-partly-cloudy',
    color: '#60A5FA',
    url: 'https://weather.gov',
    webUrl: 'https://weather.gov',
    category: 'weather',
  },
  {
    id: 'windy',
    name: 'Windy',
    icon: 'weather-windy',
    color: '#FF6B6B',
    url: 'windy://',
    webUrl: 'https://windy.com',
    category: 'weather',
  },
  // Communication
  {
    id: 'phone',
    name: 'Phone',
    icon: 'phone',
    color: '#34D399',
    url: 'tel:',
    category: 'communication',
  },
  {
    id: 'messages',
    name: 'Messages',
    icon: 'message-text',
    color: '#60A5FA',
    url: 'sms:',
    category: 'communication',
  },
  {
    id: 'email',
    name: 'Email',
    icon: 'email',
    color: '#F87171',
    url: 'mailto:',
    category: 'communication',
  },
  // Tools
  {
    id: 'calculator',
    name: 'Calculator',
    icon: 'calculator',
    color: '#A78BFA',
    url: 'calculator://',
    category: 'tools',
  },
  {
    id: 'flashlight',
    name: 'Flashlight',
    icon: 'flashlight',
    color: '#FBBF24',
    url: 'flashlight://',
    category: 'tools',
  },
  {
    id: 'camera',
    name: 'Camera',
    icon: 'camera',
    color: '#FB923C',
    url: 'camera://',
    category: 'tools',
  },
  {
    id: 'clock',
    name: 'Clock',
    icon: 'clock-outline',
    color: '#60A5FA',
    url: 'clock://',
    category: 'tools',
  },
  {
    id: 'compass',
    name: 'Compass',
    icon: 'compass',
    color: '#F87171',
    url: 'compass://',
    category: 'tools',
  },
  // Reference
  {
    id: 'ndic',
    name: 'NDIC',
    icon: 'oil',
    color: '#34D399',
    url: 'https://www.dmr.nd.gov/oilgas/',
    webUrl: 'https://www.dmr.nd.gov/oilgas/',
    category: 'reference',
  },
  {
    id: 'spotify',
    name: 'Spotify',
    icon: 'spotify',
    color: '#1DB954',
    url: 'spotify://',
    webUrl: 'https://open.spotify.com',
    category: 'tools',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: 'youtube',
    color: '#FF0000',
    url: 'vnd.youtube://',
    webUrl: 'https://youtube.com',
    category: 'tools',
  },
];

/** Category display labels — i18n keys used at render time */
export const categoryKeys: ExternalApp['category'][] = [
  'navigation',
  'weather',
  'communication',
  'tools',
  'reference',
];
