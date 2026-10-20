package expo.modules.wbplatform
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject
internal object AccountStore {
 private const val alias="wb_platform_account_v1"
 private fun key():SecretKey {
  val ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null)
  (ks.getKey(alias,null) as? SecretKey)?.let{return it}
  val gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
  gen.init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
  return gen.generateKey()
 }
 @Synchronized fun read(c:Context):String? { return try {
  val raw=c.getSharedPreferences(alias,Context.MODE_PRIVATE).getString("account",null) ?: return null
  val parts=raw.split(":");if(parts.size!=2)return null
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)))
  String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),Charsets.UTF_8)
 }catch(_:Exception){null} }
 @Synchronized fun write(c:Context,raw:String){
  require(raw.length<=65536)
  val row=JSONObject(raw);val access=row.getJSONObject("access");require(access.getInt("version")==1)
  require(access.getString("grantId").matches(Regex("[a-f0-9]{64}")))
  require(access.getLong("establishedAtMs")>0)
  val owner=access.getJSONObject("owner");for(k in listOf("uid","driverId","companyId"))require(owner.getString(k).isNotBlank())
  require(row.optBoolean("revoked",false)||row.getString("credential").matches(Regex("[A-Za-z0-9_-]{43}")))
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key())
  val encoded=Base64.encodeToString(cipher.iv,Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(raw.toByteArray(Charsets.UTF_8)),Base64.NO_WRAP)
  check(c.getSharedPreferences(alias,Context.MODE_PRIVATE).edit().putString("account",encoded).commit())
 }
}
