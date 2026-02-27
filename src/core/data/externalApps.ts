// src/core/data/externalApps.ts
// BYOA (Bring Your Own App) catalog — triple hybrid system
//
// Layer 1: Large local catalog organized by category (driver picks what they want)
// Layer 2: Installed detection via Linking.canOpenURL() (shows "Installed" badge)
// Layer 3: Company-required apps from Firestore (admin-mandated, non-removable)

export type ExternalAppCategory =
  | 'navigation'
  | 'weather'
  | 'communication'
  | 'music'
  | 'social'
  | 'trucking'
  | 'tools'
  | 'reference';

export interface ExternalApp {
  id: string;
  name: string;
  icon: string; // MaterialCommunityIcons name
  color: string;
  /** URL to open — native scheme preferred, web fallback */
  url: string;
  /** Fallback web URL if native scheme fails */
  webUrl?: string;
  /** Category for organizing in the picker */
  category: ExternalAppCategory;
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
  // ── Navigation ──────────────────────────────────────────────
  {
    id: 'waze',
    name: 'Waze',
    icon: 'waze',
    color: '#33CCFF',
    url: 'waze://',
    webUrl: 'https://waze.com',
    category: 'navigation',
  },
  {
    id: 'apple-maps',
    name: 'Apple Maps',
    icon: 'apple',
    color: '#999999',
    url: 'maps://',
    webUrl: 'https://maps.apple.com',
    category: 'navigation',
  },

  // ── Weather ─────────────────────────────────────────────────
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
  {
    id: 'accuweather',
    name: 'AccuWeather',
    icon: 'weather-cloudy',
    color: '#F4511E',
    url: 'accuweather://',
    webUrl: 'https://accuweather.com',
    category: 'weather',
  },
  {
    id: 'myradar',
    name: 'MyRadar',
    icon: 'radar',
    color: '#1DB954',
    url: 'myradar://',
    webUrl: 'https://myradar.com',
    category: 'weather',
  },

  // ── Communication ───────────────────────────────────────────
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
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: 'whatsapp',
    color: '#25D366',
    url: 'whatsapp://',
    webUrl: 'https://web.whatsapp.com',
    category: 'communication',
  },
  {
    id: 'messenger',
    name: 'Messenger',
    icon: 'facebook-messenger',
    color: '#0084FF',
    url: 'fb-messenger://',
    webUrl: 'https://messenger.com',
    category: 'communication',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    icon: 'send',
    color: '#0088CC',
    url: 'tg://',
    webUrl: 'https://web.telegram.org',
    category: 'communication',
  },
  {
    id: 'signal',
    name: 'Signal',
    icon: 'shield-lock',
    color: '#3A76F0',
    url: 'sgnl://',
    webUrl: 'https://signal.org',
    category: 'communication',
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: 'slack',
    color: '#4A154B',
    url: 'slack://',
    webUrl: 'https://slack.com',
    category: 'communication',
  },
  {
    id: 'teams',
    name: 'Teams',
    icon: 'microsoft-teams',
    color: '#6264A7',
    url: 'msteams://',
    webUrl: 'https://teams.microsoft.com',
    category: 'communication',
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: 'chat',
    color: '#5865F2',
    url: 'discord://',
    webUrl: 'https://discord.com',
    category: 'communication',
  },

  // ── Music & Media ───────────────────────────────────────────
  {
    id: 'spotify',
    name: 'Spotify',
    icon: 'spotify',
    color: '#1DB954',
    url: 'spotify://',
    webUrl: 'https://open.spotify.com',
    category: 'music',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: 'youtube',
    color: '#FF0000',
    url: 'vnd.youtube://',
    webUrl: 'https://youtube.com',
    category: 'music',
  },
  {
    id: 'youtube-music',
    name: 'YT Music',
    icon: 'music-circle',
    color: '#FF0000',
    url: 'youtubemusic://',
    webUrl: 'https://music.youtube.com',
    category: 'music',
  },
  {
    id: 'apple-music',
    name: 'Apple Music',
    icon: 'music-note',
    color: '#FC3C44',
    url: 'music://',
    webUrl: 'https://music.apple.com',
    category: 'music',
  },
  {
    id: 'pandora',
    name: 'Pandora',
    icon: 'music-box',
    color: '#005483',
    url: 'pandora://',
    webUrl: 'https://pandora.com',
    category: 'music',
  },
  {
    id: 'amazon-music',
    name: 'Amazon Music',
    icon: 'music-note-eighth',
    color: '#25D8FF',
    url: 'amznmusic://',
    webUrl: 'https://music.amazon.com',
    category: 'music',
  },
  {
    id: 'audible',
    name: 'Audible',
    icon: 'headphones',
    color: '#F8991C',
    url: 'audible://',
    webUrl: 'https://audible.com',
    category: 'music',
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    icon: 'cloud-outline',
    color: '#FF5500',
    url: 'soundcloud://',
    webUrl: 'https://soundcloud.com',
    category: 'music',
  },
  {
    id: 'iheart',
    name: 'iHeart Radio',
    icon: 'radio',
    color: '#C6002B',
    url: 'iheartradio://',
    webUrl: 'https://iheart.com',
    category: 'music',
  },
  {
    id: 'podcasts',
    name: 'Podcasts',
    icon: 'microphone',
    color: '#9933CC',
    url: 'pcast://',
    webUrl: 'https://podcasts.apple.com',
    category: 'music',
  },
  {
    id: 'netflix',
    name: 'Netflix',
    icon: 'netflix',
    color: '#E50914',
    url: 'netflix://',
    webUrl: 'https://netflix.com',
    category: 'music',
  },

  // ── Social ──────────────────────────────────────────────────
  {
    id: 'facebook',
    name: 'Facebook',
    icon: 'facebook',
    color: '#1877F2',
    url: 'fb://',
    webUrl: 'https://facebook.com',
    category: 'social',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: 'instagram',
    color: '#E4405F',
    url: 'instagram://',
    webUrl: 'https://instagram.com',
    category: 'social',
  },
  {
    id: 'x-twitter',
    name: 'X',
    icon: 'twitter',
    color: '#000000',
    url: 'twitter://',
    webUrl: 'https://x.com',
    category: 'social',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    icon: 'music-note-sixteenth',
    color: '#000000',
    url: 'snssdk1233://',
    webUrl: 'https://tiktok.com',
    category: 'social',
  },
  {
    id: 'snapchat',
    name: 'Snapchat',
    icon: 'snapchat',
    color: '#FFFC00',
    url: 'snapchat://',
    webUrl: 'https://snapchat.com',
    category: 'social',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    icon: 'reddit',
    color: '#FF4500',
    url: 'reddit://',
    webUrl: 'https://reddit.com',
    category: 'social',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: 'linkedin',
    color: '#0A66C2',
    url: 'linkedin://',
    webUrl: 'https://linkedin.com',
    category: 'social',
  },

  // ── Trucking & Oilfield ─────────────────────────────────────
  {
    id: 'trucker-path',
    name: 'Trucker Path',
    icon: 'truck',
    color: '#FF6B00',
    url: 'truckerpath://',
    webUrl: 'https://truckerpath.com',
    category: 'trucking',
  },
  {
    id: 'gasbuddy',
    name: 'GasBuddy',
    icon: 'gas-station',
    color: '#0EA34C',
    url: 'gasbuddy://',
    webUrl: 'https://gasbuddy.com',
    category: 'trucking',
  },
  {
    id: 'motive',
    name: 'Motive (ELD)',
    icon: 'truck-check-outline',
    color: '#0A7DFC',
    url: 'gomotive://',
    webUrl: 'https://gomotive.com',
    category: 'trucking',
  },
  {
    id: 'samsara',
    name: 'Samsara',
    icon: 'truck-delivery-outline',
    color: '#0063FF',
    url: 'samsara://',
    webUrl: 'https://samsara.com',
    category: 'trucking',
  },
  {
    id: 'love-fuels',
    name: "Love's Connect",
    icon: 'heart',
    color: '#FFD700',
    url: 'lovesconnect://',
    webUrl: 'https://loves.com',
    category: 'trucking',
  },
  {
    id: 'pilot-flying-j',
    name: 'myRewards Plus',
    icon: 'star-circle',
    color: '#E31937',
    url: 'pilotflyingj://',
    webUrl: 'https://pilotflyingj.com',
    category: 'trucking',
  },
  {
    id: 'ndic',
    name: 'NDIC',
    icon: 'oil',
    color: '#34D399',
    url: 'https://www.dmr.nd.gov/oilgas/',
    webUrl: 'https://www.dmr.nd.gov/oilgas/',
    category: 'trucking',
  },

  // ── Tools ───────────────────────────────────────────────────
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
  {
    id: 'notes',
    name: 'Notes',
    icon: 'note-text',
    color: '#FFD700',
    url: 'mobilenotes://',
    webUrl: 'https://keep.google.com',
    category: 'tools',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    icon: 'calendar',
    color: '#4285F4',
    url: 'calshow://',
    webUrl: 'https://calendar.google.com',
    category: 'tools',
  },
  {
    id: 'translate',
    name: 'Translate',
    icon: 'translate',
    color: '#4285F4',
    url: 'googletranslate://',
    webUrl: 'https://translate.google.com',
    category: 'tools',
  },
  {
    id: 'files',
    name: 'Files',
    icon: 'folder',
    color: '#5F6368',
    url: 'shareddocuments://',
    category: 'tools',
  },
  {
    id: 'voice-recorder',
    name: 'Recorder',
    icon: 'microphone-outline',
    color: '#EA4335',
    url: 'voicememos://',
    category: 'tools',
  },

  // ── Reference ───────────────────────────────────────────────
  {
    id: 'google-search',
    name: 'Google',
    icon: 'google',
    color: '#4285F4',
    url: 'google://',
    webUrl: 'https://google.com',
    category: 'reference',
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    icon: 'wikipedia',
    color: '#636466',
    url: 'wikipedia://',
    webUrl: 'https://en.wikipedia.org',
    category: 'reference',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    icon: 'google-drive',
    color: '#0F9D58',
    url: 'googledrive://',
    webUrl: 'https://drive.google.com',
    category: 'reference',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    icon: 'dropbox',
    color: '#0061FE',
    url: 'dbapi-1://',
    webUrl: 'https://dropbox.com',
    category: 'reference',
  },
];

/** Ordered category list for display */
export const categoryKeys: ExternalAppCategory[] = [
  'navigation',
  'weather',
  'communication',
  'music',
  'social',
  'trucking',
  'tools',
  'reference',
];

/**
 * Check if a URL is a native app scheme (vs web URL).
 * Used by installed detection — only native schemes can be checked.
 */
export function isNativeScheme(url: string): boolean {
  return !url.startsWith('http://') && !url.startsWith('https://');
}
