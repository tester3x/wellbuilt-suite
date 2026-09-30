export type ReturnStartResult = { ok: true } | { ok: false; reason: string };

/** Close the confirmation only after the return state has been accepted. */
export async function confirmReturnStart(
  start: () => Promise<ReturnStartResult>,
  confirmed: () => void,
): Promise<ReturnStartResult> {
  try {
    const result = await start();
    if (result?.ok === true) {
      confirmed();
      return result;
    }
    return { ok: false, reason: result?.reason || 'return_failed' };
  } catch {
    return { ok: false, reason: 'return_failed' };
  }
}

export function returnStartMessage(reason: string): string {
  if (reason === 'invalid_argument' || reason === 'unsupported_return_contract') {
    return 'The server could not accept this return request. Your shift is still open. The app and server need a matching update.';
  }
  if (reason === 'no_open_shift' || reason === 'no_period') {
    return 'Your active shift could not be confirmed. Refresh your shift status and try again.';
  }
  return 'Could not start the return drive. Your shift is still open. Check your connection and try again.';
}
