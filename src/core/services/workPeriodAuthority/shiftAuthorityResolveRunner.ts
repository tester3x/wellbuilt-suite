/**
 * Terminalizes every issued shift-authority resolve command.
 * Pure of shift mutations: restore is injected. AuthContext applies UI.
 */
import type { ShiftAuthorityUiState } from './postLoginShiftRestoration';
import {
  classifyAuthorityResolveUi,
  type AuthorityResolveClass,
  type AuthoritySessionCommand,
  type createAuthoritySessionMachine,
} from './shiftAuthoritySessionSequencer';

type Machine = ReturnType<typeof createAuthoritySessionMachine>;

export type IssuedResolveTerminal =
  | { kind: 'none' }
  | { kind: 'open'; periodId: string; originLocalDate: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'abandoned_stale' };

export async function terminalizeIssuedResolve(opts: {
  machine: Machine;
  token: number;
  isCurrent: () => boolean;
  restore: () => Promise<ShiftAuthorityUiState | null | undefined>;
}): Promise<{
  terminal: IssuedResolveTerminal;
  applyUi: boolean;
  ui: ShiftAuthorityUiState | null;
  abandoned: boolean;
}> {
  if (!opts.isCurrent()) {
    opts.machine.dispatch({
      type: 'resolve_result',
      token: opts.token,
      result: 'transient_failure',
    });
    return { terminal: { kind: 'abandoned_stale' }, applyUi: false, ui: null, abandoned: true };
  }

  let ui: ShiftAuthorityUiState | null | undefined;
  try {
    ui = await opts.restore();
  } catch {
    if (!opts.isCurrent()) {
      opts.machine.dispatch({
        type: 'resolve_result',
        token: opts.token,
        result: 'transient_failure',
      });
      return { terminal: { kind: 'abandoned_stale' }, applyUi: false, ui: null, abandoned: true };
    }
    const after = opts.machine.dispatch({
      type: 'resolve_result',
      token: opts.token,
      result: 'transient_failure',
    });
    return {
      terminal: { kind: 'unavailable', reason: after.state.ui.kind === 'unavailable' ? after.state.ui.reason : 'authority_transient' },
      applyUi: after.applyUi,
      ui: after.applyUi ? after.state.ui : null,
      abandoned: false,
    };
  }

  if (!opts.isCurrent()) {
    opts.machine.dispatch({
      type: 'resolve_result',
      token: opts.token,
      result: 'transient_failure',
    });
    return { terminal: { kind: 'abandoned_stale' }, applyUi: false, ui: null, abandoned: true };
  }

  const classified: AuthorityResolveClass = ui
    ? classifyAuthorityResolveUi(ui)
    : 'transient_failure';
  const open = ui && ui.kind === 'open'
    ? { periodId: ui.periodId, originLocalDate: ui.originLocalDate }
    : undefined;
  const after = opts.machine.dispatch({
    type: 'resolve_result',
    token: opts.token,
    result: classified,
    open,
  });
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

export function issuedResolveToken(
  commands: AuthoritySessionCommand[],
): number | null {
  return commands.find((c) => c.cmd === 'resolve')?.token ?? null;
}
