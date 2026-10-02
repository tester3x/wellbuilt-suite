/**
 * The shift JSA close rule.
 *
 * WHAT CHANGED AND WHY
 *
 * The gate used to live on day-summary's Log Out button — which day-summary
 * itself documents as running AFTER shift finalization ("Day Summary is only
 * shown after shift finalization (off-shift)"). So on a required company the
 * shift was already closed by the time anything asked about the JSA, and the
 * driver was then nagged for one. The gate could not prevent a close; it could
 * only strand a logout.
 *
 * It also treated one boolean — jsa_day_status.jsaCompleted — as "the JSA is
 * done". That flag is written by acknowledgment paths that create NO signature:
 * jsaShiftAck.acknowledgeShiftJsa (WB S) and WB T's mirror both set
 * jsaCompleted=true plus acknowledgedMethod. A company that forbids
 * acknowledgment (jsaAllowAcknowledge === false) therefore still had its gate
 * satisfied by an acknowledgment-only record.
 *
 * And the shift-level collapse was "ANY record completed" (Path D), so a
 * signature on one operator's record satisfied the shift even when WB T had
 * since stamped locations on other records that nobody acknowledged.
 *
 * THE RULE IMPLEMENTED HERE
 *
 * A required per-shift JSA takes ONE signature, supplied by the first
 * read/signoff. WB T then stamps locations and required acknowledgments as work
 * proceeds. The normal final shift close then finalizes it: no second signature
 * and no second WB JSA trip. Where evidence is missing the driver gets an
 * honest recovery route instead of a close.
 *
 * WHAT ACTUALLY CLOSES THE JSA — see jsaFinalizationAuthority(). WB S writes no
 * closure flag of its own. The authoritative close (closeDriverShift) retires
 * the server work period, and a shift-bound JSA record is open only while its
 * shiftId is still the server's current period. One cross-app assumption in
 * that sentence is NOT verifiable from this repository; it is stated as a
 * dependency rather than assumed, and the honest-labelling below never depends
 * on it being true.
 *
 * Deliberately free of React, expo, fetch and storage imports: every decision
 * below is executable in node:test.
 */

/** Company JSA modes, as stored on companies/{id}.jsaMode. */
export type JsaShiftMode = 'off' | 'per_shift' | 'per_job' | 'per_location' | 'per_load';

/**
 * Does this mode put a JSA obligation on the SHIFT (and therefore on the
 * close)? per_job / per_load are job-scoped: they are a real obligation at job
 * close, and no part of the shift close. Anything unrecognised is treated as
 * unknown by normalizeJsaShiftMode rather than quietly as 'off'.
 */
export function jsaGatesShiftClose(mode: JsaShiftMode): boolean {
  return mode === 'per_shift' || mode === 'per_location';
}

/**
 * A mode string, or null when the company config could not be read.
 *
 * An unreadable config is NOT 'off'. The old gate assigned jsaGateShiftEnd only
 * inside `if (companyDoc)`, leaving the default `false`, so one failed config
 * read silently removed a required company's JSA gate.
 */
export function normalizeJsaShiftMode(raw: string | null | undefined): JsaShiftMode | null {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).trim().toLowerCase();
  if (m === '') return null;
  if (m === 'off' || m === 'per_shift' || m === 'per_job' || m === 'per_location' || m === 'per_load') {
    return m;
  }
  // An unrecognised mode is an unknown obligation, never an absent one.
  return null;
}

/** One location WB T stamped onto a jsa_day_status record as work proceeded. */
export type JsaLocationEntry = {
  id: string;
  label?: string | null;
  /** True only when this location carries its own acknowledgment. */
  acknowledged: boolean;
  acknowledgedAt?: string | null;
};

/** One jsa_day_status record, decoded out of Firestore into plain fields. */
export type JsaStatusRecord = {
  recordId: string;
  shiftId: string | null;
  /** Operator scope, when WB T wrote a per-(shift, operator) record. */
  operatorId?: string | null;
  /** The bare status flag. True does NOT imply a signature. */
  jsaCompleted: boolean;
  jsaCompletedAt: string | null;
  /**
   * Written only by the acknowledgment paths (WB S jsaShiftAck and WB T's
   * mirror). Its presence is positive evidence that this record was NOT signed.
   */
  acknowledgedMethod: 'acknowledged' | 'read' | null;
  /** Durable artifact reference, when one has been produced. */
  pdfUrl: string | null;
  /** Positive signature evidence from the WB JSA signoff path, when present. */
  signedAt?: string | null;
  signatureId?: string | null;
  /** Locations WB T stamped on this record. */
  locations: JsaLocationEntry[];
};

/**
 * How well this record's completion is evidenced.
 *
 * 'signed'            — positive durable evidence (signedAt / signatureId / pdfUrl).
 * 'acknowledged_only' — completed via an acknowledgment path. Not a signature.
 * 'unverified'        — the flag is set with nothing that identifies its origin.
 * 'absent'            — not completed.
 */
export type JsaSignatureState = 'signed' | 'acknowledged_only' | 'unverified' | 'absent';

export function classifyJsaSignature(record: JsaStatusRecord): JsaSignatureState {
  const hasPositiveEvidence = !!(record.signedAt || record.signatureId || record.pdfUrl);
  if (hasPositiveEvidence) return 'signed';
  if (!record.jsaCompleted) return 'absent';
  if (record.acknowledgedMethod) return 'acknowledged_only';
  return 'unverified';
}

/** Best (most evidenced) state wins at the shift level: one signature per shift. */
const SIGNATURE_RANK: Record<JsaSignatureState, number> = {
  signed: 3,
  unverified: 2,
  acknowledged_only: 1,
  absent: 0,
};

export type OutstandingLocation = {
  recordId: string;
  locationId: string;
  label?: string | null;
};

export type ShiftJsaEvidence = {
  /** Did the jsa_day_status read succeed? False means unknown, not empty. */
  recordsRead: boolean;
  recordCount: number;
  /** The best-evidenced completion across every record for this shift. */
  signature: JsaSignatureState;
  signedRecordId: string | null;
  completedAtIso: string | null;
  /** Every stamped location still missing its acknowledgment. */
  outstandingLocations: OutstandingLocation[];
  /** Whether a durable artifact reference exists. The CURRENT VIEW is not one. */
  artifact: 'present' | 'absent';
  artifactUrl: string | null;
};

/**
 * Collapse the shift's records into one evidence view.
 *
 * Signature is collapsed leniently (one signature per shift is the rule, so any
 * signed record satisfies it) while acknowledgments are collapsed strictly
 * (every stamped location must carry its own). The old code collapsed BOTH
 * leniently, which is what let an unacknowledged location through.
 */
export function collectShiftJsaEvidence(input: {
  records: JsaStatusRecord[] | null;
  shiftId: string | null;
}): ShiftJsaEvidence {
  if (input.records === null) {
    return {
      recordsRead: false,
      recordCount: 0,
      signature: 'absent',
      signedRecordId: null,
      completedAtIso: null,
      outstandingLocations: [],
      artifact: 'absent',
      artifactUrl: null,
    };
  }
  // Only records bound to this shift count. A record for another shift is
  // somebody else's obligation and must never satisfy this close.
  const scoped = input.shiftId
    ? input.records.filter(r => r.shiftId === input.shiftId)
    : input.records.filter(r => !r.shiftId);

  let signature: JsaSignatureState = 'absent';
  let signedRecordId: string | null = null;
  let completedAtIso: string | null = null;
  let artifactUrl: string | null = null;
  const outstandingLocations: OutstandingLocation[] = [];

  for (const record of scoped) {
    const state = classifyJsaSignature(record);
    if (SIGNATURE_RANK[state] > SIGNATURE_RANK[signature]) {
      signature = state;
      signedRecordId = record.recordId;
    }
    if (record.jsaCompleted && record.jsaCompletedAt) {
      if (!completedAtIso || record.jsaCompletedAt > completedAtIso) {
        completedAtIso = record.jsaCompletedAt;
      }
    }
    if (!artifactUrl && record.pdfUrl) artifactUrl = record.pdfUrl;
    for (const loc of record.locations) {
      if (!loc.acknowledged) {
        outstandingLocations.push({ recordId: record.recordId, locationId: loc.id, label: loc.label ?? null });
      }
    }
  }

  return {
    recordsRead: true,
    recordCount: scoped.length,
    signature,
    signedRecordId,
    completedAtIso,
    outstandingLocations,
    artifact: artifactUrl ? 'present' : 'absent',
    artifactUrl,
  };
}

export type JsaRecoveryRoute = 'read_jsa' | 'acknowledge' | 'retry' | 'none';

export type JsaBlockReason =
  | 'config_unreadable'
  | 'evidence_unreadable'
  | 'no_jsa_record'
  | 'not_completed'
  | 'acknowledgment_outstanding'
  | 'acknowledge_not_permitted';

/**
 * Why a finalize is honest but not fully evidenced. Carried so the UI and the
 * report can say what is and is not proven, instead of printing "Completed".
 */
export type JsaFinalizeCaveat = 'signature_not_verifiable' | 'acknowledged_not_signed' | 'artifact_absent';

export type JsaCloseDecision =
  | { kind: 'not_required'; reason: 'mode_off' | 'job_scoped' }
  | {
      kind: 'finalize';
      via: 'shift_close';
      signature: Exclude<JsaSignatureState, 'absent'>;
      artifact: 'present' | 'absent';
      caveats: JsaFinalizeCaveat[];
    }
  | {
      kind: 'blocked';
      reason: JsaBlockReason;
      route: JsaRecoveryRoute;
      message: string;
      outstandingLocations: OutstandingLocation[];
    };

/**
 * The shift close decision.
 *
 * Nothing here writes, and nothing here infers a signature. 'finalize' means
 * "the close may proceed and it retires this JSA" — its `caveats` say exactly
 * how well that is evidenced.
 */
export function decideShiftJsaClose(input: {
  /** Null when the company config could not be read. */
  mode: JsaShiftMode | null;
  /** companies/{id}.jsaAllowAcknowledge, defaulting true when the field is absent. */
  allowAcknowledge: boolean;
  evidence: ShiftJsaEvidence;
}): JsaCloseDecision {
  if (input.mode === null) {
    return {
      kind: 'blocked',
      reason: 'config_unreadable',
      route: 'retry',
      message: "Couldn't check whether your company requires a JSA. Reconnect and try again.",
      outstandingLocations: [],
    };
  }
  if (input.mode === 'off') {
    return { kind: 'not_required', reason: 'mode_off' };
  }
  if (!jsaGatesShiftClose(input.mode)) {
    return { kind: 'not_required', reason: 'job_scoped' };
  }

  const ev = input.evidence;
  if (!ev.recordsRead) {
    return {
      kind: 'blocked',
      reason: 'evidence_unreadable',
      route: 'retry',
      message: "Couldn't read your JSA status. Reconnect and try again.",
      outstandingLocations: [],
    };
  }
  if (ev.recordCount === 0) {
    return {
      kind: 'blocked',
      reason: 'no_jsa_record',
      route: 'read_jsa',
      message: 'No JSA was started for this shift. Open the JSA to complete it.',
      outstandingLocations: [],
    };
  }
  if (ev.signature === 'absent') {
    return {
      kind: 'blocked',
      reason: 'not_completed',
      route: input.allowAcknowledge ? 'acknowledge' : 'read_jsa',
      message: input.allowAcknowledge
        ? 'Your JSA is not complete yet. Acknowledge it or open the JSA to finish.'
        : 'Your JSA is not complete yet. Your company requires you to read it.',
      outstandingLocations: [],
    };
  }
  // An acknowledgment is not a signature. At a company that forbids
  // acknowledgment it cannot stand in for one, however the flag got set.
  if (ev.signature === 'acknowledged_only' && !input.allowAcknowledge) {
    return {
      kind: 'blocked',
      reason: 'acknowledge_not_permitted',
      route: 'read_jsa',
      message: 'Your JSA was acknowledged but not signed, and your company requires a signed JSA. Open the JSA to sign it.',
      outstandingLocations: [],
    };
  }
  // Locations WB T stamped must each carry their acknowledgment. Checked AFTER
  // the signature so the driver is told the specific thing that is missing.
  if (ev.outstandingLocations.length > 0) {
    return {
      kind: 'blocked',
      reason: 'acknowledgment_outstanding',
      route: 'read_jsa',
      message:
        ev.outstandingLocations.length === 1
          ? 'One location on your JSA still needs to be acknowledged. Open the JSA to finish it.'
          : `${ev.outstandingLocations.length} locations on your JSA still need to be acknowledged. Open the JSA to finish them.`,
      outstandingLocations: ev.outstandingLocations,
    };
  }

  const caveats: JsaFinalizeCaveat[] = [];
  if (ev.signature === 'acknowledged_only') caveats.push('acknowledged_not_signed');
  if (ev.signature === 'unverified') caveats.push('signature_not_verifiable');
  if (ev.artifact === 'absent') caveats.push('artifact_absent');

  return {
    kind: 'finalize',
    via: 'shift_close',
    signature: ev.signature,
    artifact: ev.artifact,
    caveats,
  };
}

export type BlockedJsaClose = Extract<JsaCloseDecision, { kind: 'blocked' }>;

/**
 * Should the Shift Complete screen's BACKSTOP gate hold a logout?
 *
 * Only for a block the evidence positively shows. The two unreadable cases do
 * not hold it: by the time that screen renders the shift is already closed, the
 * JSA record lives server-side either way, and holding an offline driver inside
 * the app achieves nothing while costing them their logout. The close gate — the
 * one that can still change the outcome, with the driver at the yard and able to
 * retry — stays fail-closed on exactly those cases.
 *
 * Pre-change the backstop did not hold on an unreadable config either (the gate
 * flag defaulted false), so this narrows nothing; it just says so out loud.
 */
export function jsaBlocksLogout(decision: JsaCloseDecision): boolean {
  return decision.kind === 'blocked' && decision.route !== 'retry';
}


/**
 * The label for the one button that gets a blocked driver unstuck, or null when
 * re-tapping the submit they are already looking at IS the recovery.
 *
 * Both the read and the acknowledge routes lead to WB JSA. The close gate
 * deliberately offers no in-place acknowledgment: it writes nothing, so a
 * shift cannot be closed by stamping a flag from the close screen. The
 * company-permitted acknowledgment affordance stays where it already lives.
 */
export function jsaRecoveryLabel(decision: BlockedJsaClose): string | null {
  switch (decision.route) {
    case 'read_jsa':
    case 'acknowledge':
      return 'Open JSA';
    case 'retry':
    case 'none':
      return null;
  }
}

/** Does this decision permit the shift close to run? */
export function jsaPermitsClose(decision: JsaCloseDecision): boolean {
  return decision.kind !== 'blocked';
}

/**
 * The honest headline for the Shift Complete JSA card.
 *
 * 'Completed' is reserved for evidence that actually shows completion. A bare
 * flag reads as recorded-but-unverified rather than as a signed JSA.
 */
export function jsaCloseHeadline(decision: JsaCloseDecision): string | null {
  if (decision.kind === 'not_required') return null;
  if (decision.kind === 'blocked') return decision.message;
  if (decision.signature === 'signed') return 'JSA signed';
  if (decision.signature === 'acknowledged_only') return 'JSA acknowledged (not signed)';
  return 'JSA recorded (signature not verifiable)';
}

/**
 * What closes a shift JSA, stated once so a report can cite it rather than
 * guess. `crossAppAssumption` is the part this repository cannot prove.
 */
export function jsaFinalizationAuthority(): {
  closedBy: 'closeDriverShift';
  suiteWritesClosureFlag: false;
  crossAppAssumption: string;
  durableArtifactOwner: 'wb-jsa';
} {
  return {
    closedBy: 'closeDriverShift',
    suiteWritesClosureFlag: false,
    crossAppAssumption:
      'A shift-bound JSA record is open only while its shiftId is the server current period, '
      + 'so retiring the period at close retires the JSA. WB JSA owns that read; it is not in this repository.',
    durableArtifactOwner: 'wb-jsa',
  };
}

// ── Prior-day open items ─────────────────────────────────────────────────────

export type PriorDayJsaItem = {
  recordId: string;
  shiftId: string | null;
  originLocalDate: string | null;
  signature: JsaSignatureState;
  /** True when the work period this record belongs to is still open server-side. */
  periodStillOpen: boolean;
};

export type PriorDayJsaAction =
  | { action: 'none'; reason: 'current_shift' | 'period_open' }
  | { action: 'close_jsa'; reason: 'signed_orphan' }
  | { action: 'finish'; reason: 'unsigned' }
  | { action: 'discard_audited'; reason: 'unsigned' };

export type PriorDayJsaRow = {
  item: PriorDayJsaItem;
  /** Offered actions, in the order they should be shown. */
  actions: PriorDayJsaAction[];
};

/**
 * A genuinely open prior-day record gets its OWN close action. An unsigned one
 * gets Finish or an audited Discard — never a fabricated close, and never an
 * automatic one just because a new JSA started.
 */
export function priorDayJsaActions(input: {
  items: PriorDayJsaItem[];
  currentShiftId: string | null;
}): PriorDayJsaRow[] {
  return input.items.map(item => {
    if (input.currentShiftId && item.shiftId === input.currentShiftId) {
      return { item, actions: [{ action: 'none', reason: 'current_shift' }] as PriorDayJsaAction[] };
    }
    if (item.periodStillOpen) {
      // The period is live somewhere. Closing its JSA here would retire an
      // obligation that is still being worked.
      return { item, actions: [{ action: 'none', reason: 'period_open' }] as PriorDayJsaAction[] };
    }
    if (item.signature === 'signed') {
      return { item, actions: [{ action: 'close_jsa', reason: 'signed_orphan' }] as PriorDayJsaAction[] };
    }
    return {
      item,
      actions: [
        { action: 'finish', reason: 'unsigned' },
        { action: 'discard_audited', reason: 'unsigned' },
      ] as PriorDayJsaAction[],
    };
  });
}

/**
 * Starting a new JSA never closes an old one. Stated as a function so the rule
 * is executable and a change to it turns a test red.
 */
export function shouldAutoCloseOnNewJsa(): false {
  return false;
}

// ── Firestore decoding ───────────────────────────────────────────────────────

/**
 * Decode one jsa_day_status REST document into a JsaStatusRecord.
 *
 * Kept here, pure and tested, because the field mapping IS the rule: whether a
 * record counts as signed depends entirely on which fields were read. The old
 * screen did this inline and read only jsaCompleted / jsaCompletedAt / pdfUrl,
 * so acknowledgedMethod — the one field that positively identifies an
 * acknowledgment — was fetched and then dropped on the floor.
 */
export function decodeJsaStatusDoc(doc: any): JsaStatusRecord | null {
  if (!doc || typeof doc !== 'object') return null;
  const f = doc.fields;
  if (!f || typeof f !== 'object') return null;
  const recordId = String(doc.name || '').split('/').pop() || '';
  if (!recordId) return null;

  const method = f.acknowledgedMethod?.stringValue;
  const locations = decodeLocationEntries(f);

  return {
    recordId,
    shiftId: f.shiftId?.stringValue ?? null,
    operatorId: f.operatorId?.stringValue ?? f.companyId?.stringValue ?? null,
    jsaCompleted: f.jsaCompleted?.booleanValue === true,
    jsaCompletedAt: f.jsaCompletedAt?.timestampValue ?? null,
    acknowledgedMethod: method === 'acknowledged' || method === 'read' ? method : null,
    pdfUrl: f.pdfUrl?.stringValue ?? null,
    signedAt: f.signedAt?.timestampValue ?? null,
    signatureId: f.signatureId?.stringValue ?? null,
    locations,
  };
}

/**
 * Locations come from `locations[]`, falling back to `wells[]` (WB T's older
 * stamp). An entry is acknowledged only when it SAYS so — an entry with no
 * acknowledgment field is outstanding, never assumed done.
 */
function decodeLocationEntries(fields: any): JsaLocationEntry[] {
  const raw = fields.locations?.arrayValue?.values ?? fields.wells?.arrayValue?.values;
  if (!Array.isArray(raw)) return [];
  const out: JsaLocationEntry[] = [];
  raw.forEach((entry: any, index: number) => {
    // A bare string entry carries no acknowledgment of its own.
    if (typeof entry?.stringValue === 'string') {
      out.push({ id: entry.stringValue || `#${index}`, label: entry.stringValue, acknowledged: false });
      return;
    }
    const mf = entry?.mapValue?.fields;
    if (!mf) return;
    const id = mf.id?.stringValue || mf.locationId?.stringValue || mf.name?.stringValue || `#${index}`;
    const acknowledgedAt = mf.acknowledgedAt?.timestampValue ?? null;
    const acknowledged = mf.acknowledged?.booleanValue === true || !!acknowledgedAt;
    out.push({
      id,
      label: mf.label?.stringValue ?? mf.name?.stringValue ?? null,
      acknowledged,
      acknowledgedAt,
    });
  });
  return out;
}

/** Decode a batch, dropping entries that are not documents. */
export function decodeJsaStatusDocs(docs: any[] | null | undefined): JsaStatusRecord[] | null {
  if (!Array.isArray(docs)) return null;
  const out: JsaStatusRecord[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    const decoded = decodeJsaStatusDoc(doc);
    if (decoded && !seen.has(decoded.recordId)) {
      out.push(decoded);
      seen.add(decoded.recordId);
    }
  }
  return out;
}
