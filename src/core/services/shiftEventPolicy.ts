// Pure shift-event policy (RN/expo-free so it is unit-testable).
export type ShiftEventKind = 'login' | 'logout' | 'depart_return' | 'return_abandoned';

// A shift is OPEN when its last event is a login, a depart_return (driving to
// the yard), or a return_abandoned (driver diverted back to work). Only a
// logout closes the shift. `return_abandoned` MUST count as open, otherwise the
// guard that blocks illegal appends would skip a later real logout and leave
// the shift stuck open.
export function isOpenShiftLastEvent(lastType: string | null | undefined): boolean {
  return lastType === 'login' || lastType === 'depart_return' || lastType === 'return_abandoned';
}
