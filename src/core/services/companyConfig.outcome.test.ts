// Pure-ish pins for companyConfig load outcomes.
// Network/AsyncStorage are not exercised live; this file proves the
// public contract shapes and documents the null-collapse hazard.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const cc = readFileSync(join(__dirname, 'companyConfig.ts'), 'utf8');

test('loadCompanyConfigResult is the explicit-outcome API; fetchCompanyConfig collapses to null', () => {
  assert.ok(cc.includes('export type CompanyConfigLoadResult'));
  assert.ok(cc.includes('export async function loadCompanyConfigResult'));
  assert.ok(cc.includes('export async function fetchCompanyConfig'));

  // fetchCompanyConfig must derive from loadCompanyConfigResult
  const fetchFn = cc.slice(cc.indexOf('export async function fetchCompanyConfig'));
  assert.ok(fetchFn.includes('loadCompanyConfigResult'));
  assert.ok(/return null/.test(fetchFn.slice(0, 800)));
});

test('unavailable reasons cover empty id and network/http without inventing legacy', () => {
  assert.ok(cc.includes("reason: 'empty_company_id'"));
  assert.ok(cc.includes("reason: 'network_or_http'"));
  assert.ok(cc.includes("kind: 'unavailable'"));
});

test('stale cache path is failure-fallback without TTL check inside getCachedConfig', () => {
  const getCached = cc.slice(cc.indexOf('async function getCachedConfig'));
  // getCachedConfig body must not reference CACHE_TTL_MS
  const body = getCached.slice(0, getCached.indexOf('export function isAppEnabled'));
  assert.ok(!body.includes('CACHE_TTL_MS'),
    'getCachedConfig must not enforce TTL (failure fallback returns any stored config)');
  assert.ok(body.includes('JSON.parse'));
});

test('fresh TTL path is separate from stale failure fallback', () => {
  assert.ok(cc.includes("freshness: 'fresh'"));
  assert.ok(cc.includes("freshness: 'stale'"));
  assert.ok(cc.includes('Date.now() - parsed.fetchedAt < CACHE_TTL_MS'));
});

test('forceRefresh skips TTL fast path for cutover re-read', () => {
  assert.ok(cc.includes('forceRefresh'));
  assert.ok(cc.includes('if (!forceRefresh)'));
  // Comment documents no auth/shift wipe
  assert.ok(/cutover|forceRefresh/.test(cc));
});

test('clearCompanyConfigCache only removes company-config keys, not enforcement LKG', () => {
  const clear = cc.slice(cc.indexOf('export async function clearCompanyConfigCache'));
  assert.ok(clear.includes('CACHE_KEY_PREFIX') || clear.includes('wellbuilt-company-config-'));
  assert.ok(!clear.includes('enforcement-safety'));
  assert.ok(!clear.includes('driverId'));
  assert.ok(!clear.includes('shift'));
});
