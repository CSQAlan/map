import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { effectScope, ref, createRenderer, reactive, h, nextTick } from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import { createNearbyServices, nearbyRouteBudget } from '../src/composables/useNearbyServices.js';

// Synthetic API fixtures, not a live seed/database or field verification.
const directory = [{name:'合成起点',poi_type:'ENTRANCE'},
  {name:'合成服务甲',poi_type:'SERVICE_ACCESS'}, {name:'合成服务乙',poi_type:'REST_AREA'},
  {name:'合成服务丙',poi_type:'REST_AREA'}];
function answer(url, distance) {
  const q = new URL(url,'http://test.local').searchParams;
  return {ok:true,status:200,json:async()=>({start_name:q.get('start_name'),end_name:q.get('end_name'),
    mobility_type:q.get('mobility_type'),routes:[{distance_m:distance,segment_codes:['synthetic-edge']}]})};
}
function setup(fetcher) {
  const scope=effectScope();
  const inputs={origin:ref('合成起点'),profile:ref('WHEELCHAIR'),pois:ref(directory),enabled:ref(true)};
  return {scope,...inputs,state:scope.run(()=>createNearbyServices({...inputs,fetcher}))};
}

test('total route budgets include equality and never treat unknown/missing/bad distances as zero',()=>{
  for(const budget of [100,200,300]) {
    assert.equal(nearbyRouteBudget({state:'reachable',distance:budget},budget),'within');
    assert.equal(nearbyRouteBudget({state:'reachable',distance:budget+0.01},budget),'over');
    assert.equal(nearbyRouteBudget({state:'unreachable'},budget),'no-route');
    assert.equal(nearbyRouteBudget({state:'unknown'},budget),'unknown');
  }
  for(const distance of [undefined,null,0,-1,NaN,Infinity,'58',false])
    assert.equal(nearbyRouteBudget({state:'reachable',distance},100),'unknown');
  assert.equal(nearbyRouteBudget({state:'reachable',distance:246},''),'unset');
});

test('budget changes reuse the same three results without queries, filtering or changing destination eligibility',async()=>{
  const requests=[];
  const w=setup(async url=>{
    requests.push(url);
    const end=new URL(url,'http://test.local').searchParams.get('end_name');
    if(end==='合成服务丙') return {ok:false,status:404,json:async()=>({detail:{message:'现有路网中没有符合当前出行条件的可达路线。',avoided_segments:[]}})};
    return answer(url,end==='合成服务甲'?58:246);
  });
  try {
    await w.state.query();
    const original=w.state.results.value;
    for(const budget of [100,200,300,'']) {
      assert.deepEqual(original.map(x=>nearbyRouteBudget(x,budget)),budget===''?['unset','unset','no-route']:
        ['within',budget===300?'within':'over','no-route']);
      assert.equal(w.state.results.value,original);
      assert.equal(w.state.canChoose('合成服务乙'),true);
      assert.equal(w.state.canChoose('合成服务丙'),false);
    }
    assert.equal(requests.length,3);
    assert.ok(requests.every(url=>new URL(url,'http://test.local').searchParams.get('strategy')==='BALANCED'));
  } finally {w.scope.stop();}
});

test('network and missing distance remain unknown, never over budget or no compatible route',async()=>{
  for(const fetcher of [async()=>{throw Error('offline');},async url=>answer(url,undefined)]) {
    const w=setup(fetcher);
    try {await w.state.query();assert.equal(w.state.results.value.length,3);
      assert.ok(w.state.results.value.every(row=>nearbyRouteBudget(row,100)==='unknown'));
    } finally {w.scope.stop();}
  }
});

test('context changes, leaving and disposal invalidate late responses and destination actions',async()=>{
  for(const field of ['origin','profile','enabled','dispose']) {
    const pending=[];
    const w=setup(url=>new Promise(resolve=>pending.push(()=>resolve(answer(url,58)))));
    const request=w.state.query();
    assert.equal(pending.length,3);
    if(field==='dispose')w.scope.stop();
    else w[field].value=field==='origin'?'合成服务甲':field==='profile'?'INDEPENDENT':false;
    pending.forEach(resolve=>resolve());await request;
    assert.deepEqual(w.state.results.value,[]);
    assert.equal(w.state.canChoose('合成服务甲'),false);
    w.scope.stop();
  }
});

test('actual page state keeps all service rows, resets budget by context and preserves explicit destination event',async()=>{
  const url=new URL('../src/pages/ElderPage.vue',import.meta.url);
  const source=await readFile(url,'utf8');
  let script=compileScript(parse(source).descriptor,{id:'nearby-budget-state'}).content;
  script=script.replace(/import (\w+) from '([^']+\.vue)';/g,(_,name)=>`const ${name}={render:()=>null};`)
    .replace(/from '([^']+)'/g,(_,specifier)=>`from '${specifier==='vue'?import.meta.resolve('vue'):new URL(specifier,url).href}'`);
  const {default:Page}=await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`);
  Page.render=()=>null;
  const renderer=createRenderer({createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},patchProp(){},insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null});
  const props=reactive({startName:'合成起点',mobilityType:'WHEELCHAIR',nearbyResults:[
    {name:'合成服务甲',state:'reachable',distance:100},{name:'合成服务乙',state:'reachable',distance:246},
    {name:'合成服务丙',state:'unreachable'},{name:'合成未知',state:'unknown'}]});
  let vm;const events=[];
  const app=renderer.createApp({render:()=>h(Page,{...props,ref:value=>{vm=value;},onCheckNearby:()=>events.push('query'),onChooseNearby:name=>events.push(name)})});
  try {
    app.mount({});const state=vm.$.setupState;
    assert.equal(state.nearbyBudget,'');
    state.nearbyBudget=100;
    assert.deepEqual(state.nearbyCards.map(x=>x.budgetState),['within','over','no-route','unknown']);
    state.nearbyBudget=300;assert.equal(state.nearbyCards.length,4);
    assert.equal(state.nearbyCards[1].budgetState,'within');assert.deepEqual(events,[]);
    // Existing button wiring remains an explicit emit; no planning is triggered by the select.
    assert.match(source,/@click="emit\('choose-nearby', item.name\)"/);
    vm.$emit('choose-nearby','合成服务乙');assert.deepEqual(events,['合成服务乙']);
    props.startName='合成服务甲';props.nearbyResults=[];await nextTick();
    assert.equal(state.nearbyBudget,'');assert.deepEqual(state.nearbyCards,[]);
    state.nearbyBudget=200;props.mobilityType='SLOW_WALKER';await nextTick();
    assert.equal(state.nearbyBudget,'');
    for(const text of ['这条算出的路线在预算内','这条算出的路线超过预算','预算暂未确认','预算不适用','不代表全局最短','不是最长连续步行段'])assert.ok(source.includes(text),text);
  }finally {app.unmount();}
});
