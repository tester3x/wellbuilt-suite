/**
 * Terminal responder — structurally incapable of issuance.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { SSO_AUDIENCE_EQUIPMENT, SSO_AUDIENCE_WBT } from './ssoProtocol.generated.js';
import {
  mapTerminalReasonToErrorCode,
  respondSsoTerminalError,
} from './ssoTerminalResponder.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const B64 = 'A'.repeat(43);
const TICKETS =
  `wellbuilt-suite://sso-authorize?v=1&aud=${SSO_AUDIENCE_WBT}` +
  `&cc=${B64}&ccm=S256&state=${B64}`;
const EQUIP =
  `wellbuilt-suite://sso-authorize?v=1&aud=${SSO_AUDIENCE_EQUIPMENT}` +
  `&cc=${B64}&ccm=S256&state=${B64}`;

describe('ssoTerminalResponder', () => {
  it('maps terminal reasons to allowlisted error codes only', () => {
    assert.equal(mapTerminalReasonToErrorCode('revalidation_failed'), 'not_authorized');
    assert.equal(mapTerminalReasonToErrorCode('reconciliation_rejected'), 'not_authorized');
    assert.equal(mapTerminalReasonToErrorCode('equipment_unavailable'), 'not_authorized');
    assert.equal(mapTerminalReasonToErrorCode('reconciliation_unavailable'), 'unavailable');
    assert.equal(mapTerminalReasonToErrorCode('not_sso'), null);
  });

  it('opens a credential-free error callback and never a code', async () => {
    const opened: string[] = [];
    const r = await respondSsoTerminalError(TICKETS, 'revalidation_failed', {
      openUrl: async (u) => {
        opened.push(u);
      },
    });
    assert.equal(r.kind, 'answered');
    if (r.kind !== 'answered') return;
    assert.equal(r.errorCode, 'not_authorized');
    assert.equal(opened.length, 1);
    assert.match(opened[0], /^wellbuilt-tickets:\/\/sso-callback\?/);
    assert.match(opened[0], /status=error/);
    assert.match(opened[0], /err=not_authorized/);
    assert.doesNotMatch(opened[0], /[?&]code=/);
    assert.doesNotMatch(opened[0], /(token|passcode|hash|verifier|challenge)=/i);
  });

  it('equipment audience uses the equipment callback scheme', async () => {
    const opened: string[] = [];
    const r = await respondSsoTerminalError(EQUIP, 'equipment_unavailable', {
      openUrl: async (u) => {
        opened.push(u);
      },
    });
    assert.equal(r.kind, 'answered');
    assert.equal(opened[0].startsWith('wbequipment://sso-callback'), true);
    assert.match(opened[0], /err=not_authorized/);
  });

  it('non-SSO / invalid input is log-only', async () => {
    const opened: string[] = [];
    const r = await respondSsoTerminalError('wellbuilt-suite://home', 'not_sso', {
      openUrl: async (u) => {
        opened.push(u);
      },
    });
    assert.equal(r.kind, 'log_only');
    assert.equal(opened.length, 0);
  });

  it('source does not import issuance-capable modules', () => {
    const raw = readFileSync(join(HERE, 'ssoTerminalResponder.ts'), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /from '\.\/ssoRuntime'/);
    assert.doesNotMatch(src, /from '\.\/ssoAuthorizationCore'/);
    assert.doesNotMatch(src, /from '\.\/ssoIssuanceClient'/);
    assert.doesNotMatch(src, /from '\.\/firebaseAuthBoundary'/);
    assert.doesNotMatch(src, /createSsoAuthorizationHandler/);
    assert.doesNotMatch(src, /getVerifiedIdentity/);
    assert.doesNotMatch(src, /\brequestCode\b/);
  });
});
