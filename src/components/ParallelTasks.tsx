import {CheckCircle2,GitMerge,Layers3,LoaderCircle,Square,AlertCircle} from 'lucide-react';
import type {ParallelTask} from '../types';

const labels:Record<string,string>={preparing:'Parallel tayyorlanmoqda',ready:'Qoralama tayyor',reviewing:'Birlashtirish va tekshirish',completed:'Birlashtirildi',needs_repair:'Nazorat modeli davom ettiradi',cancelled:'To‘xtatilgan'};
export function ParallelTasks({tasks,active,onCancel}:{tasks:ParallelTask[];active:boolean;onCancel:(id:string)=>void}){
  if(!tasks.length)return null;
  const done=tasks.filter(t=>t.status==='completed').length,working=tasks.some(t=>t.status==='preparing'),reviewing=tasks.some(t=>t.status==='reviewing'),repairing=tasks.some(t=>t.status==='needs_repair');
  return <section className="parallel-tasks" aria-label="Parallel topshiriqlar">
    <header><Layers3 size={17}/><strong>Parallel jamoa</strong><span>{done}/{tasks.length}</span></header>
    <p className="parallel-team-description">{reviewing?'Nazorat modeli natijalarni birlashtirib, xatolarini tekshiryapti.':working?active?'Asosiy vazifa davom etmoqda. Boshqa modellar qo‘shimcha ishlarni tayyorlayapti.':'Qoralamalar saqlangan. Vazifani davom ettirsangiz, tayyorlash shu joydan boshlanadi.':repairing?'Qo‘shimcha ish yakunlanmagan. Saqlangan natijani nazorat modeli tekshirib, davom ettiradi.':active?'Qoralamalar yakuniy nazoratga tayyor.':'Qo‘shimcha topshiriqlar va birlashtirish natijalari.'}</p>
    <div className="parallel-task-list">{tasks.map(task=><article key={task.id} className={`parallel-task parallel-${task.status}`}>
      <div className="parallel-task-icon">{task.status==='completed'?<CheckCircle2 size={17}/>:task.status==='reviewing'?<GitMerge size={17}/>:task.status==='preparing'&&active?<LoaderCircle size={17} className="spin"/>:task.status==='needs_repair'?<AlertCircle size={17}/>:<Layers3 size={17}/>}</div>
      <div className="parallel-task-content"><div className="parallel-task-status"><strong>{!active&&task.status==='preparing'?'Qoralama saqlangan':labels[task.status]||task.status}</strong>{task.model&&<span>{task.model}</span>}</div><p className="parallel-task-prompt">{task.prompt}</p>
        {!!task.files.length&&<small>{task.files.length} fayl{task.files.some(f=>f.state==='conflict')?' · ziddiyatlar tekshirilmoqda':''}</small>}
        {task.summary&&<details><summary>Natija</summary><p>{task.summary}</p></details>}
        {task.error&&<p className="parallel-task-error">{task.error}</p>}
      </div>{active&&['preparing','ready','needs_repair'].includes(task.status)&&<button className="icon-button" aria-label="Qo‘shimcha vazifani to‘xtatish" title="Faqat shu qo‘shimcha vazifani to‘xtatish" onClick={()=>onCancel(task.id)}><Square size={12}/></button>}
    </article>)}</div>
  </section>;
}
