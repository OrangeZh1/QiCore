import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as vue from 'vue';
const settle=async()=>{for(let i=0;i<8;i++){await Promise.resolve();await vue.nextTick()}};
async function fixture(){
 const source=await readFile(new URL('../app/utils/async-component.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};
 const State=vue.defineComponent({props:['label','failed'],setup:p=>()=>vue.h('state',{label:p.label,failed:p.failed})});
 // Use a real Vue renderer with a minimal host; no browser or network is needed.
 const node=(type,text='')=>({type,text,children:[],props:{},parent:null});
 const renderer=vue.createRenderer({createElement:node,createText:t=>node('text',t),createComment:t=>node('comment',t),setText:(n,t)=>n.text=t,setElementText:(n,t)=>n.text=t,patchProp:(n,k,_old,v)=>n.props[k]=v,parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]||null,
  insert(n,p,anchor){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=p;const i=p.children.indexOf(anchor);p.children.splice(i<0?p.children.length:i,0,n)},remove(n){n.parent?.children.splice(n.parent.children.indexOf(n),1);n.parent=null}});
 new Function('require','exports',code)(name=>name==='vue'?vue:{default:State},exports);
 const pending=[],model=vue.ref('draft'),root=node('root');
 const Async=exports.defineConsoleAsyncComponent(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),'验收面板');
 const app=renderer.createApp({render:()=>vue.h(Async,{modelValue:model.value,'onUpdate:modelValue':value=>model.value=value},{default:()=>vue.h('slot','retained')})});app.config.errorHandler=()=>{};
 return{root,pending,model,app,Async,renderer,body:vue.defineComponent({props:['modelValue'],emits:['update:modelValue'],setup:(props,{emit,slots})=>()=>vue.h('body',{value:props.modelValue,onEdit:()=>emit('update:modelValue','edited')},slots.default?.())})};
}

test('lazy component starts on render and forwards models and slots',async t=>{
 const c=await fixture();t.after(()=>c.app.unmount());assert.equal(c.pending.length,0);c.app.mount(c.root);assert.equal(c.pending.length,1);
 c.pending[0].resolve({__esModule:true,default:c.body});await settle();assert.equal(c.root.children[0].props.value,'draft');assert.equal(c.root.children[0].children[0].type,'slot');
 c.root.children[0].props.onEdit();await settle();assert.equal(c.model.value,'edited');assert.equal(c.root.children[0].props.value,'edited');c.app.unmount();
});

test('a failed chunk reports an error while the owning form retains its draft',async t=>{
 const c=await fixture();t.after(()=>c.app.unmount());c.app.mount(c.root);c.pending[0].reject(Error('network'));await settle();assert.equal(c.root.children[0].type,'state');assert.equal(c.root.children[0].props.failed,true);assert.equal(c.model.value,'draft');
});

test('closing a pending component prevents its late completion from mounting into the page',async()=>{
 const c=await fixture();c.app.mount(c.root);c.app.unmount();c.pending[0].resolve({__esModule:true,default:c.body});await settle();assert.equal(c.root.children.length,0);assert.equal(c.model.value,'draft');
});
