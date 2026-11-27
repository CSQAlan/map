import test from 'node:test';
import assert from 'node:assert/strict';
import { freshMapPosition, inMapCoverage, registeredRoadFeatures, segmentGeometry, routePartState } from '../src/utils/navigationMap.js';

const features = [{properties:{kind:'segment',segment_code:'a'},geometry:{type:'LineString',coordinates:[[10,10],[11,11]]}}];
const area = {limit_bounds:{south_west:[9,9],north_east:[12,12]},boundary:{coordinates:[[[9,9],[12,9],[12,12],[9,12],[9,9]]]}};
const now=100000;
const position={point:[10.5,10.5],accuracy:10,timestamp:now};

test('only ordered codes and the manual index determine route completion, including backtracking',()=>{
  const codes=['b','a','c'];
  assert.deepEqual(codes.map(code=>routePartState(code,codes,1)),['completed','current','upcoming']);
  assert.deepEqual(codes.map(code=>routePartState(code,codes,0)),['current','upcoming','upcoming']);
  assert.equal(routePartState('x',codes,1),'context');
  assert.equal(routePartState('a',['a','a'],1),'context');
  assert.equal(routePartState('a',codes,4),'context');
});

test('follow accepts only a fresh good enabled position within registered coverage, without snapping',()=>{
  assert.equal(freshMapPosition(position,'good',true,area,features,now),position);
  for(const quality of ['waiting','poor','stale','no-route']) assert.equal(freshMapPosition(position,quality,true,area,features,now),null);
  for(const change of [{accuracy:31},{accuracy:-1},{accuracy:NaN},{timestamp:now-15001},{timestamp:now+5001},{point:[13,10]},{point:[NaN,10]}])
    assert.equal(freshMapPosition({...position,...change},'good',true,area,features,now),null);
  assert.equal(freshMapPosition(position,'good',false,area,features,now),null);
  assert.equal(freshMapPosition(position,'good',true,null,[],now),null);
  assert.equal(inMapCoverage([9,10],area,features),true);
  assert.equal(inMapCoverage([10.5,10.5],null,features),true);
});

test('geometry adapter rejects unsupported/malformed/ambiguous roads instead of inventing route geometry',()=>{
  assert.equal(segmentGeometry(features,'a'),features[0]);
  assert.equal(segmentGeometry([...features,...features],'a'),null);
  assert.deepEqual(registeredRoadFeatures([...features,...features]),[]);
  assert.equal(segmentGeometry(features,'missing'),null);
  for(const geometry of [null,{type:'Point',coordinates:[10,10]},{type:'LineString',coordinates:[[10,10]]},
    {type:'LineString',coordinates:[[NaN,10],[11,11]]},{type:'MultiLineString',coordinates:[[[10,10],[11,11]]]}])
    assert.deepEqual(registeredRoadFeatures([{properties:{kind:'segment'},geometry}]),[]);
});
