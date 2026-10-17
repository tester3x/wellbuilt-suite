# Suite 72 installed on ZFold

- Source: `8464453f588bfe9edc770e242b715e9e875bcf6c`, branch `codex/suite-etc-start-hos`.
- EAS internal preview APK: `63e8f853-f77f-4ec7-82db-084a01c03f0e`, successful.
- APK: `C:/dev/TicketTimeExpo/tmp/suite-v72-20261016.apk`.
- SHA256: `7F6E199BAC95D85AD7A3CA09A7B46439C164496447099CD9E9F0CACD6B321A48`.
- Package: `com.wellbuilt.suite`, versionCode 72, versionName 1.0.0. Verified installed October 16 at 9:44 PM Central.

Push install succeeded with existing app data preserved. MainActivity launched and process remained running; no startup fatal exception observed. Initial company-config requests logged `company_config_session_required` during startup; authenticated configuration and the complete handoff were not exercised as part of installation. No shift was started/ended or inspection fabricated for smoke testing.

Contains governed Android fallback context preservation and earlier 60-second shift authority timeout for cold starts. This does not remove backend authorization or guarantee a particular handoff duration.

Also verified on the ZFold: Equipment 59 (source `25ea150`, EAS `1b50d703-3a53-42b6-adfb-132e7c16ed49`) and WB Tickets 181. Equipment's own install record is in its repository. Actual pending-item recovery and end-shift handoff timing remain field validation; initial history backfill/auth/cold-start latency can remain.
