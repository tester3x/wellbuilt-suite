/**
 * Live Suite gate wiring (AsyncStorage + expo-crypto + shiftTracking).
 */
import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { getCurrentShiftId } from '../shiftTracking';
import type { DvirGateDeps } from './dvirGateService';
import {
  ensurePostTripGate,
  ensurePreTripGate,
  ingestDvirCompletionUrl,
  isPreTripCompleteForShift,
  isPostTripCompleteForShift,
  launchEquipmentPhase,
  consumePendingEndShiftIfReady,
  clearDvirRoutingAfterFinalization,
} from './dvirGateService';
import type { DvirReceiptKv } from './dvirReceiptStore';
import {
  buildShiftDvirSummaryFromStore,
  hydrateShiftDvirSummaryIfMissing,
  saveShiftDvirSummary,
  type ShiftDvirSummary,
} from './shiftDvirSummary';
import { loadVehicleInfo } from '../driverProfile';

const kv: DvirReceiptKv = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

async function sha256Hex(input: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
  );
  return digest.toLowerCase();
}

export function createSuiteDvirGate(opts?: {
  getSso?: DvirGateDeps['getSso'];
  /** Live shiftActive from AuthContext — required to stop off-shift redirects. */
  isShiftActive?: DvirGateDeps['isShiftActive'];
}): DvirGateDeps & {
  ensurePreTripGate: (
    o?: Parameters<typeof ensurePreTripGate>[1],
  ) => ReturnType<typeof ensurePreTripGate>;
  ensurePostTripGate: (
    o?: Parameters<typeof ensurePostTripGate>[1],
  ) => ReturnType<typeof ensurePostTripGate>;
  ingestDvirCompletionUrl: (url: string) => ReturnType<typeof ingestDvirCompletionUrl>;
  isPreTripComplete: (shiftId: string) => Promise<boolean>;
  isPostTripComplete: (shiftId: string) => Promise<boolean>;
  launchPhase: (
    phase: Parameters<typeof launchEquipmentPhase>[1],
    shiftId: string,
  ) => ReturnType<typeof launchEquipmentPhase>;
  consumePendingEndShiftIfReady: () => ReturnType<typeof consumePendingEndShiftIfReady>;
  clearDvirRoutingAfterFinalization: () => Promise<void>;
  /** Build + persist Shift Complete DVIR summary from durable receipts. */
  finalizeShiftDvirSummary: (shiftId: string) => Promise<ShiftDvirSummary | null>;
  /** Cold-upgrade: assemble from receipts only when summary is missing. */
  hydrateShiftDvirSummaryIfMissing: (shiftId: string) => Promise<ShiftDvirSummary | null>;
} {
  const deps: DvirGateDeps = {
    kv,
    sha256Hex,
    getCurrentShiftId,
    getSso: opts?.getSso,
    isShiftActive: opts?.isShiftActive,
    openUrl: (url) => Linking.openURL(url),
    alert: (title, message) => {
      Alert.alert(title, message);
    },
    // Confirm before leaving Suite for eQuipment (parity with clear JSA handoff UX)
    confirmLeaveForEquipment: ({ title, message }) =>
      new Promise((resolve) => {
        Alert.alert(title, message, [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Continue', onPress: () => resolve(true) },
        ]);
      }),
    tryAndroidIntent: Platform.OS === 'android',
  };

  return {
    ...deps,
    ensurePreTripGate: (o) => ensurePreTripGate(deps, o),
    ensurePostTripGate: (o) => ensurePostTripGate(deps, o),
    ingestDvirCompletionUrl: (url) => ingestDvirCompletionUrl(deps, url),
    isPreTripComplete: (shiftId) => isPreTripCompleteForShift(deps, shiftId),
    isPostTripComplete: (shiftId) => isPostTripCompleteForShift(deps, shiftId),
    launchPhase: (phase, shiftId) => launchEquipmentPhase(deps, phase, shiftId),
    consumePendingEndShiftIfReady: () => consumePendingEndShiftIfReady(deps),
    clearDvirRoutingAfterFinalization: () => clearDvirRoutingAfterFinalization(deps),
    finalizeShiftDvirSummary: async (shiftId: string) => {
      const id = shiftId?.trim();
      if (!id) return null;
      const sso = opts?.getSso ? await opts.getSso() : null;
      // Always rebuild from durable receipts (completion path may add Post-Trip
      // after a partial was never stored). Cold-open uses hydrateIfMissing.
      const summary = await buildShiftDvirSummaryFromStore(kv, id, {
        truckUnit: sso?.truck ?? null,
        trailerUnit: sso?.trailer ?? null,
      });
      await saveShiftDvirSummary(kv, summary);
      return summary;
    },
    /** Cold-upgrade: fill missing summary from receipts without requiring re-finalization. */
    hydrateShiftDvirSummaryIfMissing: async (shiftId: string) => {
      const id = shiftId?.trim();
      if (!id) return null;
      const sso = opts?.getSso ? await opts.getSso() : null;
      return hydrateShiftDvirSummaryIfMissing(kv, id, {
        truckUnit: sso?.truck ?? null,
        trailerUnit: sso?.trailer ?? null,
      });
    },
  };
}

/** Build SSO getter from logged-in Suite user fields. */
export function makeDvirSsoGetter(user: {
  passcodeHash: string;
  displayName: string;
  companyId?: string;
} | null): DvirGateDeps['getSso'] {
  if (!user) return async () => null;
  return async () => {
    const vehicle = await loadVehicleInfo(user.passcodeHash).catch(() => ({
      truckNumber: '',
      trailerNumber: '',
    }));
    return {
      hash: user.passcodeHash,
      name: user.displayName,
      companyId: user.companyId,
      truck: vehicle.truckNumber || undefined,
      trailer: vehicle.trailerNumber || undefined,
    };
  };
}
