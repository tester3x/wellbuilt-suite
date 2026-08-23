/**
 * Live equipment-shift checks for governed PKCE issuance.
 *
 * AuthContext publishes the live shiftActive flag. Cached AsyncStorage
 * shift IDs, local flags, deep-link parameters, and display names are
 * never issuance authority on their own.
 */
export type LiveEquipmentShiftAuthority = {
  isShiftActive: () => boolean | Promise<boolean>;
  getPeriodId: () => Promise<string | null>;
};

let live: LiveEquipmentShiftAuthority | null = null;

export function registerLiveEquipmentShiftAuthority(
  next: LiveEquipmentShiftAuthority | null,
): void {
  live = next;
}

export function peekLiveEquipmentShiftAuthority(): LiveEquipmentShiftAuthority | null {
  return live;
}

export function __resetLiveEquipmentShiftAuthorityForTests(): void {
  live = null;
}
