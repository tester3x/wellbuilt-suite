/**
 * Composes the shift JSA close rule with the real readers.
 *
 * shiftJsaClose.ts holds every decision; this supplies it with the company
 * config outcome and the shift's jsa_day_status records. Both readers are
 * injectable so the composed behaviour — including each failure path — is
 * executable in node:test.
 *
 * NOTHING HERE WRITES. The close rule never stamps, acknowledges, signs or
 * retires anything; it reports what the evidence supports.
 */
import {
  collectShiftJsaEvidence,
  decideShiftJsaClose,
  decodeJsaStatusDocs,
  normalizeJsaShiftMode,
  type JsaCloseDecision,
  type JsaStatusRecord,
} from './shiftJsaClose';

/**
 * What the gate needs to know about the company.
 *
 * `mode: null` means "could not be determined" — either the config was
 * unreadable or the stored mode is not a mode this build knows. It is NEVER
 * 'off'. The gate it replaces defaulted to 'off' and assigned the real value
 * only inside `if (companyDoc)`, so one failed read silently removed a required
 * company's JSA gate.
 */
export type CompanyJsaRule = {
  mode: ReturnType<typeof normalizeJsaShiftMode>;
  allowAcknowledge: boolean;
};

export type ShiftJsaGateDeps = {
  getCurrentShiftId: () => Promise<string | null>;
  /** Null on a failed read. An empty array means "read fine, nothing there". */
  readJsaRecords: (shiftId: string) => Promise<JsaStatusRecord[] | null>;
  readCompanyRule: () => Promise<CompanyJsaRule>;
};

/**
 * Resolve the close decision for the current shift.
 *
 * Order matters: the company rule is read first, so an 'off' company costs no
 * JSA query at all. Liquid Gold is 'off' — under this gate they issue no JSA
 * read, see no prompt, and reach no JSA branch.
 */
export async function resolveShiftJsaClose(deps: ShiftJsaGateDeps): Promise<JsaCloseDecision> {
  const rule = await deps.readCompanyRule();
  if (rule.mode === 'off') {
    return decideShiftJsaClose({
      mode: 'off',
      allowAcknowledge: rule.allowAcknowledge,
      evidence: collectShiftJsaEvidence({ records: [], shiftId: null }),
    });
  }
  if (rule.mode === null) {
    // Unknown obligation: decided without a records read, which would be
    // meaningless anyway.
    return decideShiftJsaClose({
      mode: null,
      allowAcknowledge: rule.allowAcknowledge,
      evidence: collectShiftJsaEvidence({ records: null, shiftId: null }),
    });
  }

  const shiftId = await deps.getCurrentShiftId();
  if (!shiftId) {
    // No verified period means no record can be scoped to one. Reported as
    // unreadable evidence rather than as an absent obligation, and NO date
    // fallback is invented here.
    return decideShiftJsaClose({
      mode: rule.mode,
      allowAcknowledge: rule.allowAcknowledge,
      evidence: collectShiftJsaEvidence({ records: null, shiftId: null }),
    });
  }

  const records = await deps.readJsaRecords(shiftId).catch(() => null);
  return decideShiftJsaClose({
    mode: rule.mode,
    allowAcknowledge: rule.allowAcknowledge,
    evidence: collectShiftJsaEvidence({ records, shiftId }),
  });
}

/**
 * Build a CompanyJsaRule from a loadCompanyConfigResult outcome.
 *
 * `unavailable` maps to mode: null — the fail-closed signal that
 * companyConfig's own documentation requires of shift-destructive gates. A
 * cached config is usable: the JSA mode is a company policy, not live state.
 */
export function companyJsaRuleFromConfigResult(result: {
  kind: 'live' | 'cache' | 'unavailable';
  config?: { jsaMode?: string; jsaModeRaw?: string; jsaAllowAcknowledge?: boolean };
}): CompanyJsaRule {
  if (result.kind === 'unavailable' || !result.config) {
    return { mode: null, allowAcknowledge: true };
  }
  const raw = result.config.jsaModeRaw ?? result.config.jsaMode;
  return {
    mode: normalizeJsaShiftMode(raw),
    // Absent field defaults to true, matching the Dashboard JsaCard default.
    allowAcknowledge: result.config.jsaAllowAcknowledge !== false,
  };
}

/** Decode the REST shapes day-summary already fetches into records. */
export function recordsFromRestDocs(input: {
  directDoc: any | null;
  operatorDocs: any[] | null;
  /** True when BOTH reads failed, which is unknown rather than empty. */
  readFailed: boolean;
}): JsaStatusRecord[] | null {
  if (input.readFailed) return null;
  const docs: any[] = [];
  if (input.directDoc) docs.push(input.directDoc);
  if (Array.isArray(input.operatorDocs)) docs.push(...input.operatorDocs);
  return decodeJsaStatusDocs(docs) ?? [];
}
