/**
 * Terminalizes every issued shift-authority resolve command.
 * Pure of shift mutations: restore is injected. AuthContext applies UI.
 *
 * The caller must pass the lease captured when the command was issued.
 * Never terminalize peek().inFlight after a possible reset — that may be
 * a newer generation's lease.
 */
import type { ShiftAuthorityUiState } from './postLoginShiftRestoration';
import {
  classifyAuthorityResolveUi,
  type AuthorityResolveClass,
  type AuthorityResolveLease,
  type AuthoritySessionCommand,
  type createAuthoritySessionMachine,
} from './shiftAuthoritySessionSequencer';

type Machine = ReturnType<typeof createAuthoritySessionMachine>;

export type IssuedResolveTerminal =
  | { kind: 'none' }
  | { kind: 'open'; periodId: string; originLocalDate: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'abandoned_stale' };

function dispatchResult(
  machine: Machine,
  lease: AuthorityResolveLease,
  result: AuthorityResolveClass,
  open?: { periodId: string; originLocalDate: string },
) {
  return machine.dispatch({
    type: 'resolve_result',
    generation: lease.generation,
    token: lease.token,
    result,
    open,
  });
}

export async function terminalizeIssuedResolve(opts: {
  machine: Machine;
  lease: AuthorityResolveLease;
  isCurrent: () => boolean;
  restore: () => Promise<ShiftAuthorityUiState | null | undefined>;
}): Promise<{
  terminal: IssuedResolveTerminal;
  applyUi: boolean;
  ui: ShiftAuthorityUiState | null;
  abandoned: boolean;
}> {
  const abandon = () => {
    dispatchResult(opts.machine, opts.lease, 'transient_failure');
    return {
      terminal: { kind: 'abandoned_stale' as const },
      applyUi: false,
      ui: null,
      abandoned: true,
    };
  };

  if (!opts.isCurrent()) return abandon();

  let ui: ShiftAuthorityUiState | null | undefined;
  try {
    ui = await opts.restore();
  } catch {
    if (!opts.isCurrent()) return abandon();
    const after = dispatchResult(opts.machine, opts.lease, 'transient_failure');
    return {
      terminal: {
        kind: 'unavailable',
        reason: after.state.ui.kind === 'unavailable' ? after.state.ui.reason : 'authority_transient',
      },
      applyUi: after.applyUi,
      ui: after.applyUi ? after.state.ui : null,
      abandoned: false,
    };
  }

  if (!opts.isCurrent()) return abandon();

  const classified: AuthorityResolveClass = ui
    ? classifyAuthorityResolveUi(ui)
    : 'transient_failure';
  const open = ui && ui.kind === 'open'
    ? { periodId: ui.periodId, originLocalDate: ui.originLocalDate }
    : undefined;
  const after = dispatchResult(opts.machine, opts.lease, classified, open);
  const nextUi = after.applyUi ? after.state.ui : null;
  const terminal: IssuedResolveTerminal = !nextUi
    ? { kind: 'unavailable', reason: 'authority_transient' }
    : nextUi.kind === 'none'
      ? { kind: 'none' }
      : nextUi.kind === 'open'
        ? { kind: 'open', periodId: nextUi.periodId, originLocalDate: nextUi.originLocalDate }
        : { kind: 'unavailable', reason: nextUi.kind === 'unavailable' ? nextUi.reason : 'authority_transient' };
  return { terminal, applyUi: after.applyUi, ui: nextUi, abandoned: false };
}

export function issuedResolveLease(
  commands: AuthoritySessionCommand[],
): AuthorityResolveLease | null {
  const cmd = commands.find((c) => c.cmd === 'resolve');
  return cmd ? { generation: cmd.generation, token: cmd.token } : null;
}

/** @deprecated use issuedResolveLease — kept only as a thin alias for token field reads */
export function issuedResolveToken(
  commands: AuthoritySessionCommand[],
): number | null {
  return issuedResolveLease(commands)?.token ?? null;
}
