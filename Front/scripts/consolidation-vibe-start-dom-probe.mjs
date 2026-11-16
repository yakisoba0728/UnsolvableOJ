import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const [sourceRoot, jsdomDirectory, reportName = 'vibe-start-dom.json'] = process.argv.slice(2);
if (!sourceRoot || !jsdomDirectory || path.basename(reportName) !== reportName)
  throw new Error('usage: node consolidation-vibe-start-dom-probe.mjs WORKTREE JSDOM_DIRECTORY [REPORT_BASENAME]');
const root = path.resolve(sourceRoot);
const probeRoot = path.resolve(jsdomDirectory);
const reportFile = path.join(probeRoot, reportName);
const require = createRequire(path.join(root, 'Front/package.json'));
const probeRequire = createRequire(path.join(probeRoot, 'package.json'));
const { JSDOM } = probeRequire('jsdom');
const { build } = require('esbuild');
const bundle = path.join(probeRoot, `vibe-${reportName}.cjs`);
await build({ stdin: { contents: `
  import { act } from 'react';
  import { createRoot } from 'react-dom/client';
  import { createMemoryRouter, RouterProvider } from 'react-router-dom';
  import { AuthProvider } from './src/auth';
  import { App } from './src/App';
  export { act };
  export function mount() {
    let version = 0;
    const router = createMemoryRouter([{ path: '*', element: <AuthProvider><App getNavigationVersion={() => version}/></AuthProvider> }], { initialEntries: ['/vibe'] });
    let location = router.state.location;
    router.subscribe(state => { if (state.location !== location) version++; location = state.location; });
    const app = createRoot(document.getElementById('root'));
    app.render(<RouterProvider router={router}/>);
    return { app, router };
  }
`, resolveDir: path.join(root, 'Front'), loader: 'tsx' }, outfile: bundle,
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', logLevel: 'silent',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty', '.png': 'dataurl' } });

const storageKey = 'unsolvable-oj-session-v1';
const token = (generation, sid = 'login-one', sub = 'solver') =>
  `e30.${Buffer.from(JSON.stringify({sub, sid, tokenVersion:0, generation})).toString('base64url')}.test`;
const session = {accessToken:token(1), refreshToken:'disposable-refresh', expiresIn:'15m', tokenType:'Bearer',
  refreshTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),
  user:{id:'solver',username:'solver',role:'USER',level:1,xp:0,rating:0}};
const fresh = {...session,accessToken:token(2),refreshToken:'disposable-rotated'};
const report = {source:{head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  diff:execFileSync('git',['diff','--','Front/src/App.tsx','Front/src/pages/VibePage.tsx'],{cwd:root,encoding:'utf8'}).trim()},
  node:process.version,jsdom:probeRequire('jsdom/package.json').version,browser:false,
  limitations:'Actual App/AuthProvider/Vibe page with controlled synthetic fetch and popup object. Tests post-await ownership only; not a browser, server authorization or exploit proof.',cases:[]};
for (const mode of ['normal','refresh','account','login','logout','navigate']) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/vibe',pretendToBeVisual:true});
  const win=dom.window;
  for(const key of ['window','document','localStorage','sessionStorage','navigator','HTMLElement','Element','Node','Event','CustomEvent','KeyboardEvent','StorageEvent','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','getComputedStyle'])
    Object.defineProperty(globalThis,key,{value:win[key],configurable:true,writable:true});
  globalThis.requestAnimationFrame=win.requestAnimationFrame.bind(win);
  globalThis.cancelAnimationFrame=win.cancelAnimationFrame.bind(win);
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  win.scrollTo=()=>{};win.HTMLElement.prototype.scrollIntoView=()=>{};
  globalThis.ResizeObserver=class {observe(){}disconnect(){}};
  localStorage.setItem(storageKey,JSON.stringify({session,expiresAt:Date.now()+900000}));
  const destinations=[];
  const popup={closed:false,opener:{},location:{},close(){this.closed=true;}};
  Object.defineProperty(popup.location,'href',{set(value){destinations.push(value);}});
  win.open=()=>popup;
  let release,writes=0,refreshes=0,mounted;
  globalThis.fetch=async(url,options={})=>{
    const pathname=new URL(url,'http://localhost').pathname;
    if(pathname==='/api/v1/notifications/unread-count')return Response.json({unread:0});
    if(pathname==='/api/v1/vibe/challenges')return Response.json({items:[{id:'c1',title:'Fixture challenge',stack:'TypeScript',difficulty:'Easy',durationMin:5,summary:'Synthetic',requirements:[],rubric:[]}],availability:{ai:true,runner:true}});
    if(pathname==='/api/v1/vibe/attempts')return Response.json([]);
    if(pathname==='/api/v1/auth/refresh'){refreshes++;return Response.json(fresh);}
    if(pathname==='/api/v1/vibe/challenges/c1/attempts'){
      writes++;
      if(mode==='refresh'&&options.headers.Authorization===`Bearer ${session.accessToken}`)return Response.json({message:'Expired'},{status:401});
      return new Promise(resolve=>{release=()=>{release=undefined;resolve(Response.json({id:'old-login-attempt'}));};});
    }
    return Response.json({message:'Unexpected fixture request'},{status:404});
  };
  delete require.cache[bundle];
  const {mount,act}=require(bundle);
  const tick=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
  const wait=async predicate=>{for(let n=0;n<200;n++){if(predicate())return;await tick();}throw new Error('Bounded fixture did not settle');};
  const observed={};
  try {
    await act(async()=>{mounted=mount();});
    await wait(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('연습 시작 / 이어하기')));
    await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.includes('연습 시작 / 이어하기')).click();});
    await wait(()=>release);
    if(['account','login','logout'].includes(mode))await act(async()=>{
      const oldValue=localStorage.getItem(storageKey);
      const next=mode==='account'?{...fresh,accessToken:token(2,'other','second'),user:{...session.user,id:'second',username:'second'}}:{...fresh,accessToken:token(2,'new-login')};
      const newValue=mode==='logout'?null:JSON.stringify({session:next,expiresAt:Date.now()+900000});
      if(newValue===null)localStorage.removeItem(storageKey);else localStorage.setItem(storageKey,newValue);
      win.dispatchEvent(new win.StorageEvent('storage',{key:storageKey,oldValue,newValue,storageArea:localStorage}));
    });
    if(mode==='navigate')await act(async()=>{await mounted.router.navigate('/auth');});
    await act(async()=>release());
    for(let i=0;i<8;i++)await tick();
    Object.assign(observed,{destinations,closed:popup.closed,writes,refreshes,path:mounted.router.state.location.pathname});
    if(['normal','refresh'].includes(mode)){
      assert.deepEqual(destinations,['http://localhost/vibe/attempts/old-login-attempt']);
      assert.equal(popup.closed,false);
      assert.equal(writes,mode==='refresh'?2:1);
    }else{
      assert.deepEqual(destinations,[],'stale login or route must not receive the old completion navigation');
      assert.equal(popup.closed,true,'stale owned blank tab must be closed');
    }
    report.cases.push({name:mode,passed:true,observed});
  }catch(error){report.cases.push({name:mode,passed:false,observed,error:String(error)});}
  finally{release?.();if(mounted){await act(async()=>mounted.app.unmount());mounted.router.dispose();}win.close();}
}
await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
process.exit(report.cases.every(c=>c.passed)?0:1);
