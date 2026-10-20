const React=require('react');
const {AppState}=require('react-native');
const native=require('./index');
const {buildPlatformAppEntryUrl}=require('./policy');
const keys={'wellbuilt-suite':'suite','wellbuilt-tickets':'tickets',wellbuiltmobile:'mobile',jsaapp:'jsa',wbequipment:'equipment',wellbuilttimecard:'etc',tickettime:'tickettime'};
function permits(allowed,target){
 if(allowed===null)return null;
 const url=buildPlatformAppEntryUrl({scheme:target.deepLinkScheme||target.scheme,androidPackage:target.androidPackage});
 const app=url&&keys[url.split('://')[0]];
 return app?allowed.includes(app):null;
}
exports.permits=permits;
/** Cached native access decides availability; registry supplies names and icons. */
exports.useAppAccess=function useAppAccess(open){
 const [allowed,setAllowed]=React.useState(null);
 React.useEffect(()=>{
  let live=true;
  const refresh=async()=>{try{const raw=await native?.readAccount();if(!live)return;const row=raw?JSON.parse(raw):null;const apps=row?.access?.allowedApps;setAllowed(row?.revoked?[]:Array.isArray(apps)&&apps.every(x=>Object.values(keys).includes(x))?apps:null);}catch{}};
  void refresh();const account=native?.addListener?.('accountChanged',()=>{void refresh();});
  const foreground=AppState.addEventListener('change',v=>{if(v==='active')void refresh();});
  return()=>{live=false;account?.remove();foreground.remove();};
 },[open]);
 return React.useCallback(target=>permits(allowed,target),[allowed]);
};
