import http from 'node:http';
import net from 'node:net';
import {lookup} from 'node:dns/promises';
import {blockedAddress} from './egress.mjs';
export function packageHost(authority){if(!['pypi.org:443','files.pythonhosted.org:443','registry.npmjs.org:443'].includes(authority))throw Error('Only package registry endpoints are allowed');return authority.split(':')[0];}
export function packageProxy(){
 const grants=new Map();
 const server=http.createServer((_q,r)=>{r.writeHead(405);r.end();});
 server.on('connect',async(req,socket,head)=>{
  let host;try{host=packageHost(req.url);}catch{socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  const key=String(req.headers['proxy-authorization']||'').replace(/^Basic /,'');let token='';try{token=Buffer.from(key,'base64').toString().split(':')[1];}catch{}
  const grant=grants.get(token);if(!grant||grant.count++>=2048||grant.sockets.size>=12){socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');return;}
  try{const addresses=await lookup(host,{all:true});if(!addresses.length||addresses.some(a=>blockedAddress(a.address)))throw Error('Address denied');if(!grants.has(token))throw Error('Expired');
   const address=addresses.find(a=>a.family===4)||addresses[0],upstream=net.connect({host:address.address,port:443});grant.sockets.add(socket);grant.sockets.add(upstream);
   const close=()=>{socket.destroy();upstream.destroy();grant.sockets.delete(socket);grant.sockets.delete(upstream);};
   socket.on('error',close);upstream.on('error',close);socket.on('close',close);upstream.on('close',close);socket.setTimeout(25000,close);upstream.setTimeout(25000,close);
   upstream.on('data',chunk=>{grant.bytes+=chunk.length;if(grant.bytes>300_000_000)close();});
   upstream.once('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});
  }catch{socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
 });
 return {server,grant(token){grants.set(token,{bytes:0,count:0,sockets:new Set()});},revoke(token){const g=grants.get(token);grants.delete(token);for(const s of g?.sockets||[])s.destroy();}};
}
