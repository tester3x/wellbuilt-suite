# Canonical platform runtime migration checkpoint

Suite: general app launch and Switcher now select the canonical credential-free app-open route for Tickets/Mobile/JSA/Equipment, with noncredential driver/company hints. Hub/local-tool returns keep their bare, immediate shell route. No shift/DVIR action is inferred. One redundant forced identity refresh was removed from Equipment issuance; the server still authorizes the request. Shared entry/authorization/refresh tests: 58 passed. Existing unrelated ssoProtocol.generated.ts working modification preserved and excluded from commits.

Canonical source: tester3x/wellbuilt-contracts, codex/platform-entry-offline-20261019, checkpoint 245278d. Runtime source SHA256: dcee868372558608a0e79eb521cd487f9b2f5a1e6a7085c8ea301deaaba3eec6. Mirrors are generated and byte checked; do not independently edit them.

Source-only checkpoint. No APK, deployment or device certification. Still required platform-wide: authenticated device/account broker, canonical server-derived app-access list propagation after any-app login, common connection hold/recovery integration in every durable queue, and offline/reconnect/restart device acceptance. Pure runtime/URI/quality tests pass (20) but do not certify app behavior. Keep these facts separate from the tested cached-entry adapters.


Shared delivery wake policy synchronized (unbuilt). This app receives the same canonical deadline/hold calculation; this mirror update alone does not integrate its queues. Mobile packet and Tickets ticket/timeline/WB-packet adapters are integrated separately. Shared any-app account broker and remaining queue/device acceptance remain unfinished. No build or deployment.

