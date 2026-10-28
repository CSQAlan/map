import test from 'node:test';
import assert from 'node:assert/strict';
import { wgs84ToGcj02, evaluatePosition, distanceToPaths, remainingDistance } from '../src/services/navigationJourney.js';
const point=[106.31,29.60], now=100000, paths=[[[106.31,29.60],[106.311,29.60]]];
test('GPS coordinates match the backend transform and preserve foreign coordinates',()=> {const result=wgs84ToGcj02(106.3086,29.60435);assert.ok(Math.abs(result[0]-106.3123)<.001);assert.ok(Math.abs(result[1]-29.6017)<.001);assert.deepEqual(wgs84ToGcj02(2.3522,48.8566),[2.3522,48.8566]);});
test('off-route requires three fresh accurate samples and resets for stale or poor data',()=> { const sample={point:[106.32,29.61],accuracy:10,timestamp:now};let result=evaluatePosition(sample,paths,0,now);assert.equal(result.offRoute,false);result=evaluatePosition(sample,paths,result.streak,now);assert.equal(result.offRoute,false);result=evaluatePosition(sample,paths,result.streak,now);assert.equal(result.offRoute,true);assert.equal(evaluatePosition({...sample,accuracy:50},paths,3,now).streak,0);assert.equal(evaluatePosition({...sample,timestamp:1},paths,3,now).quality,'stale');assert.equal(evaluatePosition(sample,[],3,now).quality,'no-route');assert.equal(evaluatePosition({...sample,point},paths,3,now).streak,0); });
test('path distance uses segments rather than just vertices',()=> {assert.ok(distanceToPaths([106.3105,29.60],paths)<.01);assert.ok(distanceToPaths([106.3105,29.601],paths)>100);});
test('remaining distance follows completed segment proportions and has a labeled fallback',()=> {const route={distance_m:400,segments:[{length_m:100},{length_m:300}]};assert.equal(remainingDistance(route,0),400);assert.equal(remainingDistance(route,1),300);assert.equal(remainingDistance({distance_m:400,segments:[{},{}]},1),200);});

import { createNavigationPublisher } from '../src/services/navigationPublisher.js';
test('navigation snapshots are serialized so old progress cannot overtake completion',async()=> {
  const calls=[];let release;
  const publish=createNavigationPublisher({fetcher:async(_url,options)=>{calls.push(JSON.parse(options.body));if(calls.length===1)await new Promise(resolve=>release=resolve);return{ok:true};}});
  const first=publish('/navigation',{status:'NAVIGATING',index:0});
  const last=publish('/navigation',{status:'COMPLETED',index:1});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);release();assert.deepEqual(await Promise.all([first,last]),[true,true]);assert.deepEqual(calls.map(c=>c.status),['NAVIGATING','COMPLETED']);
});
test('a failed navigation snapshot releases the queue for the latest state',async()=> {let count=0;const publish=createNavigationPublisher({fetcher:async()=>{if(count++===0)throw new Error('offline');return{ok:true};}});assert.equal(await publish('/navigation',{}),false);assert.equal(await publish('/navigation',{}),true);});

test('publisher recovers server revisions after reload without depending on a device clock',async()=> {
 let serverRevision=1000000000;const accepted=[];
 const publish=createNavigationPublisher({fetcher:async(_url,options)=>{const body=JSON.parse(options.body);if(body.snapshot_revision<=serverRevision)return{ok:false,status:409,json:async()=>({detail:{snapshot_revision:serverRevision}})};serverRevision=body.snapshot_revision;accepted.push(body);return{ok:true};}});
 assert.equal(await publish('/navigation',{status:'NAVIGATING'}),true);
 assert.equal(await publish('/navigation',{status:'COMPLETED'}),true);
 assert.equal(accepted[0].snapshot_revision,1000000001);assert.equal(accepted[1].status,'COMPLETED');
});
test('only latest pending progress is retained and obsolete requests cannot retry a conflict',async()=> {
 let release;const calls=[];
 const publish=createNavigationPublisher({fetcher:async(_url,options)=>{calls.push(JSON.parse(options.body));if(calls.length===1){await new Promise(r=>release=r);return{ok:false,status:409,json:async()=>({detail:{snapshot_revision:100}})};}if(calls.length===2)return{ok:false,status:409,json:async()=>({detail:{snapshot_revision:100}})};return{ok:true};}});
 const first=publish('/navigation',{status:'NAVIGATING',index:0});
 const middle=publish('/navigation',{status:'NAVIGATING',index:1});
 const last=publish('/navigation',{status:'COMPLETED',index:1});
 assert.equal(await middle,false);release();assert.deepEqual(await Promise.all([first,last]),[false,true]);assert.deepEqual(calls.map(c=>c.status),['NAVIGATING','COMPLETED','COMPLETED']);
});

test('switching elders preserves the previous account completion and revision recovery',async()=> {
 let release;const calls=[];
 const publish=createNavigationPublisher({fetcher:async(url,options)=>{calls.push({url,...JSON.parse(options.body)});if(calls.length===1)await new Promise(r=>release=r);return{ok:true};}});
 const a=publish('/elder/A/navigation',{status:'NAVIGATING'});
 const end=publish('/elder/A/navigation',{status:'COMPLETED'});
 const b=publish('/elder/B/navigation',{status:'NAVIGATING'});
 assert.equal(await b,true);release();assert.deepEqual(await Promise.all([a,end]),[true,true]);assert.ok(calls.some(c=>c.url==='/elder/A/navigation'&&c.status==='COMPLETED'));
});
