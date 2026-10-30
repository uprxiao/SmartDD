// P-only unmodified real engine/result gates. Never loaded by product routes.
import mermaid from 'mermaid';
export function install(){
 const initialize=mermaid.initialize,render=mermaid.render,s={initialize,render,configs:[],rows:[],slots:[],hold:false};globalThis.__diagramP=s;
 mermaid.initialize=function(config){s.configs.push(structuredClone(config));return initialize.apply(this,arguments);};
 mermaid.render=async function(id,source,...args){const row={id,source,before:JSON.stringify([id,source,args]),at:Date.now()};s.rows.push(row);try{const result=await render.call(this,id,source,...args);row.originalSvg=result.svg;row.originalReturned=Date.now();if(s.hold){s.hold=false;const slot={row:s.rows.indexOf(row),waiting:true};s.slots.push(slot);await new Promise(done=>slot.release=done);slot.waiting=false;}row.after=JSON.stringify([id,source,args]);row.deliveredSvg=result.svg;row.delivered=Date.now();return result;}catch(error){row.error=String(error);throw error;}};
 return true;
}
export function restore(){const s=globalThis.__diagramP;s.slots.forEach(x=>x.release?.());mermaid.initialize=s.initialize;mermaid.render=s.render;const restored=mermaid.initialize===s.initialize&&mermaid.render===s.render;delete globalThis.__diagramP;return restored;}
