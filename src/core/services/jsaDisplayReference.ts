/** Display only: never use the short number for lookup or evidence identity. */
export function jsaDisplayReference(value: string): string {
  const numbered = /^JSA-\d{8}-\d{6}-(\d{6})$/.exec(value);
  if (numbered) return numbered[1];
  return /^JSA-[A-Za-z0-9_-]{40,}$/.test(value)
    ? 'Pending sync'
    : value;
}
