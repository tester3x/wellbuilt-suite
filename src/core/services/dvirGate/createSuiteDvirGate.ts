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
import { getPendingEndShift, receiptKey, type DvirReceiptKv } from './dvirReceiptStore';
import {
  buildShiftDvirSummaryFromStore,
  hydrateShiftDvirSummaryIfMissing,
  saveShiftDvirSummary,
  type ShiftDvirSummary,
} from './shiftDvirSummary';
import { loadVehicleInfo } from '../driverProfile';
import {
  hasEquipmentHandoffConfirmHandler,
  requestEquipmentHandoffConfirm,
} from './equipmentHandoffConfirm';

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
  peekPendingEndShift: () => ReturnType<typeof getPendingEndShift>;
  /** Period-scoped Pre-Trip evidence for the exact shiftId. rawPresent=false when
   *  no receipt at that key; parseError=true when present but unparseable. A
   *  thrown storage error propagates (caller treats as unverifiable). */
  readPreTripEvidence: (shiftId: string) => Promise<{
    rawPresent: boolean;
    receiptShiftId: string | null;
    receiptPhaseIsPreTrip: boolean;
    parseError: boolean;
  }>;
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
    // Branded modal via DvirHandoffHost; Alert only if host not mounted
    confirmLeaveForEquipment: async ({ phase, title, message }) => {
      if (hasEquipmentHandoffConfirmHandler()) {
        return requestEquipmentHandoffConfirm({ phase, title, message });
      }
      return new Promise((resolve) => {
        Alert.alert(title, message, [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Continue', onPress: () => resolve(true) },
        ]);
      });
    },
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
    peekPendingEndShift: () => getPendingEndShift(kv),
    readPreTripEvidence: async (shiftId: string) => {
      // A thrown storage error propagates to the caller (→ unverifiable).
      const raw = await kv.getItem(receiptKey(shiftId, 'pre_trip'));
      if (raw == null) {
        return { rawPresent: false, receiptShiftId: null, receiptPhaseIsPreTrip: false, parseError: false };
      }
      try {
        const r = JSON.parse(raw) as { shiftId?: unknown; phase?: unknown };
        return {
          rawPresent: true,
          receiptShiftId: typeof r.shiftId === 'string' ? r.shiftId : null,
          receiptPhaseIsPreTrip: r.phase === 'pre_trip',
          parseError: false,
        };
      } catch {
        return { rawPresent: true, receiptShiftId: null, receiptPhaseIsPreTrip: false, parseError: true };
      }
    },
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
