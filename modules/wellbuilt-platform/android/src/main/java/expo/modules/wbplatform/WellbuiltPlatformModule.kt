package expo.modules.wbplatform
import android.content.Context
import android.net.Uri
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
class WellbuiltPlatformModule:Module(){
 private var accountObserver:ContentObserver?=null
 private var connectivity:ConnectivityManager?=null
 private var callback:ConnectivityManager.NetworkCallback?=null
 private fun reachable():Boolean {val m=connectivity?:context().getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager;val caps=m.getNetworkCapabilities(m.activeNetwork);return caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)==true&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)}
 private fun context()=appContext.reactContext ?: throw IllegalStateException("unavailable")
 private fun latest(c:Context):String? {
  val records=mutableListOf<String>();AccountStore.read(c)?.let{records.add(it)}
  for(pkg in AccountTrust.pins.keys){
   if(pkg==c.packageName||!AccountTrust.trusted(c,pkg))continue
   try {
    val authority=pkg+".wbplatform"
    if(c.packageManager.resolveContentProvider(authority,0)?.packageName!=pkg)continue
    c.contentResolver.call(Uri.parse("content://"+authority),"read",null,null)?.getString("record")?.let{records.add(it)}
   }catch(_:Exception){ }
  }
  return records.filter{try{JSONObject(it).getJSONObject("access").getLong("establishedAtMs")>0}catch(_:Exception){false}}
   .maxWithOrNull(compareBy<String>{JSONObject(it).getJSONObject("access").getLong("establishedAtMs")}
    .thenBy{JSONObject(it).getJSONObject("access").getString("grantId")}
    .thenBy{if(JSONObject(it).optBoolean("revoked",false))1 else 0}
    .thenBy{JSONObject(it).getJSONObject("access").optLong("checkedAtMs",0)})
 }
 override fun definition()=ModuleDefinition {
  Name("WellbuiltPlatform")
  Events("connectionChanged","accountChanged")
  OnCreate {
   val m=context().getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
   connectivity=m
   val cb=object:ConnectivityManager.NetworkCallback(){
    private fun changed(){sendEvent("connectionChanged",mapOf("reachable" to reachable()))}
    override fun onAvailable(network:Network){changed()}
    override fun onLost(network:Network){changed()}
    override fun onCapabilitiesChanged(network:Network,caps:NetworkCapabilities){changed()}
   }
   callback=cb;m.registerDefaultNetworkCallback(cb)
   val observer=object:ContentObserver(Handler(Looper.getMainLooper())){override fun onChange(selfChange:Boolean){sendEvent("accountChanged",emptyMap<String,Any>())}}
   accountObserver=observer
   for(pkg in AccountTrust.pins.keys){if(pkg==context().packageName||AccountTrust.trusted(context(),pkg))try{context().contentResolver.registerContentObserver(Uri.parse("content://"+pkg+".wbplatform"),false,observer)}catch(_:Exception){}}

  }
  OnDestroy {accountObserver?.let{context().contentResolver.unregisterContentObserver(it)};accountObserver=null;callback?.let{try{connectivity?.unregisterNetworkCallback(it)}catch(_:Exception){}};callback=null;connectivity=null}
  AsyncFunction("connectionState"){ ->mapOf("reachable" to reachable())}
  AsyncFunction("readAccount"){ ->latest(context())}
  AsyncFunction("publishAccount"){raw:String,expectedGrant:String?->
   synchronized(AccountStore){
    val c=context();val current=latest(c);val id=current?.let{JSONObject(it).getJSONObject("access").getString("grantId")}
    if(id!=expectedGrant)false else {AccountStore.write(c,raw);true}
   }
  }
  AsyncFunction("revokeAccount"){grantId:String->
   synchronized(AccountStore){
    val c=context();val current=latest(c)
    if(current==null||JSONObject(current).getJSONObject("access").getString("grantId")!=grantId)false
    else {val row=JSONObject(current);row.remove("credential");row.put("revoked",true);AccountStore.write(c,row.toString());true}
   }
  }
 }
}
