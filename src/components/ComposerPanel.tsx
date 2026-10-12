import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Minus,Plus,RotateCcw} from 'lucide-react';

export function ComposerPanel({userId,settings,children}:{userId:string;settings:ReactNode;children:ReactNode}){
 const key='opensi.composer-panel-height.'+userId;
 const panel=useRef<HTMLDivElement>(null),gesture=useRef<{id:number;y:number;height:number}|null>(null);
 const [height,setHeight]=useState(()=>{try{const n=Number(localStorage.getItem(key));return n>=170&&n<=900?n:320;}catch{return 320;}});
 const [minimum,setMinimum]=useState(190),[limit,setLimit]=useState(600),[dragging,setDragging]=useState(false);
 const visible=Math.max(minimum,Math.min(height,limit));
 useEffect(()=>{
  const parent=panel.current?.parentElement;if(!parent)return;
  const measure=()=>{const min=window.innerWidth<=700?240:190;setMinimum(min);const h=Math.min(parent.clientHeight,window.visualViewport?.height||window.innerHeight);if(h>0)setLimit(Math.max(min,Math.floor(h*.72)));};
  const observer=new ResizeObserver(measure);observer.observe(parent);window.visualViewport?.addEventListener('resize',measure);measure();
  return()=>{observer.disconnect();window.visualViewport?.removeEventListener('resize',measure);};
 },[]);
 function resize(value:number){const n=Math.round(Math.max(minimum,Math.min(limit,value)));setHeight(n);try{localStorage.setItem(key,String(n));}catch{/* Optional preference storage. */}}
 function stop(){gesture.current=null;setDragging(false);}
 return <div ref={panel} className={`conversation-footer composer-panel ${dragging?'composer-panel-resizing':''} ${visible<280?'composer-panel-small':''}`} style={{height:visible}}>
  <div className="composer-panel-bar">
   <div className="composer-panel-handle" role="separator" tabIndex={0} aria-label="Yozish paneli balandligi" aria-orientation="horizontal" aria-valuemin={minimum} aria-valuemax={limit} aria-valuenow={visible} title="Yuqoriga torting — kattalashadi; pastga — kichrayadi. ↑ ↓ bilan ham boshqariladi."
    onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);gesture.current={id:e.pointerId,y:e.clientY,height:visible};setDragging(true);}}
    onPointerMove={e=>{const g=gesture.current;if(g?.id===e.pointerId)resize(g.height+g.y-e.clientY);}}
    onPointerUp={e=>{if(gesture.current?.id===e.pointerId){stop();e.currentTarget.releasePointerCapture(e.pointerId);}}}
    onPointerCancel={stop} onLostPointerCapture={stop} onDoubleClick={()=>resize(320)}
    onKeyDown={e=>{const n=e.key==='ArrowUp'?visible+32:e.key==='ArrowDown'?visible-32:e.key==='Home'?minimum:e.key==='End'?limit:e.key==='Enter'?320:null;if(n!==null){e.preventDefault();resize(n);}}}><span/><small>Panel o‘lchami</small></div>
   <button className="icon-button" aria-label="Yozish panelini kichraytirish" title="Kichraytirish" disabled={visible<=minimum} onClick={()=>resize(visible-48)}><Minus size={16}/></button>
   <button className="icon-button" aria-label="Yozish panelini kattalashtirish" title="Kattalashtirish" disabled={visible>=limit} onClick={()=>resize(visible+48)}><Plus size={16}/></button>
   <button className="icon-button" aria-label="Yozish paneli o‘lchamini tiklash" title="O‘lchamni tiklash" onClick={()=>resize(320)}><RotateCcw size={15}/></button>
  </div>
  <div className="composer-panel-content"><details className="composer-panel-settings"><summary>Agent rejimi va saqlash</summary>{settings}</details>{children}</div>
 </div>;
}
