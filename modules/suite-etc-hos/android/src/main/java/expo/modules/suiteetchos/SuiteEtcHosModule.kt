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
 * into this module. The provider authority is the receiver checkpoint.
 * Bundle keys `request`, `result`, and `pendingIntent` are the Suite-side
 * names until ETC confirms them.
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
    return try {
      val extras = Bundle()
      extras.putString("request", payload)
      val result = context.contentResolver.call(
        Uri.parse("content://$authority"),
        method,
        null,
        extras,
      ) ?: return fail("absent")
      val body = JSONObject()
      body.put("ok", true)
      val resultJson = result.getString("result")
      body.put("response", if (resultJson.isNullOrEmpty()) JSONObject.NULL else JSONObject(resultJson))
      if (method == "prepareStart") {
        val pending = readPendingIntent(result)
        val creator = pending?.creatorPackage
        body.put("pendingIntentCreatorPackage", creator ?: JSONObject.NULL)
        val trusted = pending != null && creator == expectedPackage && activityVisible
        if (trusted) pending.send()
        body.put("pendingIntentSent", trusted)
      }
      body.toString()
    } catch (security: SecurityException) {
      fail("permission_denied")
    } catch (_: Exception) {
      fail("bridge_error")
    }
  }

  private fun readPendingIntent(bundle: Bundle): PendingIntent? {
    return if (Build.VERSION.SDK_INT >= 33) {
      bundle.getParcelable("pendingIntent", PendingIntent::class.java)
    } else {
      @Suppress("DEPRECATION")
      bundle.getParcelable("pendingIntent")
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
