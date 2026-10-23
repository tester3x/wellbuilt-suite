package expo.modules.wbplatform
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Binder
import android.os.Bundle
class AccountProvider:ContentProvider(){
 override fun onCreate()=true
 override fun call(method:String,arg:String?,extras:Bundle?):Bundle {
  val c=context ?: throw SecurityException("unavailable")
  if(!AccountTrust.caller(c,Binder.getCallingUid()))throw SecurityException("untrusted_caller")
  if(method=="jsaKeys"&&arg==null&&extras==null)return Bundle().apply{putString("value",JsaStore.keys(c))}
  if(method=="jsaRead"&&arg!=null&&extras==null)return Bundle().apply{putString("value",JsaStore.read(c,arg))}
  if(method!="read"||arg!=null||extras!=null)throw SecurityException("unsupported")
  return Bundle().apply{putString("record",AccountStore.read(c))}
 }
 override fun query(uri:Uri,projection:Array<out String>?,selection:String?,selectionArgs:Array<out String>?,sortOrder:String?):Cursor?=throw SecurityException("unsupported")
 override fun getType(uri:Uri):String?=null
 override fun insert(uri:Uri,values:ContentValues?):Uri?=throw SecurityException("unsupported")
 override fun delete(uri:Uri,selection:String?,selectionArgs:Array<out String>?):Int=throw SecurityException("unsupported")
 override fun update(uri:Uri,values:ContentValues?,selection:String?,selectionArgs:Array<out String>?):Int=throw SecurityException("unsupported")
}
