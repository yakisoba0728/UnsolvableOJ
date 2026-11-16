import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const [root, probeDirectory] = process.argv.slice(2);
if (!root || !probeDirectory) throw new Error('usage: node learning-dom-probe.mjs WORKTREE TEMP_PROBE_DIRECTORY');
const require=createRequire(root+'/Front/package.json');
const {JSDOM}=createRequire(path.resolve(probeDirectory, 'package.json'))('jsdom');
const {build}=require('esbuild');
const output=path.resolve(probeDirectory, 'learning.cjs');
await build({stdin:{contents:`import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {createBrowserRouter,RouterProvider} from 'react-router-dom';import {AuthProvider} from './src/auth';import {App} from './src/App';export {act};export function mount(){let n=0;const router=createBrowserRouter([{path:'*',element:<AuthProvider><App getNavigationVersion={()=>n}/></AuthProvider>}]);router.subscribe(()=>n++);const app=createRoot(document.getElementById('root'));app.render(<RouterProvider router={router}/>);return {router,app};}`,resolveDir:root+'/Front',loader:'tsx'},outfile:output,platform:'node',bundle:true,format:'cjs',jsx:'automatic',logLevel:'silent',define:{'import.meta.env':'{}'},loader:{'.png':'dataurl','.css':'empty'}});
const original={accessToken:'first-token',tokenType:'Bearer',expiresIn:'15m',user:{id:'first',username:'first',email:'first@example.com',role:'USER',level:1,xp:0,rating:0}};
const fixture=(days=30,n=12)=>({days,timeZone:'Asia/Seoul',generatedAt:'2026-11-16T03:00:00Z',summary:{submissions:n,acceptedSubmissions:3,solvedProblems:2,attemptedProblems:5,activeDays:4},activity:Array.from({length:days},(_,i)=>({date:new Date(Date.UTC(2026,10,17-days+i)).toISOString().slice(0,10),submissions:i===days-1?n:0,acceptedSubmissions:i===days-1?3:0})),difficulties:[{difficulty:'EASY',attempted:5,solved:2}],tags:[{tag:'graph & DP',attempted:5,solved:2}],tagsTruncated:false,review:[{id:'p1',slug:'retry',title:'first-private-title',difficulty:'EASY',lastSubmittedAt:'2026-11-15T16:10:00Z',lastStatus:'WRONG_ANSWER',bookmarked:true}]});
const report={source:'working tree',node:process.version,dom:'jsdom 31.0.1',browser:false,scenarios:[]};
for(const scenario of ['render-contract','late-period','account-clear','late-account','failure-retry']){
 const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/learning',pretendToBeVisual:true});const win=dom.window;
 for(const key of ['window','document','localStorage','sessionStorage','navigator','HTMLElement','Element','Node','Event','CustomEvent','StorageEvent','PopStateEvent','HTMLInputElement','HTMLTextAreaElement','MutationObserver','getComputedStyle'])Object.defineProperty(globalThis,key,{value:win[key],configurable:true,writable:true});
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;win.scrollTo=()=>{};win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});globalThis.matchMedia=win.matchMedia;globalThis.requestAnimationFrame=win.requestAnimationFrame.bind(win);globalThis.cancelAnimationFrame=win.cancelAnimationFrame.bind(win);globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 localStorage.setItem('unsolvable-oj-session-v1',JSON.stringify({session:original,expiresAt:Date.now()+900000}));
 const requests=[];let release=null,failed=false;
 globalThis.fetch=async(url,options={})=>{const u=new URL(url,'http://localhost');requests.push(u.pathname);if(u.pathname==='/api/v1/notifications/unread-count')return Response.json({unread:0});if(u.pathname!='/api/v1/users/me/learning')return Response.json({message:'unhandled'},{status:404});const days=Number(u.searchParams.get('days'));const second=new Headers(options.headers).get('authorization')==='Bearer second-token';
  if(scenario==='late-period'&&days===30 || scenario==='late-account'&&!second || scenario==='account-clear'&&second)return new Promise(resolve=>{release=(body)=>resolve(Response.json(body));});
  if(scenario==='failure-retry'&&!failed){failed=true;return Response.json({message:'deliberate unavailable'},{status:503});}
  const data=fixture(days,days===7?7:12);if(second)data.review=[];return Response.json(data);};
 delete require.cache[output];const {mount,act}=require(output);let app,router;
 const tick=()=>act(async()=>{await new Promise(r=>setTimeout(r,0));});
 const wait=async(fn,label)=>{for(let i=0;i<100;i++){if(fn())return;await tick();}throw new Error(label+': '+document.body.textContent);};
 const account=()=>{const key='unsolvable-oj-session-v1',oldValue=localStorage.getItem(key),newValue=JSON.stringify({session:{...original,accessToken:'second-token',user:{...original.user,id:'second',username:'second'}},expiresAt:Date.now()+900000});localStorage.setItem(key,newValue);window.dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue,storageArea:localStorage}));};
 try{await act(async()=>{({app,router}=mount());});
  if(scenario==='late-period'){await wait(()=>release,'request');await act(async()=>{Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='최근 7일').click();});await wait(()=>document.querySelector('dd')?.textContent==='7건','7 day stats');await act(async()=>release(fixture()));for(let i=0;i<3;i++)await tick();assert.equal(document.querySelector('dd').textContent,'7건');}
  else if(scenario==='late-account'){await wait(()=>release,'request');await act(async()=>account());await wait(()=>document.querySelector('dd'),'second stats');await act(async()=>release(fixture()));for(let i=0;i<3;i++)await tick();assert(!document.body.textContent.includes('first-private-title'));}
  else if(scenario==='account-clear'){await wait(()=>document.body.textContent.includes('first-private-title'),'initial data');await act(async()=>account());await wait(()=>release,'second request');assert(!document.body.textContent.includes('first-private-title'));assert.equal(document.querySelectorAll('dd').length,0);await act(async()=>release({...fixture(),review:[]}));}
  else if(scenario==='failure-retry'){await wait(()=>document.querySelector('[role="alert"]'),'error');assert.equal(document.querySelectorAll('dd').length,0);await act(async()=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='다시 시도').click());await wait(()=>document.querySelector('dd'),'retried');assert.equal(document.querySelector('dd').textContent,'12건');}
  else{await wait(()=>document.querySelector('dd'),'stats');assert.equal(document.querySelector('dd').textContent,'12건');assert.equal(document.querySelectorAll('tbody tr').length,30);assert.equal(document.querySelector('meter').getAttribute('aria-valuetext'),'5문제 시도, 2문제 해결');assert.equal(requests.filter(p=>p==='/api/v1/users/me/learning').length,1);assert(!requests.includes('/api/v1/submissions'));}
  report.scenarios.push({name:scenario,passed:true});
 }catch(error){report.scenarios.push({name:scenario,passed:false,error:String(error)});}finally{if(app)await act(async()=>app.unmount());router?.dispose();dom.window.close();}
}
console.log(JSON.stringify(report,null,2));await fs.writeFile(path.resolve(probeDirectory, 'learning-results.json'),JSON.stringify(report,null,2)+'\n');process.exit(report.scenarios.every(s=>s.passed)?0:1);
