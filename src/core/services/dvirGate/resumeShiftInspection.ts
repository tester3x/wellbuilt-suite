/** Resolve recovery from current Suite state, never from a link's shift alone. */
export async function resumeShiftInspection(input: {
  active: boolean; requestedShift?: string; phase?: string;
}, deps: {
  currentShift(): Promise<string | null>;
  complete(id: string, phase: 'pre_trip' | 'post_trip'): Promise<boolean>;
  launch(id: string, phase: 'pre_trip' | 'post_trip'): Promise<{launched:boolean;error?:string}>;
}): Promise<'inactive' | 'mismatch' | 'complete' | 'launched'> {
  if (!input.active) return 'inactive';
  const id = await deps.currentShift();
  if (!id) return 'inactive';
  if (input.requestedShift && input.requestedShift !== id) return 'mismatch';
  if (input.phase && input.phase !== 'pre_trip' && input.phase !== 'post_trip') return 'mismatch';
  const phase = input.phase === 'post_trip' ? 'post_trip' : 'pre_trip';
  if (await deps.complete(id, phase)) return 'complete';
  const result = await deps.launch(id, phase);
  if (!result.launched) throw new Error(result.error || 'Could not open the inspection. Try again.');
  return 'launched';
}
