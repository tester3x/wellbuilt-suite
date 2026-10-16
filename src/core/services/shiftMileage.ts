export interface ShiftMileageIdentity { companyId: string; driverId: string; suiteShiftId: string }
export const START_ODOMETER_KEY = 'wellbuilt-shift-start-odometer-v2';
export function parseMiles(raw: string): number | null {
  const text = raw.replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export function readBoundStartOdometer(raw: string | null, identity: ShiftMileageIdentity): string {
  try {
    const value = JSON.parse(raw || 'null');
    return value && Object.entries(identity).every(([key, expected]) => value[key] === expected)
      && typeof value.reading === 'string' && parseMiles(value.reading) !== null ? value.reading : '';
  } catch { return ''; }
}
export function resolveShiftMiles(start: string, manual: string, etcMiles: number | null): number | null {
  if (manual.trim()) {
    const end = parseMiles(manual); const beginning = parseMiles(start);
    if (end === null || (beginning !== null && end < beginning)) return null;
    return beginning === null ? end : Math.round(end - beginning);
  }
  return etcMiles !== null && Number.isFinite(etcMiles) && etcMiles >= 0 ? Math.round(etcMiles) : null;
}
export function validateEtcMileageReply(reply: any, request: Record<string, unknown>, now: number): number | null {
  if (!reply || !Object.entries(request).every(([key, value]) => reply[key] === value)
    || reply.available !== true || typeof reply.etcShiftId !== 'string' || !reply.etcShiftId
    || typeof reply.observedAtMs !== 'number' || now - reply.observedAtMs < 0 || now - reply.observedAtMs > 60000
    || typeof reply.miles !== 'number' || !Number.isFinite(reply.miles) || reply.miles < 0) return null;
  return reply.miles;
}
