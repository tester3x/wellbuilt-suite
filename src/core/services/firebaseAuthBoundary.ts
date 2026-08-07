/**
 * Firebase React Native persistence — capability boundary.
 *
 * PORTED from WB-T (utils/firebaseAuthBoundary.ts, vc51.9I-RECOVERY4)
 * unchanged. It is app-agnostic — every entry point takes the FirebaseApp
 * — so WB-S needed no functional adaptation, only its own app owner in
 * firebaseApp.ts. Both apps now run one verified Auth architecture. Fixes
 * to either copy should be mirrored; the rot pins below fire in both.
 *
 * ── The upstream defect ───────────────────────────────────────────────
 * Firebase 12.17.1 (@firebase/auth 1.13.4) DOES export
 * `getReactNativePersistence` from the public `firebase/auth` module on
 * React Native. Metro resolves that import through the package's
 * `react-native` export condition (and its top-level `react-native`
 * field) to dist/rn/index.js, which exports the factory.
 *
 * TypeScript cannot see it. The package orders its export conditions:
 *
 *     types -> node -> react-native -> cordova -> webworker -> browser
 *
 * and TypeScript always includes `types` in its condition set, so it
 * matches the FIRST entry and resolves dist/auth-public.d.ts — the
 * platform-neutral declarations, which omit the React Native factory. It
 * can never reach dist/rn/index.rn.d.ts, where the factory is declared.
 * The runtime is correct; only the declaration is unreachable.
 *
 * ── Why not the alternatives ──────────────────────────────────────────
 * `getAuth(app)` is NOT a substitute. Read from the installed RN bundle,
 * it warns and falls back to memory:
 *
 *     _logWarn(NO_PERSISTENCE_WARNING);
 *     return index.initializeAuth(app);   // no deps -> memory only
 *
 * and that warning states it plainly: "Auth state will default to memory
 * persistence and will not persist between sessions." Memory persistence
 * would mean drivers re-authenticate on every cold launch, so it is not
 * an option for this app.
 *
 * ── What this module is ───────────────────────────────────────────────
 * A single narrow boundary that asks the OFFICIAL public module, at
 * runtime, whether it provides the capability — then narrows the
 * namespace with a real type predicate. No ambient declaration, no
 * `declare module`, no suppression, no `any`, no double cast, no deep
 * import, no patch-package, no hand-written persistence, and no memory
 * fallback. Callers never learn any of this exists.
 *
 * ── Deleting this module ──────────────────────────────────────────────
 * When Firebase orders `react-native` before `types` in @firebase/auth's
 * export map (or ships a types entry that includes the RN surface),
 * `getReactNativePersistence` becomes importable directly and this file
 * should be deleted, with callers importing it from 'firebase/auth'.
 * tools/test-firebaseAuthBoundary.mjs fails when that day arrives, so
 * the workaround cannot quietly outlive the defect.
 */
import * as firebaseAuth from 'firebase/auth';
import type { Auth, Persistence } from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';

/**
 * The AsyncStorage contract Firebase's factory actually consumes. Kept
 * structural so this module never imports AsyncStorage itself.
 */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** The exact shape of the capability the RN bundle exports. */
type ReactNativePersistenceFactory = (storage: AsyncStorageLike) => Persistence;

/** The public namespace, plus the export TypeScript cannot see. */
type AuthWithRnPersistence = typeof firebaseAuth & {
  getReactNativePersistence: ReactNativePersistenceFactory;
};

/**
 * Boundary-owned instance registry.
 *
 * Kept on a `Symbol.for` slot rather than a module-level variable so it
 * survives Fast Refresh re-evaluating this module while the FirebaseApp
 * keeps its Auth instance. It records only what THIS boundary created
 * with AsyncStorage persistence, which is what makes the
 * `auth/already-initialized` recovery attributable rather than blind.
 *
 * This is our own state. Nothing here reads Firebase internals.
 */
const OWNED_SLOT = Symbol.for('wellbuilt.firebaseAuthBoundary.ownedAuth');

function ownedRegistry(): Map<FirebaseApp, Auth> {
  const existing: unknown = Reflect.get(globalThis, OWNED_SLOT);
  if (existing instanceof Map) return existing as Map<FirebaseApp, Auth>;
  const created = new Map<FirebaseApp, Auth>();
  Reflect.set(globalThis, OWNED_SLOT, created);
  return created;
}

/**
 * Raised when Auth was already initialized for this app but NOT by this
 * boundary. That instance may be memory-backed — accepting it would
 * silently drop session persistence — so it is refused.
 */
export class ForeignAuthInstanceError extends Error {
  constructor() {
    super(
      'Firebase Auth was already initialized for this app by something other than '
      + 'the auth boundary. Refusing to adopt it: its persistence cannot be '
      + 'attributed, and a memory-backed instance would silently end the driver '
      + 'session at every app restart.',
    );
    this.name = 'ForeignAuthInstanceError';
  }
}

/** Raised when the official runtime no longer supplies the capability. */
export class MissingRnPersistenceError extends Error {
  constructor() {
    // Diagnostic only — names no credential, storage key, or token.
    super(
      'firebase/auth did not provide getReactNativePersistence at runtime. '
      + 'Refusing to continue: falling back to memory persistence would silently '
      + 'stop the driver session surviving app restarts.',
    );
    this.name = 'MissingRnPersistenceError';
  }
}

/**
 * Real type predicate. Uses Reflect.get so the lookup is a runtime
 * property read rather than a typed member access, and only widens the
 * namespace type after confirming the property is callable.
 */
function providesRnPersistence(ns: typeof firebaseAuth): ns is AuthWithRnPersistence {
  const candidate: unknown = Reflect.get(ns, 'getReactNativePersistence');
  return typeof candidate === 'function';
}

/**
 * The narrowed factory. Throws rather than degrading — a missing
 * capability is a packaging change that must be noticed, not absorbed.
 */
export function getReactNativePersistenceFactory(): ReactNativePersistenceFactory {
  if (!providesRnPersistence(firebaseAuth)) throw new MissingRnPersistenceError();
  return firebaseAuth.getReactNativePersistence;
}

/** True when the official runtime still needs this boundary. */
export function boundaryStillRequired(): boolean {
  return providesRnPersistence(firebaseAuth);
}

/**
 * Initialize exactly one persistent Auth instance for this app.
 *
 * Uses `initializeAuth` with AsyncStorage-backed persistence — never
 * `getAuth`, which on React Native warns and returns memory-only.
 *
 * Repeat calls (Fast Refresh, a second import) hit
 * `auth/already-initialized`. That is recovered ONLY when this boundary
 * recorded the instance itself, so the returned Auth is provably the one
 * created above with AsyncStorage persistence. The SDK exposes no
 * supported way to interrogate an existing instance's persistence, and
 * reading Firebase internals is out of bounds — so an unattributable
 * instance is refused rather than guessed at.
 */
export function initializePersistentAuth(app: FirebaseApp, storage: AsyncStorageLike): Auth {
  const registry = ownedRegistry();
  const alreadyOurs = registry.get(app);
  if (alreadyOurs) return alreadyOurs;

  const persistence = getReactNativePersistenceFactory()(storage);
  try {
    const auth = firebaseAuth.initializeAuth(app, { persistence });
    registry.set(app, auth);
    return auth;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    // Someone else initialized Auth for this app first. Its persistence
    // is unknowable, so fail closed instead of adopting it.
    if (code === 'auth/already-initialized') throw new ForeignAuthInstanceError();
    throw err;
  }
}

/**
 * The boundary-owned Auth for this app, or null when the boundary has
 * not initialized it. Protected operations use this to fail closed
 * rather than proceeding on an unowned session.
 */
export function getOwnedAuth(app: FirebaseApp): Auth | null {
  return ownedRegistry().get(app) ?? null;
}

/** True when `auth` is the instance this boundary created for `app`. */
export function isBoundaryOwnedAuth(app: FirebaseApp, auth: Auth | null | undefined): boolean {
  if (!auth) return false;
  return ownedRegistry().get(app) === auth;
}

/**
 * Fail-closed accessor for protected paths. Throws when ownership is
 * missing or uncertain, so a split-family mutation can never run on a
 * session whose persistence this boundary did not establish.
 */
export function requireOwnedAuth(app: FirebaseApp): Auth {
  const auth = getOwnedAuth(app);
  if (!auth) throw new ForeignAuthInstanceError();
  return auth;
}

/** Test-only: clear ownership so a suite can exercise a cold start. */
export function __resetOwnershipForTests(): void {
  ownedRegistry().clear();
}

// ── Bounded Auth operations ─────────────────────────────────────────────
// Application modules import these instead of firebase/auth, so this stays
// the only module that touches the SDK and every operation runs against a
// provably persistent, boundary-owned instance. Nothing here re-exports
// the SDK surface, and no function accepts or returns a raw Auth outside
// the ownership helpers above.

/**
 * Resolve once the persisted session has been restored (or proven
 * absent). Startup gating uses this instead of racing the first render.
 */
export async function waitForAuthReady(app: FirebaseApp): Promise<void> {
  await requireOwnedAuth(app).authStateReady();
}

/** Exchange a server-minted custom token for an SDK session. */
export async function signInWithCustomTokenOwned(app: FirebaseApp, customToken: string): Promise<void> {
  await firebaseAuth.signInWithCustomToken(requireOwnedAuth(app), customToken);
}

/** End the SDK session. */
export async function signOutOwned(app: FirebaseApp): Promise<void> {
  await firebaseAuth.signOut(requireOwnedAuth(app));
}

/** Verified uid of the current SDK user, or null when signed out. */
export function getOwnedUserId(app: FirebaseApp): string | null {
  return getOwnedAuth(app)?.currentUser?.uid ?? null;
}

/**
 * ID token from the authenticated SDK user. The SDK owns refresh, so
 * this never maintains a parallel refresh-token system. Returns null
 * when signed out rather than throwing, so callers can fail closed on
 * their own terms.
 */
export async function getOwnedIdToken(app: FirebaseApp, forceRefresh = false): Promise<string | null> {
  const user = getOwnedAuth(app)?.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

/** Subscribe to session changes. Returns the unsubscribe function. */
export function onOwnedAuthStateChanged(
  app: FirebaseApp,
  cb: (uid: string | null) => void,
): () => void {
  return firebaseAuth.onAuthStateChanged(requireOwnedAuth(app), (user) => cb(user?.uid ?? null));
}
