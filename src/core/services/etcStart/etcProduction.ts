/**
 * Device adapter. Tests inject their own port and storage.
 * Missing native code or the empty release identity both fail closed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ETC_RELEASE_IDENTITY, type EtcReleaseIdentity } from './etcReleaseIdentity';
import type { EtcPort, EtcPortFailure, EtcPortResult } from './etcStartDispatch';
import type { EtcMethod } from './etcStartProtocol';
import type { EtcKv } from './etcStartOutbox';

interface EtcTargetModule {
  etcTargetForEnv: (env: NodeJS.ProcessEnv) => {
    dispatchEnabled: boolean;
    etcPackageName: string | null;
    etcCertSha256: string | null;
  };
  identityForTarget: (target: {
    dispatchEnabled: boolean;
    etcPackageName: string | null;
    etcCertSha256: string | null;
  }) => EtcReleaseIdentity;
}

function loadEtcTarget(): EtcTargetModule | null {
  try {
    // Metro follows this relative file. Keep the require call literal.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../../../../modules/suite-etc-hos/etcTarget.js') as EtcTargetModule;
  } catch {
    return null;
  }
}

/** Shipped profiles stay unverified until dispatchEnabled is true. */
export function shippedEtcIdentity(env: NodeJS.ProcessEnv = process.env): EtcReleaseIdentity {
  try {
    const targetModule = loadEtcTarget();
    if (!targetModule) return ETC_RELEASE_IDENTITY;
    const identity = targetModule.identityForTarget(targetModule.etcTargetForEnv(env));
    if (!identity.verified || !identity.etcPackageName || !identity.etcCertSha256) return ETC_RELEASE_IDENTITY;
    return identity;
  } catch {
    return ETC_RELEASE_IDENTITY;
  }
}

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
  const identity = shippedEtcIdentity();
  return {
    available: !!native,
    async call(method: EtcMethod, payload: string): Promise<EtcPortResult> {
      if (!native) return { ok: false, reason: 'native_unavailable' };
      try {
        const raw = await native.callProvider({
          method,
          payload,
          expectedPackage: identity.etcPackageName ?? '',
          expectedCertSha256: identity.etcCertSha256 ?? '',
          activityVisible,
        });
        const parsed = JSON.parse(raw) as {
          ok?: boolean;
          reason?: string;
          response?: unknown;
          startIntent?: string;
          pendingIntentCreatorPackage?: string | null;
        };
        if (!parsed.ok) {
          return { ok: false, reason: (parsed.reason as EtcPortFailure) || 'bridge_error' };
        }
        const startIntent = parsed.startIntent === 'sent' || parsed.startIntent === 'present'
          ? parsed.startIntent
          : 'absent';
        return {
          ok: true,
          response: parsed.response,
          startIntent,
          pendingIntentCreatorPackage: parsed.pendingIntentCreatorPackage ?? null,
        };
      } catch {
        return { ok: false, reason: 'bridge_error' };
      }
    },
  };
}
