import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRenderer, h, reactive, nextTick, createSSRApp } from 'vue';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { renderToString } from 'vue/server-renderer';
import { manualRemainingDistance, navigationRows, registeredSegmentText } from '../src/utils/navigationText.js';

// Synthetic routes and speech only. No device location, network or database.
const route = () => ({distance_m:150,segment_codes:['a','b'],segments:[
  {segment_code:'a',name:'合成第一段',length_m:100,step_count:0,width_m:2.5},
  {segment_code:'b',name:'合成第二段',length_m:50,step_count:3,width_m:1.3}]});

test('legacy zero current stairs stay unconfirmed like the slow brief; missing and positive stay distinct', () => {
  const zero = registeredSegmentText({ step_count: 0 }).steps;
  assert.match(zero, /本段台阶数量未确认/); assert.match(zero, /可能为默认值/);
  assert.match(zero, /不能确认无台阶/); assert.doesNotMatch(zero, /0 级/);
  assert.match(registeredSegmentText({}).steps, /未记录或资料无效/);
  assert.equal(registeredSegmentText({ step_count: 7 }).steps,
    '登记台阶：7 级；不能据此确认可通行，请核对现场。');
});

test('legacy 1.50 width is explicitly a possible default; other positive widths never confirm live clearance', () => {
  const fallback = registeredSegmentText({ width_m: 1.50 }).width;
  assert.match(fallback, /登记路宽：1.5 米/); assert.match(fallback, /可能为默认值/);
  assert.match(fallback, /现场可用宽度未确认/);
  const positive = registeredSegmentText({ width_m: 1.8 }).width;
  assert.match(positive, /登记路宽：1.8 米/); assert.match(positive, /现场可用宽度未确认/);
  assert.doesNotMatch(positive, /默认值/);
  for (const width_m of [undefined, null, 0, -1, '1.50', true, NaN, Infinity, {}, []]) {
    const missing = registeredSegmentText({ width_m }).width;
    assert.match(missing, /有效正路宽未记录/); assert.doesNotMatch(missing, /登记路宽：|默认值/);
  }
});

test('current route records leave zero unconfirmed and retain positive stairs and registered width',()=>{
  const rows=navigationRows(route());
  assert.match(registeredSegmentText(rows[0]).steps,/本段台阶数量未确认.*可能为默认值.*不能确认无台阶/);
  assert.match(registeredSegmentText(rows[1]).steps,/3 级.*不能据此确认可通行/);
  assert.match(registeredSegmentText(rows[1]).width,/1.3 米/);
  for(const value of [null,undefined,-1,NaN,Infinity,'0','7',false,1.5,Number.MAX_SAFE_INTEGER+1])
    assert.match(registeredSegmentText({step_count:value}).steps,/未记录或资料无效/);
  for(const value of [null,undefined,0,-1,NaN,Infinity,'2',false])
    assert.match(registeredSegmentText({width_m:value}).width,/有效正路宽未记录/);
  assert.match(registeredSegmentText().steps,/不能当作 0/);
});

test('remaining is the sum of whole unconfirmed segments only with complete matching registered lengths',()=>{
  assert.equal(manualRemainingDistance(route(),0),150);
  assert.equal(manualRemainingDistance(route(),1),50);
  for(const value of [null,undefined,0,-1,'100',NaN]) {
    const r=route();r.segments[0].length_m=value;
    assert.equal(manualRemainingDistance(r,1),null);
  }
  for(const r of [null,{}, {...route(),distance_m:151},{...route(),segment_codes:['a','a']},
    {...route(),segments:[route().segments[0]]},{...route(),segment_codes:['a','missing']}])
    assert.equal(manualRemainingDistance(r,0),null);
  assert.equal(manualRemainingDistance(route(),-1),null);
  assert.equal(manualRemainingDistance(route(),2),null);
  assert.equal(manualRemainingDistance(route(),0.5),null);
  const duplicate=route();duplicate.segments=[duplicate.segments[0],duplicate.segments[0]];
  assert.equal(navigationRows(duplicate)[0].name,'路段资料未确认');
  assert.equal(manualRemainingDistance(duplicate,0),null);
});

test('repository seed registered entrance route stays 246m with its actual names, widths and stair records',async()=>{
  const seed=JSON.parse(await readFile(new URL('../../backend/app/db/seed_data/core_segments.json',import.meta.url),'utf8'));
  const codes=['S_SY_GATE_TO_MAIN','S_SY_MAIN_TO_LOTUS'];
  const r={distance_m:246,segment_codes:codes,segments:codes.map(code=>seed.find(row=>row.segment_code===code))};
  assert.ok(r.segments.every(Boolean));assert.equal(manualRemainingDistance(r,0),246);
  const rows=navigationRows(r);
  rows.forEach((row,i)=>{assert.equal(row.name,r.segments[i].name);assert.match(registeredSegmentText(row).steps,/本段台阶数量未确认.*可能为默认值/);
    assert.ok(registeredSegmentText(row).width.includes(`${r.segments[i].width_m} 米`));});
  assert.equal(manualRemainingDistance(r,1),r.segments[1].length_m);
  assert.equal(r.segments[1].end_node_code,'N_SY_LOTUS_ENTRY');
});

async function compiledPage() {
  const url=new URL('../src/pages/NavigationPage.vue',import.meta.url);
  let code=compileScript(parse(await readFile(url,'utf8')).descriptor,{id:'large-navigation',inlineTemplate:true}).content;
  code=code.replace(/import (\w+) from '([^']+\.vue)';/g,(_,name)=>`const ${name}={render:()=>null};`)
    .replace(/from (['"])([^'"]+)\1/g,(_,quote,specifier)=>`from '${specifier==='vue'?import.meta.resolve('vue'):new URL(specifier,url).href}'`);
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
}
const node=(type,text='')=>({type,text,children:[],props:{},querySelector:()=>null,querySelectorAll:()=>[]});
const text=n=>n.text+n.children.map(text).join('');
const all=n=>[n,...n.children.flatMap(all)];
function mount(Page,props,events) {
  const renderer=createRenderer({createElement:tag=>node(tag),createText:value=>node('#text',value),createComment:()=>node('#comment'),
    setText(n,value){n.text=value;},setElementText(n,value){n.text=value;n.children=[];},patchProp(n,key,old,value){n.props[key]=value;},
    insert(n,parent,anchor){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=parent;const i=parent.children.indexOf(anchor);parent.children.splice(i<0?parent.children.length:i,0,n);},
    remove(n){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);},parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]});
  const root=node('root');
  const app=renderer.createApp({render:()=>h(Page,{...props,onProgress:p=>events.push(p),onEndNavigation:()=>events.push('end'),onOpenRoutes:()=>events.push('routes')})});
  app.mount(root);
  const button=label=>all(root).find(n=>n.type==='button'&&text(n).includes(label));
  return {root,button,app,async click(label){const b=button(label);assert.ok(b,label);assert.notEqual(b.props.disabled,true,label);b.props.onClick();await nextTick();}};
}

test('rendered native buttons drive segments, pause, route reset and detour suspension without maps or automatic speech',async()=>{
  const Page=await compiledPage();const spoken=[];let cancels=0;
  const oldSynth=globalThis.speechSynthesis,oldUtterance=globalThis.SpeechSynthesisUtterance;
  globalThis.speechSynthesis={cancel(){cancels++;},getVoices:()=>[],speak:u=>spoken.push(u.text)};
  globalThis.SpeechSynthesisUtterance=class {constructor(value){this.text=value;}};
  const props=reactive({selectedRoute:route(),guidancePaused:false,detourActive:false});const events=[];
  const page=mount(Page,props,events);
  try {
    assert.match(text(page.root),/第 1 段，共 2 段：合成第一段/);
    assert.match(text(page.root),/登记剩余约 150 米/);
    assert.match(text(page.root),/不是当前位置到终点的精确距离/);
    assert.equal(spoken.length,0);assert.ok(page.button('地图导航'));assert.ok(page.button('文字导航'));
    assert.equal(all(page.root).some(n=>n.props.id==='optional-navigation-map'),true);
    await page.click('文字导航');
    assert.equal(all(page.root).some(n=>n.props.id==='optional-navigation-map'),false);
    await page.click('已走完这段');assert.match(text(page.root),/合成第二段/);
    assert.match(text(page.root),/登记剩余约 50 米/);assert.match(text(page.root),/登记台阶：3 级/);
    const announcement=all(page.root).find(n=>n.props['aria-live']==='polite'&&n.props['aria-atomic']==='true');
    assert.match(text(announcement),/登记台阶：3 级/);assert.match(text(announcement),/登记路宽：1.3 米/);
    await page.click('开启语音提示');assert.equal(spoken.length,1);
    assert.equal(all(page.root).some(n=>n.props['aria-live']==='polite'&&n.props['aria-atomic']==='true'),false);
    await page.click('休息一下');assert.equal(page.button('核对目的地并结束').props.disabled,true);
    assert.match(text(page.root),/已暂停播报和路段推进/);
    await page.click('继续前行');assert.equal(spoken.length,2);
    await page.click('地图导航');
    assert.ok(all(page.root).some(n=>n.props.id==='optional-navigation-map'));
    const count=spoken.length;
    props.guidancePaused=true;props.detourActive=true;await nextTick();
    assert.match(text(page.root),/绕行引导已暂停/);
    assert.doesNotMatch(text(page.root),/合成第二段|登记剩余约|optional-navigation-map/);
    assert.equal(all(page.root).some(n=>n.props.id==='optional-navigation-map'),false);
    assert.equal(spoken.length,count);assert.ok(cancels>0);
    await page.click('返回路线页');assert.ok(events.includes('routes'));
    props.selectedRoute={distance_m:30,segment_codes:['new'],segments:[{segment_code:'new',name:'新的当前段',length_m:30}]};
    props.guidancePaused=false;await nextTick();
    assert.match(text(page.root),/第 1 段，共 1 段：新的当前段/);
    assert.match(text(page.root),/台阶数量未记录/);assert.doesNotMatch(text(page.root),/合成第二段/);
    assert.equal(spoken.length,count);
    await page.click('核对目的地并结束');assert.match(text(page.root),/结束导航不会自动验证到达/);
    assert.ok(all(page.root).some(n=>n.props.role==='dialog'&&n.props['aria-modal']==='true'));
    await page.click('确认结束导航');assert.ok(events.includes('end'));
  }finally{page.app.unmount();globalThis.speechSynthesis=oldSynth;globalThis.SpeechSynthesisUtterance=oldUtterance;}
});

test('next preview uses registered ordered rows, changes no progress, and clears on manual moves, replacement and detour pause',async()=>{
  const Page=await compiledPage();const props=reactive({selectedRoute:route(),guidancePaused:false,mapFailure:'合成测试'});const events=[];
  const page=mount(Page,props,events);
  try {
    const before=events.length;
    await page.click('预览下一段');
    assert.match(text(page.root),/下一登记路段：合成第二段/);
    assert.match(text(page.root),/登记台阶：3 级/);
    assert.match(text(page.root),/下一段缺少支持的登记图形/);
    assert.equal(events.length,before);
    assert.match(text(page.root),/登记剩余约 150 米/);
    await page.click('返回当前路段');
    assert.doesNotMatch(text(page.root),/下一登记路段：合成第二段/);
    await page.click('预览下一段');await page.click('已走完这段');
    assert.equal(page.button('预览下一段').props.disabled,true);
    assert.doesNotMatch(text(page.root),/下一登记路段：合成第二段/);
    await page.click('上一段');await page.click('预览下一段');
    props.selectedRoute={distance_m:20,segment_codes:['new'],segments:[{segment_code:'new',name:'合成替换段',length_m:20}]};await nextTick();
    assert.match(text(page.root),/合成替换段/);assert.doesNotMatch(text(page.root),/合成第二段/);
    props.guidancePaused=true;await nextTick();
    assert.doesNotMatch(text(page.root),/合成替换段|路线进度图例|下一登记路段/);
  } finally {page.app.unmount();}
});

test('provider-stub SSR and text-zoom CSS keep readable native controls and entry boundary',async()=>{
  const stub={name:'large-nav-no-map',enforce:'pre',resolveId(source){if(/\/(AmapRouteMap|FallbackRouteMap)\.vue$/.test(source))return '\0large-no-map';},load(id){if(id==='\0large-no-map')return 'export default {render:()=>null}';}};
  const server=await createServer({configFile:false,envDir:false,plugins:[stub,vue()],server:{middlewareMode:true,watch:null,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]}});
  try {
    const {default:Page}=await server.ssrLoadModule('/src/pages/NavigationPage.vue');
    const r=route();r.arrival_boundary={version:1,kind:'LOTUS_ENTRY',node_code:'N_SY_LOTUS_ENTRY',last_segment_code:'b',source:'SHIDAYUAN-core-endpoint-interpretation/2026-11-24/v1'};
    const html=await renderToString(createSSRApp(Page,{selectedRoute:r,mapFailure:'禁用地图'}));
    for(const phrase of ['逐段地图导航','文字导航','第 1 段，共 2 段','现在怎么做','本段台阶数量未确认','可能为默认值','登记路宽：2.5 米','现场可用宽度未确认','只到荷塘入口，不到内侧平台或座椅','不是当前位置到终点的精确距离','查看全程 2 段指引'])assert.ok(html.includes(phrase),phrase);
    assert.match(html,/aria-labelledby="current-segment-title"/);assert.match(html,/aria-live="polite"/);
    assert.match(html,/<button[^>]*type="button"/);assert.match(html,/<summary\b[^>]*>/);
    const invalid=route();delete invalid.segments[0].length_m;
    assert.match(await renderToString(createSSRApp(Page,{selectedRoute:invalid})),/登记剩余路程暂未确认/);
    const source=await readFile(new URL('../src/pages/NavigationPage.vue',import.meta.url),'utf8');
    for(const css of ['min-height: 48px','focus-visible','overflow-wrap: anywhere','minmax(0, 1fr)','font-size: 1.25rem','max-height: calc(100dvh - 2rem)'])assert.ok(source.includes(css),css);
    assert.match(source,/:aria-live="voiceEnabled \? 'off' : 'polite'"/);
  }finally{await server.close();}
});
