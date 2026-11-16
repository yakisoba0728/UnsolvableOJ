import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const [root, probeDirectory, label] = process.argv.slice(2);
if (!root || !probeDirectory || !label || !/^[a-z0-9_-]+$/i.test(label)) {
  throw new Error('usage: node enterprise-form-refresh.mjs WORKTREE TEMP_PROBE_DIR LABEL');
}
const { JSDOM } = createRequire(path.resolve(probeDirectory, 'package.json'))('jsdom');
const require = createRequire(path.join(root, 'Front/package.json'));
const { build } = require('esbuild');
const output = path.resolve(probeDirectory, `${label}.cjs`);
const entry = `
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter,RouterProvider} from 'react-router-dom';
import {AuthProvider} from './src/auth';
import {App} from './src/App';
export {act};
export function mount(){
 let version=0;
 const router=createBrowserRouter([{path:'*',element:<AuthProvider><App getNavigationVersion={()=>version}/></AuthProvider>}]);
 let location=router.state.location, pending=router.state.navigation.location;
 router.subscribe(state=>{if(state.location!==location || state.navigation.location!==pending) version++;location=state.location;pending=state.navigation.location;});
 const app=createRoot(document.getElementById('root'));app.render(<RouterProvider router={router}/>);
 return {router,app};
}`;
await build({ stdin: { contents: entry, resolveDir: path.join(root, 'Front'), loader: 'tsx' }, outfile: output,
  platform: 'node', bundle: true, format: 'cjs', jsx: 'automatic', logLevel: 'silent',
  define: {'import.meta.env': '{}'}, loader: {'.png': 'dataurl', '.css':'empty'} });

const token = generation => 'e30.'+Buffer.from(JSON.stringify({sub:'first',sid:'same-login',tokenVersion:0,generation})).toString('base64url')+'.test';
const session = {accessToken:token(1),tokenType:'Bearer',expiresIn:'15m',user:{id:'first',username:'first',email:'first@example.com',role:'USER',level:1,xp:0,rating:0}};
const iso = offset => new Date(Date.now()+offset).toISOString();
const exam = {id:'t1',title:'Private first exam',description:'',startsAt:iso(86400000),endsAt:iso(172800000),durationMin:60,problemIds:[],inviteCode:'abc',inviteOnly:false,invitees:[],showScoreToCandidates:false,attemptCount:0,createdAt:iso(0),updatedAt:iso(0)};
const attempt = {id:'a1',startedAt:iso(-60000),deadlineAt:iso(1740000),finishedAt:null,test:{title:'Join test',description:'',startsAt:iso(-60000),endsAt:iso(3600000),durationMin:30,problemCount:0},problems:[],result:null};
const report = {label,root,node:process.version,dom:'jsdom 31.0.1',scenarios:[]};

for (const scenario of ['edit-draft-refresh']) {
 const url = '/enterprise/t1/edit';
 const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost'+url,pretendToBeVisual:true});
 const win=dom.window;
 for(const key of ['window','document','localStorage','sessionStorage','navigator','HTMLElement','Element','Node','Event','CustomEvent','StorageEvent','PopStateEvent','HTMLInputElement','HTMLTextAreaElement','MutationObserver','getComputedStyle']) {
  Object.defineProperty(globalThis,key,{value:win[key],configurable:true,writable:true});
 }
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 win.scrollTo=()=>{};
 win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
 globalThis.matchMedia=win.matchMedia;
 globalThis.requestAnimationFrame=win.requestAnimationFrame.bind(win);
 globalThis.cancelAnimationFrame=win.cancelAnimationFrame.bind(win);
 globalThis.ResizeObserver=class {observe(){}unobserve(){}disconnect(){}};
 win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 win.HTMLDialogElement.prototype.close=function(){this.open=false;};
 localStorage.setItem('unsolvable-oj-session-v1',JSON.stringify({session,expiresAt:Date.now()+900000}));
 let resolveMutation,mutations=0,readCount=0;
 globalThis.fetch = async (url,options={}) => {
  const p=new URL(url,'http://localhost').pathname;
  if (options.method==='DELETE' || p.endsWith('/start')) {mutations++; return new Promise(resolve=>{resolveMutation=()=>resolve(Response.json(p.endsWith('/start')?attempt:{id:'t1'}));});}
  let data;
  if(p==='/api/v1/enterprise/tests/t1') {if(++readCount>1) return new Promise(resolve=>{resolveMutation=()=>resolve(Response.json(exam));}); data=exam;}
  else if(p==='/api/v1/enterprise/tests') data=[];
  else if(p==='/api/v1/enterprise/join/abc') data={test:attempt.test,isOwner:false,attempt:null};
  else if(p==='/api/v1/enterprise/attempts/a1') data=attempt;
  else if(p==='/api/v1/notifications/unread-count') data={unread:0};
  else if(p==='/api/v1/problems/mine') data=[];
  else if(p==='/api/v1/problems') data={items:[],page:1,total:0,totalPages:0,limit:20};
  else if(p==='/api/v1/email/preferences') data={verified:false,enabled:false};
  else return Response.json({message:'unhandled '+p},{status:404});
  return Response.json(data);
 };
 // The bundle must load after a document exists, just as React DOM initializes in a browser.
 delete require.cache[output];
 const {mount,act}=require(output);
 let app,router;
 const tick=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});};
 const wait=async(check,description)=>{for(let n=0;n<100;n++){if(check())return;await tick();}throw new Error(description+' timed out: '+document.body.textContent);};
 const button=(text,inDialog=false)=>Array.from(document.querySelectorAll(inDialog?'dialog button':'button')).find(x=>x.textContent.trim()===text);
 try {
  await act(async()=>{({app,router}=mount());});
  await wait(()=>document.getElementById('ent-title'),'initial edit form');
  await act(async()=>{
   const input=document.getElementById('ent-title');
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'unsaved title');
   input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  const before=document.getElementById('ent-title').value;
  await act(async()=>{
   const key='unsolvable-oj-session-v1',oldValue=localStorage.getItem(key),newValue=JSON.stringify({session:{...session,accessToken:token(2)},expiresAt:Date.now()+900000});
   localStorage.setItem(key,newValue);window.dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue,storageArea:localStorage}));
  });
  await wait(()=>resolveMutation,'token refresh reload');
  const pending=document.getElementById('ent-title')?.value??null;
  await act(async()=>resolveMutation());
  for(let n=0;n<4;n++) await tick();
  const after=document.getElementById('ent-title')?.value??null;
  report.scenarios.push({name:scenario,before,pending,after,passed:before==='unsaved title' && pending===before && after===before});
 } finally {
  if(app) await act(async()=>app.unmount());
  router?.dispose();
  dom.window.close();
 }
}
console.log(JSON.stringify(report,null,2));
await fs.writeFile(path.resolve(probeDirectory,`${label}.json`),JSON.stringify(report,null,2)+'\n');
// Auth schedules timer work against the Node host in this DOM substitute; stop
// this dedicated probe after results and unmount cleanup are flushed.
process.exit(report.scenarios.every(result => result.passed) ? 0 : 1);
