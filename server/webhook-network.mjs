// Adapt standard HTTP clients to the broker without giving the sandbox a network interface.
export const nodeNetwork=`
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init);request.signal.throwIfAborted();
 const bytes=Buffer.from(await request.arrayBuffer());if(bytes.length>128000)throw Error('Request too large');
 const response=await nativeFetch(process.env.OPENSI_HTTP_BRIDGE,{method:'POST',headers:{'content-type':'application/json','authorization':process.env.OPENSI_HTTP_NONCE},body:JSON.stringify({url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body:bytes.toString('base64'),redirect:request.redirect}),signal:request.signal});
 const value=await response.json();if(value.error)throw Error(value.error);
 const result=new Response([204,205,304].includes(value.status)||request.method==='HEAD'?null:Buffer.from(value.body,'base64'),{status:value.status,headers:value.headers});
 Object.defineProperty(result,'url',{value:value.url});return result;
};
`;
export const pythonNetwork=`
import os,json,base64,io,urllib.request,urllib.response,urllib.error,email.message
_opensi_urlopen=urllib.request.urlopen
def _opensi_exchange(url,method,headers,body):
    if isinstance(body,str): body=body.encode()
    if body and len(body)>128000: raise ValueError('Request too large')
    data=json.dumps(dict(url=url,method=method,headers=dict(headers),body=base64.b64encode(body or b'').decode())).encode()
    req=urllib.request.Request(os.environ['OPENSI_HTTP_BRIDGE'],data=data,headers={'Authorization':os.environ['OPENSI_HTTP_NONCE'],'Content-Type':'application/json'})
    with _opensi_urlopen(req,timeout=10) as r: value=json.load(r)
    if 'error' in value: raise OSError(value['error'])
    return value
def _opensi_open(url,data=None,timeout=None,**kw):
    req=url if isinstance(url,urllib.request.Request) else urllib.request.Request(url,data=data)
    v=_opensi_exchange(req.full_url,req.get_method(),req.header_items(),req.data)
    headers=email.message.Message()
    for k,val in v['headers'].items(): headers[k]=str(val)
    r=urllib.response.addinfourl(io.BytesIO(base64.b64decode(v['body'])),headers,v['url'],v['status'])
    if v['status']>=400: raise urllib.error.HTTPError(v['url'],v['status'],'HTTP error',headers,r)
    return r
urllib.request.urlopen=_opensi_open
try:
    import requests
    def _opensi_send(self,request,**kwargs):
        v=_opensi_exchange(request.url,request.method,request.headers,request.body)
        r=requests.Response();r.status_code=v['status'];r._content=base64.b64decode(v['body']);r.headers.update(v['headers']);r.url=v['url'];r.request=request;r.encoding=requests.utils.get_encoding_from_headers(r.headers);return r
    requests.sessions.Session.send=_opensi_send
except ImportError: pass
`;
