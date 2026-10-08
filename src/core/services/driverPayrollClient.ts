import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp, FIREBASE_REGION } from './firebaseApp';
import { getOwnedIdToken, waitForAuthReady } from './firebaseAuthBoundary';
import type { PayConfig, TimesheetInvoice } from './payroll';

type PayrollResponse = { invoices: TimesheetInvoice[]; payConfig: PayConfig | null };

/** The server authenticates the driver and filters invoices before returning
 * them. Firestore rules deny the former company-wide client query. */
export async function fetchOwnDriverPayroll(start: Date, end: Date): Promise<PayrollResponse> {
  const app = getFirebaseApp();
  await waitForAuthReady(app);
  if (!await getOwnedIdToken(app)) throw new Error('shift_summary_auth_unavailable');

  const callable = httpsCallable<{ startISO: string; endISO: string }, PayrollResponse>(
    getFunctions(app, FIREBASE_REGION),
    'getDriverPayroll',
    { timeout: 35_000 },
  );
  const result = await callable({ startISO: start.toISOString(), endISO: end.toISOString() });
  if (!result.data || !Array.isArray(result.data.invoices)) throw new Error('payroll_response_invalid');
  return result.data;
}
