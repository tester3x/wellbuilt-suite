/**
 * Device adapter. Tests inject their own port and storage.
 * Missing native code or the empty release identity both fail closed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ETC_RELEASE_IDENTITY } from './etcReleaseIdentity';
import type { EtcPort, EtcPortFailure, EtcPortResult } from './etcStartDispatch';
import type { EtcMethod } from './etcStartProtocol';
import type { EtcKv } from './etcStartOutbox';

interface NativeModule {
  callProvider: (args: {
    method: string;
    payload: string;
    expectedPackage: string;
    expectedCertSha256: string;
    activityVisible: boolean;
  }) => string | Promise<string>;
}

function loadNative(): NativeModule | null {
  try {
    // Optional until the local module is installed and a release build links it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('suite-etc-hos') as NativeModule;
  } catch {
    return null;
  }
}

export function productionEtcKv(): EtcKv {
  return AsyncStorage;
}

export function createEtcPort(activityVisible: boolean): EtcPort {
  const native = loadNative();
  return {
    available: !!native,
    async call(method: EtcMethod, payload: string): Promise<EtcPortResult> {
      if (!native) return { ok: false, reason: 'native_unavailable' };
      try {
        const raw = await native.callProvider({
          method,
          payload,
          expectedPackage: ETC_RELEASE_IDENTITY.etcPackageName ?? '',
          expectedCertSha256: ETC_RELEASE_IDENTITY.etcCertSha256 ?? '',
          activityVisible,
        });
        const parsed = JSON.parse(raw) as {
          ok?: boolean;
          reason?: string;
          response?: unknown;
          pendingIntentCreatorPackage?: string | null;
          pendingIntentSent?: boolean;
        };
        if (!parsed.ok) {
          return { ok: false, reason: (parsed.reason as EtcPortFailure) || 'bridge_error' };
        }
        return {
          ok: true,
          response: parsed.response,
          pendingIntentCreatorPackage: parsed.pendingIntentCreatorPackage ?? null,
          pendingIntentSent: parsed.pendingIntentSent,
        };
      } catch {
        return { ok: false, reason: 'bridge_error' };
      }
    },
  };
}
