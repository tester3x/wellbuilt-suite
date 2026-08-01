/** Secure operational callables for Suite (shifts, reference, profile). */
const CALLABLE_BASE = 'https://us-central1-wellbuilt-sync.cloudfunctions.net';

async function callCallable<T>(
  name: string,
  data: Record<string, unknown>,
  idToken?: string | null,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const resp = await fetch(`${CALLABLE_BASE}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body.error) {
    throw new Error(body?.error?.message || `Callable ${name} failed (${resp.status})`);
  }
  return body.result as T;
}

export async function secureUpsertShift(
  shift: Record<string, unknown>,
  opts?: { shiftDocId?: string; driverHash?: string; idToken?: string | null },
) {
  return callCallable('upsertDriverShift', {
    shift,
    shiftDocId: opts?.shiftDocId,
    driverHash: opts?.driverHash,
  }, opts?.idToken);
}

export async function secureUpdateProfile(
  profile: Record<string, unknown>,
  opts?: { driverHash?: string; idToken?: string | null },
) {
  return callCallable('updateDriverProfile', {
    profile,
    driverHash: opts?.driverHash,
  }, opts?.idToken);
}

export async function secureGetReferenceBundle(
  opts?: { driverHash?: string; idToken?: string | null },
) {
  return callCallable('getDriverReferenceBundle', {
    driverHash: opts?.driverHash,
  }, opts?.idToken);
}
