/**
 * TypeScript baseline gate.
 *
 * Live path executes the shipped compiler. Parser/canonicalizer tests
 * prove identity comparison does not depend on line/column or union
 * member order, and that suppression/count drift fail closed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  BASELINE_PATH,
  TSC_ARGS,
  aggregateIdentities,
  canonicalizeMessage,
  compareBaselines,
  headerCount,
  parseTscPrettyFalse,
  sortTypeMembers,
  snapshotFromRun,
  verifyTscBaseline,
} from './tsc-baseline.mjs';

describe('canonicalization', () => {
  it('sorts quoted union members without using line numbers', () => {
    const a = canonicalizeMessage(`Type '"b" | "a" | "c"' is not assignable`);
    const b = canonicalizeMessage(`Type '"c" | "b" | "a"' is not assignable`);
    assert.equal(a, b);
    assert.match(a, /"a" \| "b" \| "c"/);
  });

  it('sorts identifier intersections independently of compiler order', () => {
    const a = sortTypeMembers('WindowsWebViewProps & AndroidWebViewProps & IOSWebViewProps', '&');
    const b = sortTypeMembers('IOSWebViewProps & AndroidWebViewProps & WindowsWebViewProps', '&');
    assert.equal(a, b);
    assert.equal(a, 'AndroidWebViewProps & IOSWebViewProps & WindowsWebViewProps');
  });

  it('canonicalizes before any truncation — full multi-line message is kept', () => {
    const raw = [
      `src/x.ts(10,1): error TS2769: No overload matches this call.`,
      `  Overload 1 of 2, '(props: B & A): void', gave the following error.`,
      `    Type '{ z: 1; }' is not assignable.`,
    ].join('\n');
    const [diag] = parseTscPrettyFalse(raw);
    assert.ok(diag.message.includes('No overload matches this call.'));
    assert.ok(diag.message.includes("Type '{ z: 1; }' is not assignable."));
    assert.equal(diag.file, 'src/x.ts');
    assert.equal(diag.code, 'TS2769');
  });
});

describe('parse and aggregate', () => {
  it('aggregates identical identities by count, ignoring line/column', () => {
    const raw = [
      `src/ui/v1-grid/screens/SettingsScreen.tsx(298,96): error TS2339: Property 'accent' does not exist on type '{ readonly primary: "#F1F5F9"; }'.`,
      `src/ui/v1-grid/screens/SettingsScreen.tsx(421,29): error TS2339: Property 'accent' does not exist on type '{ readonly primary: "#F1F5F9"; }'.`,
      `src/core/components/AppSwitcher.tsx(277,24): error TS7006: Parameter 'd' implicitly has an 'any' type.`,
    ].join('\n');
    assert.equal(headerCount(raw), 3);
    const parsed = parseTscPrettyFalse(raw);
    assert.equal(parsed.length, 3);
    const { identities, total } = aggregateIdentities(parsed);
    assert.equal(total, 3);
    const accent = identities.find((item) => item.code === 'TS2339');
    assert.equal(accent.count, 2);
    assert.equal(accent.file, 'src/ui/v1-grid/screens/SettingsScreen.tsx');
    const any = identities.find((item) => item.code === 'TS7006');
    assert.equal(any.count, 1);
  });

  it('fails comparison on added identity, removed identity, and count increase', () => {
    const expected = {
      total: 2,
      identities: [
        { file: 'a.ts', code: 'TS1', message: 'one', count: 2 },
      ],
    };
    const actualAdded = {
      total: 3,
      identities: [
        { file: 'a.ts', code: 'TS1', message: 'one', count: 2 },
        { file: 'b.ts', code: 'TS2', message: 'two', count: 1 },
      ],
    };
    const added = compareBaselines(expected, actualAdded);
    assert.equal(added.added.length, 1);
    assert.equal(added.totalDrift, 1);

    const removed = compareBaselines(actualAdded, expected);
    assert.equal(removed.removed.length, 1);

    const drift = compareBaselines(expected, {
      total: 3,
      identities: [{ file: 'a.ts', code: 'TS1', message: 'one', count: 3 }],
    });
    assert.equal(drift.countDrift.length, 1);
    assert.equal(drift.countDrift[0].delta, 1);
  });

  it('refuses to snapshot when parser and header counts disagree', () => {
    assert.throws(
      () =>
        snapshotFromRun({
          raw: 'not a diagnostic but ): error TS0000: is missing a path header form',
          status: 2,
        }),
      /parser\/header mismatch/,
    );
  });
});

describe('shipped compiler baseline', () => {
  it('executes node_modules/typescript and matches the frozen identity snapshot', () => {
    const result = verifyTscBaseline();
    assert.equal(result.commandMismatch, false, 'must use shipped tsc.js --noEmit --pretty false');
    assert.equal(result.suppressed, false, 'diagnostics must not be silently suppressed');
    assert.equal(result.run.signal, null);
    assert.deepEqual(result.expected.command, ['node', 'node_modules/typescript/lib/tsc.js', ...TSC_ARGS]);
    assert.equal(result.ok, true, result.report);
    assert.equal(result.cmp.added.length, 0, result.report);
    assert.equal(result.cmp.removed.length, 0, result.report);
    assert.equal(result.cmp.countDrift.length, 0, result.report);
    assert.equal(result.cmp.totalDrift, 0, result.report);
    assert.equal(result.actual.total, result.expected.total);
    const frozen = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    assert.equal(frozen.total, result.actual.total);
    assert.equal(frozen.identities.length, result.actual.identities.length);
  });
});
