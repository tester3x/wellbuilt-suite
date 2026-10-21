package expo.modules.wbplatform;

/** Monotonic state within one protected device grant. Pure JVM policy. */
public final class AccountRecordPolicy {
  private AccountRecordPolicy() {}

  public static boolean mayReplace(boolean sameGrant, boolean sameOwner,
      boolean wasRevoked, boolean willRevoke, long checkedAt, long nextCheckedAt) {
    if (!sameGrant) return true; // A newly verified explicit login uses a new grant.
    if (!sameOwner) return false;
    if (wasRevoked && !willRevoke) return false;
    return willRevoke || nextCheckedAt >= checkedAt;
  }
}
