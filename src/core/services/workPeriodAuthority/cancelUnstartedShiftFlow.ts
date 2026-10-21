export type CancelContext = { uid: string; driverId: string; companyId: string; periodId: string };
export type CancelDependencies = {
  context: () => Promise<CancelContext | null>;
  hasInspection: (periodId: string) => Promise<boolean>;
  hasHosRequest: (context: CancelContext) => Promise<boolean>;
  cancel: (payload: { periodId: string; reason: string; noWorkPerformed: true }) => Promise<unknown>;
};
export async function cancelUnstartedShiftFlow(reason: string, deps: CancelDependencies): Promise<void> {
  if (reason.trim().length < 8 || reason.length > 240) throw Error('Enter a cancellation reason (8–240 characters).');
  const owner = await deps.context();
  if (!owner) throw Error('Restore your active shift before cancelling.');
  if (await deps.hasInspection(owner.periodId)) throw Error('An inspection has been recorded. Use the normal End Shift process.');
  if (await deps.hasHosRequest(owner)) throw Error('ETC has not confirmed that HOS is off. Keep this shift and retry, or use End Shift if you worked.');
  const current = await deps.context();
  if (!current || (['uid', 'driverId', 'companyId', 'periodId'] as const).some(k => current[k] !== owner[k])) {
    throw Error('Your account or shift changed. Return to Suite and try again.');
  }
  const response = await deps.cancel({ periodId: owner.periodId, reason: reason.trim(), noWorkPerformed: true }) as Record<string, unknown>;
  if (response?.protocolVersion !== 1 || response.cancelledPeriodId !== owner.periodId
      || typeof response.alreadyCancelled !== 'boolean') throw Error('Cancellation could not be verified. Your shift has not been cleared locally. Retry to confirm.');
}
