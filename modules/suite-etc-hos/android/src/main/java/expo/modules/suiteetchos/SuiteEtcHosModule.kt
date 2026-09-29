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
 * Binder bridge to ETC's suitehos provider.
 *
 * Dispatch is impossible until the caller passes a non-blank expected
 * package and SHA-256 signing certificate. Those values are not baked
 * into this module. Bundle wire keys match ETC: String `payload` in both
 * directions, and Parcelable `startIntent` for unfinished observation.
 */
class SuiteEtcHosModule : Module() {
  private val authority = "com.wellbuilt.electronictimecard.suitehos"

  override fun definition() = ModuleDefinition {
    Name("SuiteEtcHos")

    // Async so a stalled binder call cannot freeze the Start Shift UI.
    // The JS adapter times that call out and records the outcome as unknown.
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
    if (expectedPackage.isBlank() || !expectedCertSha256.matches(Regex("^[0-9a-fA-F]{64}$"))) {
      return fail("signing_unverified")
    }
    val context = appContext.reactContext ?: return fail("native_unavailable")
    if (!signatureMatches(context.packageManager, expectedPackage, expectedCertSha256)) {
      return fail("package_mismatch")
    }
    if (method == "prepareStart" && !activityVisible) {
      return fail("activity_not_visible")
    }
    val result = try {
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
    val payloadJson = result.getString("payload")
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
      val pending = readPendingIntent(result)
      if (pending == null) {
        body.put("startIntent", "absent")
        body.put("pendingIntentCreatorPackage", JSONObject.NULL)
      } else {
        val creator = pending.creatorPackage
        body.put("pendingIntentCreatorPackage", creator ?: JSONObject.NULL)
        val trusted = creator == expectedPackage && activityVisible
        if (!trusted) {
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
    expectedPackage: String,
    expectedCertSha256: String,
  ): Boolean {
    return try {
      val info = if (Build.VERSION.SDK_INT >= 28) {
        packageManager.getPackageInfo(expectedPackage, PackageManager.GET_SIGNING_CERTIFICATES)
      } else {
        @Suppress("DEPRECATION")
        packageManager.getPackageInfo(expectedPackage, PackageManager.GET_SIGNATURES)
      }
      val signatures = if (Build.VERSION.SDK_INT >= 28) {
        info.signingInfo?.apkContentsSigners ?: return false
      } else {
        @Suppress("DEPRECATION")
        info.signatures ?: return false
      }
      if (signatures.size != 1) return false
      val digest = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray())
      digest.joinToString("") { "%02x".format(it) }.equals(expectedCertSha256, ignoreCase = true)
    } catch (_: Exception) {
      false
    }
  }

  private fun fail(reason: String): String {
    return JSONObject().put("ok", false).put("reason", reason).toString()
  }
}
