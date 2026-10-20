/** Compact legacy references for display; canonical evidence IDs stay intact. */
export function jsaDisplayReference(value: string): string {
  return /^JSA-[A-Za-z0-9_-]{40,}$/.test(value)
    ? 'Pending sync'
    : value;
}
