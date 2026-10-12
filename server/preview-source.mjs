// Serve build assets under the signed project URL while retaining an opaque sandbox origin.
export function previewSource(content,extension,base,documentBase=base){
 const root=String(base).replace(/\/$/,'')+'/';
 const paths=text=>text.replace(/(["'`])\/(?!\/)([A-Za-z0-9_][^"'`\s<>\\]*)\1/g,(m,q,p)=>/\.(?:[cm]?js|css|png|jpe?g|webp|svg|gif|ico|mp3|wav|m4a|ogg|mp4|webm|pdf|json|woff2?|ttf|otf|wasm|zip|docx|xlsx|pptx)(?:[?#].*)?$/i.test(p)?q+root+p+q:m);
 if(extension==='.html'||extension==='.htm'){
  let html=paths(content).replace(/<base\b[^>]*>/gi,'');
  // Opaque sandbox frames have no Web Storage. A tab-local shim allows apps to render;
  // it deliberately does not grant the preview access to OpenSI cookies or storage.
  const shim=`<base href="${String(documentBase).replace(/\/$/,'')+'/'}"><script>(()=>{for(const name of ['localStorage','sessionStorage']){try{window[name].getItem('__opensi_probe');}catch{const data=new Map();Object.defineProperty(window,name,{value:{get length(){return data.size},key:i=>Array.from(data.keys())[i]??null,getItem:k=>data.get(String(k))??null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear()},configurable:false});}}})();</script>`;
  return /<head\b[^>]*>/i.test(html)?html.replace(/<head\b[^>]*>/i,m=>m+shim):shim+html;
 }
 if(['.js','.mjs','.css'].includes(extension))return paths(content).replace(/url\(\/(?!\/)([^)\s]+)\)/g,(_m,p)=>'url('+root+p+')');
 return content;
}
