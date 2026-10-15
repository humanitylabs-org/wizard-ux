export const uid=()=>crypto.randomUUID();
export const clone=x=>structuredClone(x);
export function validateDocument(d){
 if(!d||typeof d.title!=='string'||d.title.length>160||!Array.isArray(d.nodes)||d.nodes.length<1||d.nodes.length>5000||!Array.isArray(d.applied)||d.applied.length>50000)throw new Error('Invalid outline');
 const ids=new Set();for(const n of d.nodes){if(typeof n.id!=='string'||n.id.length>128||ids.has(n.id)||typeof n.text!=='string'||n.text.length>100000||typeof n.folded!=='boolean'||(n.parent!==null&&!ids.has(n.parent)))throw new Error('Invalid bullet tree');ids.add(n.id);}
 const ancestors=[];for(const n of d.nodes){while(ancestors.length&&ancestors.at(-1)!==n.parent)ancestors.pop();if(n.parent!==null&&!ancestors.length)throw new Error('Non-contiguous bullet subtree');ancestors.push(n.id);}
 if(d.applied.some(id=>typeof id!=='string'||id.length>160))throw new Error('Invalid operation journal');
}
export function descendants(d,id){const ids=new Set([id]);for(const n of d.nodes)if(ids.has(n.parent))ids.add(n.id);return ids;}
export function depth(d,n){let v=0;while(n?.parent){v++;n=d.nodes.find(x=>x.id===n.parent);}return v;}
export function visible(d){return d.nodes.filter(n=>{let p=n;while(p.parent){p=d.nodes.find(x=>x.id===p.parent);if(p?.folded)return false;}return true;});}
function indexAfter(d,id){const ids=descendants(d,id);let at=d.nodes.findIndex(n=>n.id===id);while(at+1<d.nodes.length&&ids.has(d.nodes[at+1].id))at++;return at+1;}
export function apply(d,op){
 if(d.applied.includes(op.id))return false;
 const n=d.nodes.find(n=>n.id===op.target);
 if(op.kind==='insert'){
  if(!d.nodes.some(n=>n.id===op.node.id)){const node=clone(op.node);if(node.parent&&!d.nodes.some(n=>n.id===node.parent))node.parent=null;const at=op.after&&d.nodes.some(n=>n.id===op.after)?indexAfter(d,op.after):node.parent?d.nodes.findIndex(n=>n.id===node.parent)+1:d.nodes.length;d.nodes.splice(at,0,node);}
 }else if(op.kind==='text'){
  if(n && (op.before===undefined||n.text===op.before))n.text=op.text;
  else if(n?.text!==op.text){const node={id:'conflict-'+op.id,parent:n?.parent||null,text:op.text,folded:false};if(!d.nodes.some(x=>x.id===node.id))d.nodes.splice(n?indexAfter(d,n.id):d.nodes.length,0,node);}
 }else if(op.kind==='voice'){
  if(n)n.text+=(n.text&&op.text?' ':'')+op.text;
  else if(op.text){const parent=op.parent&&d.nodes.some(n=>n.id===op.parent)?op.parent:null;const at=parent?indexAfter(d,parent):d.nodes.length;d.nodes.splice(at,0,{id:op.target,parent,text:op.text,folded:false});}
 }else if(op.kind==='fold'&&n)n.folded=op.folded;
 else if(op.kind==='move'&&n){
  const ids=descendants(d,n.id);if(!ids.has(op.parent)&&(!op.parent||d.nodes.some(x=>x.id===op.parent))){const group=d.nodes.filter(x=>ids.has(x.id));d.nodes=d.nodes.filter(x=>!ids.has(x.id));n.parent=op.parent;const at=op.before&&d.nodes.some(x=>x.id===op.before)?d.nodes.findIndex(x=>x.id===op.before):op.after&&d.nodes.some(x=>x.id===op.after)?indexAfter(d,op.after):op.parent?d.nodes.findIndex(x=>x.id===op.parent)+1:d.nodes.length;d.nodes.splice(at,0,...group);}
 }else if(op.kind==='delete'&&n){const ids=descendants(d,n.id);d.nodes=d.nodes.filter(x=>!ids.has(x.id));if(!d.nodes.length)d.nodes.push({id:'empty-'+op.id,parent:null,text:'',folded:false});}
 else if(op.kind==='title')d.title=op.text;
 d.applied.push(op.id);return true;
}
export function moveOperation(d,id,direction){
 const n=d.nodes.find(n=>n.id===id);if(!n)return null;
 const siblings=d.nodes.filter(x=>x.parent===n.parent),at=siblings.indexOf(n);
 if(direction>0){if(at===0)return null;const parent=siblings[at-1];const children=d.nodes.filter(x=>x.parent===parent.id);return {kind:'move',target:id,parent:parent.id,after:children.at(-1)?.id||null};}
 if(!n.parent)return null;const p=d.nodes.find(x=>x.id===n.parent);return {kind:'move',target:id,parent:p.parent,after:p.id};
}
export function inverse(d,op){
 const n=d.nodes.find(n=>n.id===op.target);
 if(op.kind==='insert')return {kind:'delete',target:op.node.id};
 if(op.kind==='text'&&n)return {kind:'text',target:n.id,text:n.text,before:op.text};
 if(op.kind==='voice'&&n)return {kind:'text',target:n.id,text:n.text,before:n.text+(n.text&&op.text?' ':'')+op.text};
 if(op.kind==='fold'&&n)return {kind:'fold',target:n.id,folded:n.folded};
 if(op.kind==='move'&&n){const sib=d.nodes.filter(x=>x.parent===n.parent);return {kind:'move',target:n.id,parent:n.parent,after:sib[sib.indexOf(n)-1]?.id||null,before:sib[sib.indexOf(n)+1]?.id||null};}
 if(op.kind==='title')return {kind:'title',text:d.title};
 return null;
}
export function markdown(d){return '# '+d.title+'\n\n'+d.nodes.map(n=>'  '.repeat(depth(d,n))+'- '+n.text.replaceAll('\n','\n'+'  '.repeat(depth(d,n)+1))).join('\n');}
// Speech lives outside editable text until a final. Each event has an immutable ID and target.
export class SpeechLedger {
 constructor(drafts={}){this.items=drafts;}
 begin(id,target,seq){return this.items[id]={id,target,seq,text:'',status:'draft'};}
 event(e){let s=this.items[e.id];if(!s)s=this.items[e.id]={id:e.id,target:e.target,seq:e.seq,text:'',status:'draft'};if(s.status==='final')return null;s.text=e.text;s.status=e.type==='final'?'final':'draft';return s;}
 detach(target,newId){for(const s of Object.values(this.items))if(s.target===target&&s.status!=='final')s.target=newId;}
}
