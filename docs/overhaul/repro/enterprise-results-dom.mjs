// Real React DOM component probe. This is not a browser/layout measurement.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

const [root, probeDirectory] = process.argv.slice(2);
assert.ok(root && probeDirectory, 'Usage: node enterprise-results-dom.mjs WORKTREE TEMP_DIR_WITH_JSDOM');
const { JSDOM } = createRequire(path.resolve(probeDirectory, 'package.json'))('jsdom');
const require = createRequire(path.join(root, 'Front/package.json'));
const { build } = require('esbuild');
const output = path.resolve(probeDirectory, 'enterprise-results.cjs');
await build({ stdin: { contents: `
  import React,{act} from 'react'; import {createRoot} from 'react-dom/client';
  import {createBrowserRouter,RouterProvider} from 'react-router-dom';
  import {AuthProvider} from './src/auth'; import {EnterpriseDetailPage} from './src/pages/EnterpriseDetailPage';
  export {act}; export function mount(){
    let version=0;
    const router=createBrowserRouter([{path:'/enterprise/:id',element:<AuthProvider><EnterpriseDetailPage getNavigationVersion={()=>version}/></AuthProvider>}]);
    let location=router.state.location,pending=router.state.navigation.location;
    router.subscribe(state=>{if(state.location!==location||state.navigation.location!==pending)version++;location=state.location;pending=state.navigation.location;});
    const app=createRoot(document.getElementById('root'));app.render(<RouterProvider router={router}/>);return {router,app};
  }`, resolveDir: path.join(root, 'Front'), loader: 'tsx' }, outfile: output,
  platform: 'node', bundle: true, format: 'cjs', jsx: 'automatic', logLevel: 'silent',
  define: {'import.meta.env':'{}'}, loader:{'.png':'dataurl','.css':'empty'} });
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/enterprise/results',pretendToBeVisual:true});
for(const key of ['window','document','localStorage','sessionStorage','navigator','HTMLElement','Element','Node','Event','CustomEvent','StorageEvent','PopStateEvent','HTMLInputElement','HTMLTextAreaElement','MutationObserver','getComputedStyle'])
  Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
window.scrollTo=()=>{};
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
globalThis.ResizeObserver=class {observe(){}unobserve(){}disconnect(){}};
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const session={accessToken:'e30.'+Buffer.from(JSON.stringify({sub:'owner',sid:'owner-session',tokenVersion:0})).toString('base64url')+'.test',
  tokenType:'Bearer',expiresIn:'15m',user:{id:'owner',username:'owner',email:'owner@example.invalid',role:'USER',level:1,xp:0,rating:0}};
localStorage.setItem('unsolvable-oj-session-v1',JSON.stringify({session,expiresAt:Date.now()+900000}));
const assessment=id=>({id,title:'Result pages',description:'',startsAt:'2026-01-01',endsAt:'2026-01-02',durationMin:30,
  problemIds:['sum'],vibeChallengeIds:[],inviteCode:'fixture',inviteOnly:false,invitees:[],showScoreToCandidates:false,attemptCount:103});
const totals=new Map();
const result=(id,page)=>{const total=totals.get(id)??103;return {test:assessment(id),pagination:{page,limit:50,total,totalPages:Math.ceil(total/50)},summary:{candidates:total,averageScore:total?100:0,perfect:total,pending:0},
  candidates:Array.from({length:Math.max(0,Math.min(50,total-(page-1)*50))},(_,index)=>{const n=(page-1)*50+index+1;return {id:'c'+n,
    user:{id:'c'+n,username:'candidate'+n},startedAt:'2026-01-01',deadlineAt:'2026-01-01T00:30:00Z',finishedAt:'2026-01-01T00:20:00Z',solved:1,score:100,
    problems:[{problemId:'sum',solved:true,submissions:1,submissionId:'s'+n}]};})};};
let releaseSecond;
let failThird=true;
const requests=[];
globalThis.fetch=async(value)=>{
  const url=new URL(value,'http://localhost');
  const match=/\/enterprise\/tests\/([^/]+)(\/results)?$/.exec(url.pathname);
  if(match?.[2]){
    const page=Number(url.searchParams.get('page')??1);requests.push({id:match[1],page});
    if(match[1]==='results'&&page===2&&!releaseSecond)return new Promise(resolve=>{releaseSecond=()=>resolve(Response.json(result(match[1],page)));});
    if(page===3&&failThird){failThird=false;return Response.json({message:'temporary failure'},{status:503});}
    return Response.json(result(match[1],page));
  }
  if(match)return Response.json(assessment(match[1]));
  if(url.pathname.endsWith('/problems/mine'))return Response.json([]);
  if(url.pathname.endsWith('/problems'))return Response.json({items:[],page:1,limit:50,total:0,totalPages:0});
  return Response.json({});
};
const {mount,act}=require(output);
let app,router;
const tick=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
const wait=async(check)=>{for(let i=0;i<100;i++){if(check())return;await tick();}throw new Error('DOM timeout: '+document.body.textContent);};
const rows=()=>document.querySelectorAll('.ent-result-table tbody tr');
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
try{
  await act(async()=>{({app,router}=mount());});
  await wait(()=>rows().length===50);
  assert.equal(rows()[0].querySelector('a').textContent,'candidate1');
  await act(async()=>button('다음 결과').click());
  await wait(()=>releaseSecond);
  assert.equal(rows().length,0);
  assert.equal(document.activeElement.id,'ent-results-title');
  assert.equal(document.querySelector('.ent-results').getAttribute('aria-busy'),'true');
  await act(async()=>releaseSecond());
  await wait(()=>rows().length===50);
  assert.equal(rows()[0].querySelector('a').textContent,'candidate51');
  await act(async()=>button('다음 결과').click());
  await wait(()=>document.querySelector('[role="alert"]'));
  assert.equal(rows().length,0);
  assert.ok(button('첫 페이지로'));
  await act(async()=>button('다시 시도').click());
  await wait(()=>rows().length===3);
  assert.equal(rows()[0].querySelector('a').textContent,'candidate101');
  assert.equal(button('다음 결과').disabled,true);
  await act(async()=>router.navigate('/enterprise/another'));
  await wait(()=>rows().length===50&&rows()[0].querySelector('a').textContent==='candidate1');
  for(const remaining of [1,0]){
    const id='shrunk-'+remaining;
    await act(async()=>router.navigate('/enterprise/'+id));
    await wait(()=>rows().length===50&&rows()[0].querySelector('a').textContent==='candidate1');
    await act(async()=>button('다음 결과').click());
    await wait(()=>rows().length===50&&rows()[0].querySelector('a').textContent==='candidate51');
    totals.set(id,remaining);
    await act(async()=>button('새로고침').click());
    await wait(()=>document.querySelector('.ent-results').textContent.includes('응시자 목록이 변경되어 이 페이지에 표시할 결과가 없어요'));
    assert.equal(rows().length,0);
    assert.ok(!/2\/[01]페이지|0–1명/.test(document.querySelector('.ent-results').textContent));
    assert.ok(document.querySelector('.ent-results').textContent.includes('전체 '+remaining+'명'));
    await act(async()=>button('첫 페이지로').click());
    assert.equal(document.activeElement.id,'ent-results-title');
    if(remaining)await wait(()=>rows().length===1&&rows()[0].querySelector('a').textContent==='candidate1');
    else await wait(()=>document.querySelector('.ent-results').textContent.includes('아직 응시한 사람이 없어요.'));
    assert.equal(button('첫 페이지로'),undefined);
  }
  const report={passed:true,environment:'Actual React DOM in jsdom; native browser/layout metrics not measured',
    checks:['50/50/3 bounded rows','heading focus and busy state during loading','no stale rows relabelled','failed page retry/first-page recovery control','route identity resets page','out-of-range page recovers after shrink to one/zero candidates'],requests};
  await writeFile(path.resolve(probeDirectory,'enterprise-results-dom.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{
  if(app)await act(async()=>app.unmount());router?.dispose();dom.window.close();
}
process.exit(0);
