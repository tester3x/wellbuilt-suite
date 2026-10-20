package expo.modules.wbplatform
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.security.MessageDigest
internal object AccountTrust {
 val pins=mapOf(
  "com.wellbuilt.suite" to "a7d1b6fb35c848239ccdc52e0e1c36be9a96b0786ff5628fa9b98bae80fa6aa6",
  "com.testerxxx.waterticket" to "1a15745a46f39264cea23d33e509bb60974f101c7bedb2d9938dba55a9d1d069",
  "com.wellbuiltmobile.app" to "4c4f7b4de36380e6326ed5f9296907203b3283061f41b7b0f67ef496d64c814b",
  "com.syconik801.jsaapp" to "fc833ec7502cead7c5f7b0e5e394a2f7958ded629e92edb5ec7ff9522722d459",
  "com.wellbuilt.equipment" to "9f1f85e35303bd866df2686e7e662b01ece6ed606a8062b17aa42781f69e307e",
  "com.wellbuilt.electronictimecard" to "349bac3a8a8462a223d9eeb8dc4511fb5091a81a3d48e819b94d46bf68ea75b7",
  "com.michaelburger.tickettime" to "f0e274f95acfbdb17ec024b9fa7c4ca50a0cc2c0568b8866a442b48ebb26d1ae"
 )
 fun trusted(context:Context,pkg:String):Boolean { return try {
  val pin=pins[pkg] ?: return false
  val pm=context.packageManager
  val signers=if(Build.VERSION.SDK_INT>=28)pm.getPackageInfo(pkg,PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners else @Suppress("DEPRECATION") pm.getPackageInfo(pkg,PackageManager.GET_SIGNATURES).signatures
  !signers.isNullOrEmpty() && signers.all { signer->MessageDigest.getInstance("SHA-256").digest(signer.toByteArray()).joinToString(""){"%02x".format(it)}==pin }
 } catch(_:Exception){false} }
 fun caller(context:Context,uid:Int):Boolean {
  if(uid==android.os.Process.myUid())return true
  val packages=context.packageManager.getPackagesForUid(uid) ?: return false
  return packages.isNotEmpty() && packages.all { trusted(context,it) }
 }
}
