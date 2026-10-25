import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import App from '../../src/App';
import { WORKSPACE_KEY } from '../../src/lib/workspace';
import type { Workspace, RoomLayout } from '../../src/lib/workspace';
import { MODEL_JOBS_KEY } from '../../src/lib/model-jobs';
import type { Point } from '../../src/lib/room-scan';
import fixture from '../fixtures/room-scan.json';
import '../../src/styles.css';

// Test-only interaction driver; this entry point never ships as the app shell.
const SNAPSHOT_KEY = 'furniture-ar:test:room-scan-workflow:snapshot';
const storageKeys = [WORKSPACE_KEY, MODEL_JOBS_KEY];
const report = document.querySelector<HTMLPreElement>('#scan-workflow-report')!;
const run = document.querySelector<HTMLButtonElement>('#run-scan-checks')!;
const restore = document.querySelector<HTMLButtonElement>('#restore-scan-workspace')!;
const app = document.querySelector<HTMLDivElement>('#root')!;
let root: Root | null = null;
let running = false;
let blockedRequests = 0;
let messages: string[] = [];
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.pathname.startsWith('/api/') || url.origin !== location.origin) {
    blockedRequests++;
    return new Response(JSON.stringify({error:{code:'FIXTURE_BLOCKED',message:'Room scan QA blocks API requests.'}}),{status:409,headers:{'Content-Type':'application/json'}});
  }
  return realFetch(input, init);
};
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function pass(message: string) { messages.push(`PASS ${message}`); report.textContent = messages.join('\n'); }
const pause = (ms=25) => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition:()=>unknown, message:string) {
  const start=performance.now();
  while(!condition()) { if(performance.now()-start>10_000)throw new Error(`Timed out: ${message}`);await pause(); }
}
function workspace(): Workspace { return JSON.parse(localStorage.getItem(WORKSPACE_KEY)||'{"layouts":[],"items":[]}'); }
function room(id:string):RoomLayout { const value=workspace().layouts.find(layout=>layout.id===id);check(value,`Missing saved layout ${id}`);return value; }
function button(name:string):HTMLButtonElement {
  const candidates=[...app.querySelectorAll<HTMLButtonElement>('button')];
  const found=candidates.find(element=>[element.getAttribute('aria-label'),element.title,element.querySelector('strong')?.textContent?.trim(),element.textContent?.trim()].includes(name));
  check(found,`Missing button: ${name}`);check(!found.disabled,`Disabled button: ${name}`);return found;
}
async function click(name:string) { button(name).click();await pause(); }
function showing(name:string) { return app.querySelector<HTMLInputElement>('input[aria-label="Layout name"]')?.value===name; }
async function editor(name:string) { await until(()=>showing(name)&&!!app.querySelector('.room-editor'),`regular editor for ${name}`); }
function scan(name:string) {
  const angle=32*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const rotate=(p:Point)=>({x:p.x*c-p.z*s,z:p.x*s+p.z*c});
  return {...structuredClone(fixture),name,
    walls:fixture.walls.map(wall=>({...wall,start:rotate(wall.start),end:rotate(wall.end)})),
    openings:fixture.openings.map(opening=>({...opening,start:rotate(opening.start),end:rotate(opening.end)})),
    obstacles:fixture.obstacles.map(object=>({...object,...rotate(object),rotation:object.rotation+32})),
  };
}
async function upload(text:string) {
  const input=app.querySelector<HTMLInputElement>('input[aria-label="Choose room scan file"]');check(input,'Missing scan file input');
  const transfer=new DataTransfer();transfer.items.add(new File([text],'room-scan-qa.json',{type:'application/json'}));
  input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await pause();
}
function outline() { const element=app.querySelector<SVGGElement>('[data-outline-id="sofa"]');check(element,'Missing scanned outline in normal floor plan');return element; }
function key(value:string) { const element=outline();element.focus();element.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true})); }
function sameObject(a:RoomLayout,b:RoomLayout) { return JSON.stringify(a.survey?.obstacles[0])===JSON.stringify(b.survey?.obstacles[0]); }
function mount() { root?.unmount();root=createRoot(app);root.render(<StrictMode><App/></StrictMode>); }
function saveOriginal() {
  if(!sessionStorage.getItem(SNAPSHOT_KEY))sessionStorage.setItem(SNAPSHOT_KEY,JSON.stringify(Object.fromEntries(storageKeys.map(key=>[key,localStorage.getItem(key)]))));
}
function clearFixture() {
  root?.unmount();root=null;
  const snapshot=sessionStorage.getItem(SNAPSHOT_KEY);
  if(snapshot){for(const [key,value] of Object.entries(JSON.parse(snapshot) as Record<string,string|null>)){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}sessionStorage.removeItem(SNAPSHOT_KEY);}
  history.replaceState(null,'',location.pathname);
  report.dataset.status='idle';report.textContent='Original workspace restored. Fixture app unmounted.';run.disabled=false;
}
restore.addEventListener('click',()=>{if(!running)clearFixture();});
run.addEventListener('click',async()=>{
  if(running)return;running=true;run.disabled=true;restore.disabled=true;messages=[];blockedRequests=0;report.dataset.status='running';report.textContent='Running production workflow checks…';
  try {
    root?.unmount();root=null;saveOriginal();localStorage.setItem(WORKSPACE_KEY,JSON.stringify({layouts:[],items:[]}));localStorage.removeItem(MODEL_JOBS_KEY);
    history.replaceState(null,'',location.pathname);mount();await until(()=>app.querySelector('.start-grid'),'app overview');
    await click('New layout');await click('Scan your room');await click('Upload a room scan');
    await upload('{invalid json');await until(()=>app.querySelector('[role="alert"]'),'invalid file error');
    check(workspace().layouts.length===0,'Invalid file created a layout');check(app.querySelector('dialog[open][aria-label="Room scan"]'),'Invalid file closed scan options');pass('Invalid room file stays in scan options without creating a layout.');
    const firstScan=scan('QA scanned room');await upload(JSON.stringify(firstScan));await editor(firstScan.name);await until(()=>workspace().layouts.length===1,'first scan saved');
    const first=workspace().layouts[0];check(!app.querySelector('dialog[open]'),'Successful import left a separate scan editor open');
    check(Math.abs(first.width-5)<1e-8&&Math.abs(first.depth-4)<1e-8,'Rotated room bounds were not aligned');
    check(first.survey?.walls.every(wall=>Math.abs(wall.end.x-wall.start.x)<1e-8||Math.abs(wall.end.z-wall.start.z)<1e-8),'Walls do not align with editor axes');
    pass('A valid 32° scan opens the standard editor immediately, aligns to 5 × 4 m, and autosaves.');
    key('ArrowRight');await until(()=>Math.abs(room(first.id).survey!.obstacles[0].x-first.survey!.obstacles[0].x-.05)<1e-8,'outline arrow move');const moved=room(first.id);
    key('r');await until(()=>Math.abs(room(first.id).survey!.obstacles[0].rotation-15)<1e-8,'outline rotation');const rotated=room(first.id);
    await click('Undo layout change');await until(()=>sameObject(room(first.id),moved),'outline undo');
    await click('Redo layout change');await until(()=>sameObject(room(first.id),rotated),'outline redo');pass('Scanned outline responds to ArrowRight / R and shared Undo / Redo.');
    const preserved=JSON.stringify(room(first.id));await click('New layout from scan');await click('Upload a room scan');
    const secondScan=scan('QA second scanned room');await upload(JSON.stringify(secondScan));await editor(secondScan.name);await until(()=>workspace().layouts.length===2,'second scan saved');
    check(JSON.stringify(room(first.id))===preserved,'Creating another scan replaced or changed the previous layout');pass('New layout from scan creates a second layout and preserves the first arrangement.');
    const native=scan('QA native handoff');window.dispatchEvent(new CustomEvent('furniture-ar:scan',{detail:native}));window.dispatchEvent(new CustomEvent('furniture-ar:scan',{detail:structuredClone(native)}));
    await editor(native.name);await until(()=>workspace().layouts.length===3,'native handoff saved');await pause(100);
    check(workspace().layouts.filter(layout=>layout.name===native.name).length===1,'Duplicate native delivery made multiple layouts');pass('Duplicate native scan events create exactly one regular layout.');
    const fragment=scan('QA fragment handoff');const encoded=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(fragment)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    history.replaceState(null,'',`${location.pathname}#room-scan=${encoded}`);window.dispatchEvent(new HashChangeEvent('hashchange'));window.dispatchEvent(new HashChangeEvent('hashchange'));
    await editor(fragment.name);await until(()=>workspace().layouts.length===4,'fragment handoff saved');check(location.hash==='','Fragment was not consumed');
    check(workspace().layouts.filter(layout=>layout.name===fragment.name).length===1,'Fragment was imported more than once');
    mount();await until(()=>app.querySelector('.start-grid'),'remounted StrictMode app');check(workspace().layouts.length===4,'StrictMode remount duplicated a consumed fragment');
    await click('My layouts');await click(`Open ${firstScan.name}`);await editor(firstScan.name);
    check(JSON.stringify(room(first.id))===preserved,'Saved scan changed after reopening');pass('Fragment handoff is consumed once; reopening a saved scanned layout preserves edits.');
    check(blockedRequests===0,`${blockedRequests} API requests were attempted (all blocked)`);pass('No API requests were made.');
    report.dataset.status='passed';report.textContent=messages.join('\n')+'\nALL WORKFLOW CHECKS PASSED\nQA layout remains open for screenshots. Use Restore original workspace when finished.';
  } catch(error) {report.dataset.status='failed';report.textContent=messages.join('\n')+`\nFAIL ${(error as Error).stack||String(error)}\nUse Restore original workspace when finished.`;}
  finally {running=false;restore.disabled=false;run.disabled=false;}
});
if(sessionStorage.getItem(SNAPSHOT_KEY))report.textContent='A previous QA snapshot is available. Run again or restore your original workspace.';
