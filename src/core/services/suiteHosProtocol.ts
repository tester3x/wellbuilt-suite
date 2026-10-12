/** Start-only, versioned Suite/ETC handoff. Keep both repositories in sync. */
export type HosStartRequest = { requestId: string; suiteShiftId: string; issuedAtMs: number };
export type HosStartReply = { requestId: string; suiteShiftId: string; status: 'started' | 'already_active' | 'failed'; gps: 'ready' | 'unavailable' | 'disabled'; etcShiftId?: string };
const id = /^[A-Za-z0-9_-]{1,100}$/;
export const HOS_HANDOFF_TTL_MS = 10 * 60_000;
export function validHosRequest(r: HosStartRequest, nowMs: number): boolean {
  return id.test(r.requestId) && id.test(r.suiteShiftId) && Number.isSafeInteger(r.issuedAtMs)
    && r.issuedAtMs <= nowMs + 30_000 && nowMs - r.issuedAtMs <= HOS_HANDOFF_TTL_MS;
}
export function hosStartUrl(r: HosStartRequest): string {
  return 'wellbuilttimecard://suite-start?v=1&requestId=' + encodeURIComponent(r.requestId)
    + '&suiteShiftId=' + encodeURIComponent(r.suiteShiftId) + '&issuedAtMs=' + r.issuedAtMs;
}
export function parseHosStartUrl(raw: string, nowMs: number): HosStartRequest | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'wellbuilttimecard:' || u.hostname !== 'suite-start' || u.pathname || u.hash || u.username || u.password) return null;
    const keys = ['v', 'requestId', 'suiteShiftId', 'issuedAtMs'];
    if ([...u.searchParams.keys()].some(k => !keys.includes(k)) || keys.some(k => u.searchParams.getAll(k).length !== 1) || u.searchParams.get('v') !== '1') return null;
    const r = { requestId: u.searchParams.get('requestId')!, suiteShiftId: u.searchParams.get('suiteShiftId')!, issuedAtMs: Number(u.searchParams.get('issuedAtMs')) };
    return validHosRequest(r, nowMs) ? r : null;
  } catch { return null; }
}
export function hosReplyUrl(r: HosStartReply): string {
  return 'wellbuilt-suite://etc-hos-result?v=1&requestId=' + encodeURIComponent(r.requestId)
    + '&suiteShiftId=' + encodeURIComponent(r.suiteShiftId) + '&status=' + r.status
    + '&gps=' + r.gps + (r.etcShiftId ? '&etcShiftId=' + encodeURIComponent(r.etcShiftId) : '');
}
export function matchesHosReply(r: HosStartReply, pending: HosStartRequest, nowMs: number): boolean {
  return validHosRequest(pending, nowMs) && r.requestId === pending.requestId && r.suiteShiftId === pending.suiteShiftId
    && ['started', 'already_active', 'failed'].includes(r.status) && ['ready', 'unavailable', 'disabled'].includes(r.gps)
    && (r.status === 'failed' || (!!r.etcShiftId && id.test(r.etcShiftId)));
}
