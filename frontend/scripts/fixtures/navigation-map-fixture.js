// Local UI test fixture only. All coordinates and route records are synthetic.
import { createApp, h, reactive } from 'vue';
import NavigationPage from '../../src/pages/NavigationPage.vue';
import '../../src/styles.css';

const segments = [
  {segment_code:'a',name:'合成测试段甲',length_m:100,step_count:0,width_m:2,risk_tags:[]},
  {segment_code:'b',name:'合成测试段乙',length_m:100,step_count:3,width_m:1.2,risk_tags:['合成登记风险']},
  {segment_code:'c',name:'合成测试段丙',length_m:100,risk_tags:[]},
];
const features = segments.map((s,i)=>({type:'Feature',properties:{...s,kind:'segment',wheelchair_accessible:true},geometry:{type:'LineString',coordinates:[[10+i*.001,10+i*.001],[10+(i+1)*.001,10+(i+1)*.001]]}}));
const state = reactive({selectedRoute:{distance_m:300,segment_codes:['a','b','c'],segments,
  navigation_rest:{version:1,source:'ACTIVE_REST_AREA_LINKED_NODES/v1',segment_codes:['a','b','c'],node_codes:['n0','n1','n2','n3'],segment_lengths_m:[100,100,100],stops:[{node_index:2,node_code:'n2',name:'合成登记休息点'}]}},
  mapFeatures:features,pilotArea:{center:[10,10],min_zoom:16,max_zoom:20,limit_bounds:{south_west:[9.99,9.99],north_east:[10.01,10.01]},
    boundary:{coordinates:[[[9.99,9.99],[10.01,9.99],[10.01,10.01],[9.99,10.01],[9.99,9.99]]]}},
  mapFailure:location.search.includes('fallback')?'本地测试强制示意图':'',selectedSegmentCode:'a',guidancePaused:false,detourActive:false});
const events=[];
window.__navFixture={state,events,features,segments};
createApp({render:()=>h(NavigationPage,{...state,
  onSelectSegment:code=>{state.selectedSegmentCode=code;events.push({select:code});},
  onProgress:progress=>events.push({progress}),onPauseDetour:message=>{state.guidancePaused=true;events.push({pause:message});},
  onMapError:message=>{state.mapFailure=message;},onEndNavigation:()=>events.push({end:true}),onSendSos:()=>events.push({sos:true}),
})}).mount('#app');
