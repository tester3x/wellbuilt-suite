/**
 * Deterministic Suite TypeScript baseline gate.
 *
 * Runs the shipped compiler (node_modules/typescript/lib/tsc.js) with
 * --noEmit --pretty false, canonicalizes the FULL diagnostic stream
 * before any truncation, and compares identity+count against a frozen
 * snapshot. Historical diagnostics stay; new identities or increased
 * counts fail. Missing identities also fail (silent suppression).
 *
 * Identity = relative path + TS code + canonical message.
 * Line/column are captured for humans but are not part of the identity.
 *
 *   node tools/tsc-baseline.mjs --verify
 *   node tools/tsc-baseline.mjs --write
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_PATH = join(ROOT, 'tools', 'tsc-baseline.json');
export const TSC_JS = join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');
export const TSC_ARGS = ['--noEmit', '--pretty', 'false'];
export const MAX_BUFFER_BYTES = 20 * 1024 * 1024;

const HEADER =
  /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;

export function normalizePath(file) {
  return String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

/**
 * Sort depth-0 union (`A | B`) and intersection (`A & B`) members so
 * compiler member-order churn cannot create a false identity.
 * Nested `()[]{}` and quoted strings are respected; the original
 * string is never truncated.
 */
export function sortTypeMembers(text, separator) {
  const sep = ` ${separator} `;
  if (!text.includes(sep)) return text;
  const out = [];
  let last = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let quote = null;
  const members = [];
  const pushMember = (from, to) => {
    members.push(text.slice(from, to));
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote !== "'") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depthParen += 1;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === '[') depthBracket += 1;
    else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === '{') depthBrace += 1;
    else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
    const atRoot = depthParen === 0 && depthBracket === 0 && depthBrace === 0;
    if (atRoot && text.startsWith(sep, i)) {
      pushMember(last, i);
      i += sep.length - 1;
      last = i + 1;
    }
  }
  pushMember(last, text.length);
  if (members.length < 2) return text;
  const sorted = members.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rebuilt = sorted.join(sep);
  if (rebuilt === text) return text;
  return rebuilt;
}

function sortIdentifierChain(text, separator) {
  const escaped = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ident = '[A-Za-z_][A-Za-z0-9.]*';
  const re = new RegExp(`(?:${ident}\\s*${escaped}\\s*)+${ident}`, 'g');
  return text.replace(re, (chain) => {
    const parts = chain.split(new RegExp(`\\s*${escaped}\\s*`));
    if (parts.length < 2) return chain;
    return parts.slice().sort().join(` ${separator} `);
  });
}

function sortQuotedStringUnion(text) {
  const re = /(?:'[^']*'|"[^"]*")(?:\s*\|\s*(?:'[^']*'|"[^"]*"))+/g;
  return text.replace(re, (chain) => {
    const parts = [...chain.matchAll(/'[^']*'|"[^"]*"/g)].map((match) => match[0]);
    if (parts.length < 2) return chain;
    return parts.slice().sort().join(' | ');
  });
}

export function canonicalizeMessage(message) {
  const collapsed = String(message || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  // Depth-aware sort first, then identifier/quoted-string chains so
  // members inside compiler-quoted type snippets also stabilize.
  let prev = collapsed;
  for (let n = 0; n < 8; n += 1) {
    let next = sortTypeMembers(prev, '|');
    next = sortTypeMembers(next, '&');
    next = sortQuotedStringUnion(next);
    next = sortIdentifierChain(next, '|');
    next = sortIdentifierChain(next, '&');
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

export function parseTscPrettyFalse(raw) {
  const text = String(raw || '');
  const lines = text.split(/\n/);
  const diags = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const message = canonicalizeMessage(current.messageLines.join('\n'));
    diags.push({
      file: current.file,
      code: current.code,
      severity: current.severity,
      message,
      line: current.line,
      column: current.column,
    });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const match = line.match(HEADER);
    if (match) {
      flush();
      current = {
        file: normalizePath(match[1]),
        line: Number(match[2]),
        column: Number(match[3]),
        severity: match[4],
        code: match[5],
        messageLines: [match[6]],
      };
      continue;
    }
    if (current) current.messageLines.push(line);
  }
  flush();
  return diags;
}

export function headerCount(raw) {
  const text = String(raw || '');
  const re = /\): (error|warning) TS\d+:/g;
  let count = 0;
  while (re.exec(text)) count += 1;
  return count;
}

export function identityKey(diag) {
  return `${diag.file}\u0000${diag.code}\u0000${diag.message}`;
}

export function aggregateIdentities(diags) {
  const map = new Map();
  for (const diag of diags) {
    const key = identityKey(diag);
    const prev = map.get(key);
    if (prev) prev.count += 1;
    else {
      map.set(key, {
        file: diag.file,
        code: diag.code,
        message: diag.message,
        count: 1,
      });
    }
  }
  const identities = [...map.values()].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.message !== b.message) return a.message < b.message ? -1 : 1;
    return 0;
  });
  const total = identities.reduce((sum, item) => sum + item.count, 0);
  return { identities, total };
}

export function compareBaselines(expected, actual) {
  const expMap = new Map(expected.identities.map((item) => [identityKey(item), item]));
  const actMap = new Map(actual.identities.map((item) => [identityKey(item), item]));
  const added = [];
  const removed = [];
  const countDrift = [];

  for (const [key, item] of actMap) {
    const prior = expMap.get(key);
    if (!prior) added.push(item);
    else if (prior.count !== item.count) {
      countDrift.push({
        file: item.file,
        code: item.code,
        message: item.message,
        expected: prior.count,
        actual: item.count,
        delta: item.count - prior.count,
      });
    }
  }
  for (const [key, item] of expMap) {
    if (!actMap.has(key)) removed.push(item);
  }

  return {
    added,
    removed,
    countDrift,
    expectedTotal: expected.total,
    actualTotal: actual.total,
    totalDrift: actual.total - expected.total,
  };
}

export function perFileTotals(identities) {
  const map = new Map();
  for (const item of identities) {
    map.set(item.file, (map.get(item.file) || 0) + item.count);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([file, count]) => ({ file, count }));
}

export function runShippedTsc(root = ROOT) {
  const tscJs = join(root, 'node_modules', 'typescript', 'lib', 'tsc.js');
  if (!existsSync(tscJs)) {
    throw new Error(`shipped compiler missing: ${relative(root, tscJs)}`);
  }
  const result = spawnSync(process.execPath, [tscJs, ...TSC_ARGS], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER_BYTES,
    windowsHide: true,
  });
  if (result.error) {
    if (result.error.code === 'ENOBUFS') {
      throw new Error('tsc output exceeded maxBuffer; refusing to truncate');
    }
    throw result.error;
  }
  const stdout = result.stdout == null ? '' : String(result.stdout);
  const stderr = result.stderr == null ? '' : String(result.stderr);
  const raw = stdout + stderr;
  return {
    raw,
    stdout,
    stderr,
    status: result.status,
    signal: result.signal,
    pid: result.pid,
  };
}

export function snapshotFromRun(run) {
  const headers = headerCount(run.raw);
  const parsed = parseTscPrettyFalse(run.raw);
  if (parsed.length !== headers) {
    throw new Error(
      `parser/header mismatch: parsed=${parsed.length} headers=${headers} (refusing to proceed)`,
    );
  }
  const { identities, total } = aggregateIdentities(parsed);
  return {
    version: 1,
    command: ['node', 'node_modules/typescript/lib/tsc.js', ...TSC_ARGS],
    expectedExitCode: run.status,
    total,
    identities,
  };
}

export function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) {
    throw new Error(`TypeScript baseline snapshot missing: ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed.version !== 1 || !Array.isArray(parsed.identities)) {
    throw new Error('TypeScript baseline snapshot is malformed');
  }
  return parsed;
}

export function formatDriftReport(cmp, extra = {}) {
  const lines = [];
  lines.push(`TypeScript baseline: expectedTotal=${cmp.expectedTotal} actualTotal=${cmp.actualTotal} totalDrift=${cmp.totalDrift}`);
  if (extra.expectedExitCode != null) {
    lines.push(`exit: expected=${extra.expectedExitCode} actual=${extra.actualExitCode}`);
  }
  lines.push(`added identities: ${cmp.added.length}`);
  for (const item of cmp.added) {
    lines.push(`  + ${item.file} ${item.code} x${item.count} :: ${item.message}`);
  }
  lines.push(`removed identities: ${cmp.removed.length}`);
  for (const item of cmp.removed) {
    lines.push(`  - ${item.file} ${item.code} x${item.count} :: ${item.message}`);
  }
  lines.push(`count drift: ${cmp.countDrift.length}`);
  for (const item of cmp.countDrift) {
    lines.push(
      `  ~ ${item.file} ${item.code} ${item.expected}->${item.actual} (delta ${item.delta}) :: ${item.message}`,
    );
  }
  return lines.join('\n');
}

export function verifyTscBaseline({ root = ROOT, baselinePath = BASELINE_PATH } = {}) {
  const expected = loadBaseline(baselinePath);
  const run = runShippedTsc(root);
  const actual = snapshotFromRun(run);
  const cmp = compareBaselines(expected, actual);

  const commandMismatch =
    JSON.stringify(expected.command) !== JSON.stringify(['node', 'node_modules/typescript/lib/tsc.js', ...TSC_ARGS]);

  const suppressed =
    expected.total > 0 && actual.total === 0;

  const ok =
    cmp.added.length === 0 &&
    cmp.removed.length === 0 &&
    cmp.countDrift.length === 0 &&
    cmp.totalDrift === 0 &&
    expected.expectedExitCode === actual.expectedExitCode &&
    !commandMismatch &&
    !suppressed &&
    run.signal == null;

  return {
    ok,
    expected,
    actual,
    cmp,
    run,
    commandMismatch,
    suppressed,
    perFile: {
      expected: perFileTotals(expected.identities),
      actual: perFileTotals(actual.identities),
    },
    report: formatDriftReport(cmp, {
      expectedExitCode: expected.expectedExitCode,
      actualExitCode: actual.expectedExitCode,
    }),
  };
}

function writeBaseline() {
  const run = runShippedTsc(ROOT);
  const snapshot = snapshotFromRun(run);
  writeFileSync(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return snapshot;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const mode = process.argv.includes('--write') ? 'write' : 'verify';
  if (mode === 'write') {
    const snapshot = writeBaseline();
    console.log(`wrote ${relative(ROOT, BASELINE_PATH)} total=${snapshot.total} identities=${snapshot.identities.length} exit=${snapshot.expectedExitCode}`);
    process.exit(0);
  }
  const result = verifyTscBaseline();
  console.log(result.report);
  if (!result.ok) {
    if (result.commandMismatch) console.error('FAIL command mismatch vs shipped compiler invocation');
    if (result.suppressed) console.error('FAIL diagnostics silently suppressed (baseline total > 0, actual total = 0)');
    process.exit(1);
  }
  console.log('PASS TypeScript baseline: no added identities, no removed identities, no count drift');
  process.exit(0);
}
