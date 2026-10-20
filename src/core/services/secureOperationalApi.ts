import {platformDelivery} from './platformDelivery';
/** Secure operational callables for Suite (shifts, reference, profile). */
const CALLABLE_BASE = 'https://us-central1-wellbuilt-sync.cloudfunctions.net';

async function callCallable<T>(
  name: string,
  data: Record<string, unknown>,
  idToken?: string | null,
): Promise<T> {
  return platformDelivery.attempt(async()=>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const resp = await fetch(`${CALLABLE_BASE}/${name}`, {
    signal:controller.signal,
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body.error) {
    throw Object.assign(new Error(body?.error?.message || `Callable ${name} failed (${resp.status})`),{httpStatus:resp.status,callableStatus:body?.error?.status});
  }
  return body.result as T;
  }finally{clearTimeout(timer);}
  });
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

/** Scoped Storage path mint (ticket/JSA/ewallet). Prefer over open bucket paths. */
export async function secureRequestUploadPath(
  params: {
    kind: 'ticket_photo' | 'chat_photo' | 'jsa_pdf' | 'ewallet_doc';
    companyId?: string;
    invoiceId?: string;
    threadId?: string;
    docId?: string;
    contentType?: string;
    byteSize?: number;
    driverHash?: string;
  },
  idToken?: string | null,
) {
  return callCallable<{ path: string; maxBytes: number }>(
    'requestStorageUploadPath',
    params,
    idToken,
  );
}
