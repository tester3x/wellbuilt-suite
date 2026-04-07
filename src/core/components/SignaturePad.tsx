// SignaturePad — Custom multi-stroke signature pad with auto-trim
// Uses a WebView with Canvas API. Multi-stroke: user can lift finger and continue.
// Auto-trim: whitespace is cropped from the exported PNG.

import React, { useRef, forwardRef, useImperativeHandle } from 'react';
import { View, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

interface SignaturePadProps {
  onBegin?: () => void;
  onSave?: (base64: string) => void;
  penColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  style?: ViewStyle;
}

export interface SignaturePadRef {
  clearSignature: () => void;
  readSignature: () => void;
}

const SignaturePad = forwardRef<SignaturePadRef, SignaturePadProps>(({
  onBegin,
  onSave,
  penColor = '#ffffff',
  backgroundColor = '#1a1a1a',
  strokeWidth = 5,
  style,
}, ref) => {
  const webViewRef = useRef<WebView>(null);

  useImperativeHandle(ref, () => ({
    clearSignature: () => {
      webViewRef.current?.postMessage(JSON.stringify({ type: 'clear' }));
    },
    readSignature: () => {
      webViewRef.current?.postMessage(JSON.stringify({ type: 'save' }));
    },
  }));

  const html = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="color-scheme" content="light only">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:${backgroundColor}}
canvas{display:block;width:100%;height:100%;touch-action:none}
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
var canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
var strokes=[],cur=[],drawing=false,dpr=window.devicePixelRatio||2;
function resize(){
  var r=canvas.getBoundingClientRect();
  canvas.width=r.width*dpr;canvas.height=r.height*dpr;
  ctx.scale(dpr,dpr);
  ctx.lineCap='round';ctx.lineJoin='round';
  ctx.strokeStyle='${penColor}';ctx.lineWidth=${strokeWidth};
  redraw();
}
function redraw(){
  ctx.clearRect(0,0,canvas.width/dpr,canvas.height/dpr);
  for(var s=0;s<strokes.length;s++){
    var pts=strokes[s];if(pts.length<2)continue;
    ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
    for(var i=1;i<pts.length;i++){
      if(i<pts.length-1){
        var mx=(pts[i].x+pts[i+1].x)/2,my=(pts[i].y+pts[i+1].y)/2;
        ctx.quadraticCurveTo(pts[i].x,pts[i].y,mx,my);
      }else{ctx.lineTo(pts[i].x,pts[i].y)}
    }
    ctx.stroke();
  }
}
function pos(e){
  var r=canvas.getBoundingClientRect(),t=e.touches?e.touches[0]:e;
  return{x:t.clientX-r.left,y:t.clientY-r.top};
}
canvas.addEventListener('touchstart',function(e){
  e.preventDefault();drawing=true;cur=[pos(e)];
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'begin'}));
},{passive:false});
canvas.addEventListener('touchmove',function(e){
  e.preventDefault();if(!drawing)return;
  var p=pos(e);cur.push(p);
  if(cur.length>=2){
    var prev=cur[cur.length-2];
    ctx.beginPath();ctx.moveTo(prev.x,prev.y);ctx.lineTo(p.x,p.y);ctx.stroke();
  }
},{passive:false});
canvas.addEventListener('touchend',function(e){
  e.preventDefault();
  if(drawing&&cur.length>0)strokes.push(cur.slice());
  drawing=false;cur=[];
},{passive:false});
function trimExport(){
  var w=canvas.width,h=canvas.height,d=ctx.getImageData(0,0,w,h).data;
  var x0=w,y0=h,x1=0,y1=0,found=false;
  var bgR=d[0],bgG=d[1],bgB=d[2];
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var i=(y*w+x)*4;
    if(d[i+3]>10&&(Math.abs(d[i]-bgR)>50||Math.abs(d[i+1]-bgG)>50||Math.abs(d[i+2]-bgB)>50)){
      found=true;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
    }
  }
  if(!found){window.ReactNativeWebView.postMessage(JSON.stringify({type:'save',data:''}));return}
  var pad=20;x0=Math.max(0,x0-pad);y0=Math.max(0,y0-pad);
  x1=Math.min(w-1,x1+pad);y1=Math.min(h-1,y1+pad);
  var cw=x1-x0+1,ch=y1-y0+1;
  var tc=document.createElement('canvas');tc.width=cw;tc.height=ch;
  var tx=tc.getContext('2d');
  tx.drawImage(canvas,x0,y0,cw,ch,0,0,cw,ch);
  var b64=tc.toDataURL('image/png').replace('data:image/png;base64,','');
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'save',data:b64}));
}
function onMsg(e){
  try{var m=JSON.parse(e.data);
    if(m.type==='clear'){strokes=[];cur=[];ctx.clearRect(0,0,canvas.width/dpr,canvas.height/dpr)}
    else if(m.type==='save'){trimExport()}
  }catch(ex){}
}
document.addEventListener('message',onMsg);
window.addEventListener('message',onMsg);
resize();window.addEventListener('resize',resize);
</script>
</body>
</html>`;

  const handleMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'begin') onBegin?.();
      if (msg.type === 'save' && msg.data) onSave?.(msg.data);
    } catch {}
  };

  return (
    <View style={[{ width: '100%', height: 200 }, style]}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        onMessage={handleMessage}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        originWhitelist={['*']}
        forceDarkAllowed={false}
        style={{ flex: 1, backgroundColor: 'transparent' }}
      />
    </View>
  );
});

export default SignaturePad;
