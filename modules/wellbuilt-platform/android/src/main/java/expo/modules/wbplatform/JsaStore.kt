package expo.modules.wbplatform

import android.content.Context
import org.json.JSONArray

/** Separate from login credentials. Immutable records prevent two applications
 * from overwriting each other's offline actions. Peer IPC never holds a lock. */
internal object JsaStore {
 private const val prefs="wb_prepared_jsa_v1"
 private fun valid(key:String)=key.matches(Regex("[a-z0-9_-]{1,40}/[A-Za-z0-9._-]{1,128}"))
 @Synchronized fun keys(c:Context):String=JSONArray(c.getSharedPreferences(prefs,Context.MODE_PRIVATE).all.keys.sorted()).toString()
 @Synchronized fun read(c:Context,key:String):String? {
  require(valid(key));val encoded=c.getSharedPreferences(prefs,Context.MODE_PRIVATE).getString(key,null)?:return null
  return AccountStore.unseal(encoded)
 }
 @Synchronized fun write(c:Context,key:String,raw:String):Boolean {
  require(valid(key)&&raw.length<=480000)
  val previous=read(c,key);if(previous!=null){check(previous==raw){"immutable_jsa_record"};return true}
  check(c.getSharedPreferences(prefs,Context.MODE_PRIVATE).edit().putString(key,AccountStore.seal(raw)).commit())
  return true
 }
 @Synchronized fun writeBatch(c:Context,raw:String):Boolean {
  require(raw.length<=500000)
  val batch=JSONArray(raw);require(batch.length() in 1..4)
  val values=mutableMapOf<String,String>()
  for(i in 0 until batch.length()){
   val item=batch.getJSONObject(i);val key=item.getString("key");val value=item.getString("value")
   require(valid(key)&&value.length<=480000&&!values.containsKey(key))
   val old=read(c,key);check(old==null||old==value){"immutable_jsa_record"};values[key]=value
  }
  val edit=c.getSharedPreferences(prefs,Context.MODE_PRIVATE).edit()
  for((key,value) in values)edit.putString(key,AccountStore.seal(value))
  check(edit.commit());return true
 }
}
