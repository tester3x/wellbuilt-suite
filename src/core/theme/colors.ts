export const colors = {
  // Core backgrounds
  bg: {
    primary: '#05060B',
    secondary: '#0D0F17',
    card: '#111422',
    cardHover: '#161A2E',
    elevated: '#1A1F35',
    input: '#0A0C14',
  },

  // Brand
  brand: {
    primary: '#60A5FA',    // WellBuilt blue
    secondary: '#3B82F6',
    accent: '#818CF8',     // Indigo accent
    glow: 'rgba(96, 165, 250, 0.15)',
    glowStrong: 'rgba(96, 165, 250, 0.3)',
  },

  // Status
  status: {
    online: '#34D399',
    warning: '#FBBF24',
    error: '#F87171',
    offline: '#6B7280',
  },

  // Text
  text: {
    primary: '#F1F5F9',
    secondary: '#94A3B8',
    muted: '#64748B',
    inverse: '#05060B',
  },

  // Borders
  border: {
    subtle: 'rgba(255, 255, 255, 0.06)',
    default: 'rgba(255, 255, 255, 0.1)',
    active: 'rgba(96, 165, 250, 0.4)',
  },

  // Gradients (used with LinearGradient)
  gradient: {
    card: ['rgba(96, 165, 250, 0.08)', 'rgba(96, 165, 250, 0.02)'],
    header: ['#05060B', '#0D0F17'],
    splash: ['#05060B', '#0A0E1A', '#05060B'],
    buttonPrimary: ['#3B82F6', '#2563EB'],
    appCardMobile: ['rgba(96, 165, 250, 0.12)', 'rgba(129, 140, 248, 0.06)'],
    appCardDashboard: ['rgba(52, 211, 153, 0.12)', 'rgba(52, 211, 153, 0.04)'],
    appCardTicket: ['rgba(251, 191, 36, 0.12)', 'rgba(251, 191, 36, 0.04)'],
    appCardJSA: ['rgba(248, 113, 113, 0.12)', 'rgba(248, 113, 113, 0.04)'],
  },
} as const;

export const appColors = {
  mobile: '#60A5FA',
  dashboard: '#34D399',
  waterTicket: '#FBBF24',
  jsa: '#F87171',
} as const;
