import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RoomScanImport from '../src/components/RoomScanImport.tsx';
import { plannerReturnURL, scannerLaunchURL } from '../src/lib/scanner-link.ts';

const sites=[
  'https://furniture-ar-mobile-20261024.notyourmewtwo.chatgpt.site/',
  'https://another-planner.test:8443/furniture/planner/',
];
test('scanner launch returns to the current hosting page, without tokens or an old scan',()=>{
  for(const site of sites){
    const current=site+'?token=do-not-forward&next=https://other.test/#room-scan=old';
    assert.equal(plannerReturnURL(current),site);
    const launch=new URL(scannerLaunchURL(current)!);
    assert.equal(launch.protocol,'furniturear-scan:');assert.equal(launch.hostname,'scan');
    assert.deepEqual([...launch.searchParams],[['returnUrl',site]]);
    assert.equal(launch.hash,'');
  }
  const escaped='https://planner.test/a%20room/%E5%AE%A2%E5%8E%85/';
  assert.equal(new URL(scannerLaunchURL(escaped)!).searchParams.get('returnUrl'),escaped);
});
test('invalid planner addresses never launch with an unrelated fallback',()=>{
  for(const address of ['http://localhost:4174/','javascript:alert(1)','file:///planner.html',
    'https://user:secret@planner.test/','not a URL','/relative',`https://planner.test/${'a'.repeat(8192)}`]){
    assert.equal(plannerReturnURL(address),null);assert.equal(scannerLaunchURL(address),null);
  }
  const prefix='https://planner.test/';
  const boundary=prefix+'a'.repeat(4096-prefix.length);
  assert.equal(plannerReturnURL(boundary),boundary);
  assert.equal(scannerLaunchURL(boundary+'a'),null);
});
test('the real scan dialog launch link follows the host; embedded native scanning stays in its webview',()=>{
  const previous=globalThis.window;
  try{
    for(const href of sites){
      (globalThis as any).window={location:{href:href+'#room-scan=old'}};
      const html=renderToStaticMarkup(createElement(RoomScanImport,{onClose(){},onImport(){}}));
      assert.ok(html.includes(`href="${scannerLaunchURL(href)}"`));
      assert.equal(html.includes('href="furniturear-scan://scan"'),false);
    }
    (globalThis as any).window={location:{href:sites[0]},furnitureARNativeVersion:1,
      webkit:{messageHandlers:{furnitureAR:{postMessage:async()=>true}}}};
    const nativeHTML=renderToStaticMarkup(createElement(RoomScanImport,{onClose(){},onImport(){}}));
    assert.equal(nativeHTML.includes('furniturear-scan://'),false);
    (globalThis as any).window={location:{href:'http://localhost:4174/'}};
    const localHTML=renderToStaticMarkup(createElement(RoomScanImport,{onClose(){},onImport(){}}));
    assert.equal(localHTML.includes('furniturear-scan://'),false);
  }finally{(globalThis as any).window=previous;}
});
test('the setup page returns to its planner directory, not the help page or another deployment',()=>{
  const html=readFileSync(new URL('../public/room-scanner.html',import.meta.url),'utf8');
  const script=html.match(/<script id="scanner-launch-script">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script,'The production setup page must configure its launch link.');
  for(const site of sites){
    const elements:Record<string,{href?:string;textContent?:string}>={'open-scanner':{},'scanner-address-note':{}};
    runInNewContext(script,{URL,window:{location:{href:site+'room-scanner.html?token=secret#old'}},
      document:{getElementById:(id:string)=>elements[id]}});
    const launch=new URL(elements['open-scanner'].href!);
    assert.equal(launch.searchParams.get('returnUrl'),site);
    assert.equal(elements['scanner-address-note'].textContent,'Planner address: '+site);
  }
  const elements:Record<string,{href?:string}>={'open-scanner':{},'scanner-address-note':{}};
  runInNewContext(script,{URL,window:{location:{href:'http://localhost/room-scanner.html'}},
    document:{getElementById:(id:string)=>elements[id]}});
  assert.equal(elements['open-scanner'].href,undefined);
});
