// src/core/components/OfflineBanner.tsx
// WB Suite is a hub/launcher — no data queue, so no persistent banner needed.
// Connectivity monitoring still runs (for SystemStatusBar and future use).
// This component is kept as a no-op so the _layout.tsx import doesn't break.

import React from 'react';

export function OfflineBanner() {
  return null;
}
