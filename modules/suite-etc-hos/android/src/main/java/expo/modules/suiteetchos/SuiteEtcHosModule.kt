package expo.modules.suiteetchos

import android.app.PendingIntent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Binder bridge to the configured ETC suitehos provider.
 *
 * SUITE_ETC_DISPATCH_ENABLED is compiled false. Authority, package, and
 * certificate come from BuildConfig. A configured fingerprint does not
 * place a call. Wire keys are String payload and Parcelable startIntent.
 */
class SuiteEtcHosModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SuiteEtcHos")

    // Async so a stalled binder call cannot freeze the Start Shift UI.
    AsyncFunction("callProvider") { method: String, payload: String, expectedPackage: String, expectedCertSha256: String, activityVisible: Boolean ->
      callProvider(method, payload, expectedPackage, expectedCertSha256, activityVisible)
    }
  }

  private fun callProvider(
    method: String,
    payload: String,
    expectedPackage: String,
    expectedCertSha256: String,
    activityVisible: Boolean,
  ): String {
    if (!BuildConfig.SUITE_ETC_DISPATCH_ENABLED) {
      return fail("dispatch_disabled")
    }
    val authority = BuildConfig.SUITE_ETC_AUTHORITY
    val configuredPackage = BuildConfig.SUITE_ETC_PACKAGE
    val configuredCert = BuildConfig.SUITE_ETC_CERT_SHA256
    if (authority.isBlank() || configuredPackage.isBlank() || !configuredCert.matches(Regex("^[0-9a-fA-F]{64}$"))) {
      return fail("signing_unverified")
    }
    if (expectedPackage.isNotBlank() && expectedPackage != configuredPackage) {
      return fail("package_mismatch")
    }
    if (expectedCertSha256.isNotBlank() && !expectedCertSha256.equals(configuredCert, ignoreCase = true)) {
      return fail("package_mismatch")
    }
    val context = appContext.reactContext ?: return fail("native_unavailable")
    if (!signatureMatches(context.packageManager, configuredPackage, configuredCert)) {
      return fail("package_mismatch")
    }
    if (method == "prepareStart" && !activityVisible) {
      return fail("activity_not_visible")
    }
    val called = try {
      val extras = Bundle()
      extras.putString("payload", payload)
      context.contentResolver.call(
        Uri.parse("content://$authority"),
        method,
        null,
        extras,
      ) ?: return fail("absent")
    } catch (security: SecurityException) {
      return fail("permission_denied")
    } catch (bad: IllegalArgumentException) {
      return fail("illegal_argument")
    } catch (_: Exception) {
      return fail("bridge_error")
    }
    val payloadJson = called.getString("payload")
    if (payloadJson.isNullOrEmpty()) return fail("malformed_response")
    val parsed = try {
      JSONObject(payloadJson)
    } catch (_: Exception) {
      return fail("malformed_response")
    }
    val body = JSONObject()
    body.put("ok", true)
    body.put("response", parsed)
    if (method == "prepareStart") {
      val pending = readPendingIntent(called)
      if (pending == null) {
        body.put("startIntent", "absent")
        body.put("pendingIntentCreatorPackage", JSONObject.NULL)
      } else {
        val creator = pending.creatorPackage
        body.put("pendingIntentCreatorPackage", creator ?: JSONObject.NULL)
        if (creator != configuredPackage) {
          return fail("pending_intent_creator_mismatch")
        }
        if (!activityVisible) {
          body.put("startIntent", "present")
        } else {
          try {
            pending.send()
            body.put("startIntent", "sent")
          } catch (_: Exception) {
            return fail("token_send_failed")
          }
        }
      }
    } else {
      body.put("startIntent", "absent")
      body.put("pendingIntentCreatorPackage", JSONObject.NULL)
    }
    return body.toString()
  }

  private fun readPendingIntent(bundle: Bundle): PendingIntent? {
    return if (Build.VERSION.SDK_INT >= 33) {
      bundle.getParcelable("startIntent", PendingIntent::class.java)
    } else {
      @Suppress("DEPRECATION")
      bundle.getParcelable("startIntent")
    }
  }

  private fun signatureMatches(
    packageManager: PackageManager,
    configuredPackage: String,
    configuredCert: String,
  ): Boolean {
    return try {
      val info = if (Build.VERSION.SDK_INT >= 28) {
        packageManager.getPackageInfo(configuredPackage, PackageManager.GET_SIGNING_CERTIFICATES)
      } else {
        @Suppress("DEPRECATION")
        packageManager.getPackageInfo(configuredPackage, PackageManager.GET_SIGNATURES)
      }
      val signatures = if (Build.VERSION.SDK_INT >= 28) {
        info.signingInfo?.apkContentsSigners ?: return false
      } else {
        @Suppress("DEPRECATION")
        info.signatures ?: return false
      }
      if (signatures.size != 1) return false
      val digest = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray())
      digest.joinToString("") { "%02x".format(it) }.equals(configuredCert, ignoreCase = true)
    } catch (_: Exception) {
      false
    }
  }

  private fun fail(reason: String): String {
    return JSONObject().put("ok", false).put("reason", reason).toString()
  }
}
