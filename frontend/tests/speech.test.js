import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window ??= { location: { protocol:'http:',hostname:'localhost' } };
const { createSpeechInput, transcribeAudio } = await import('../src/services/speechInput.js');
const { createSpeechOutput, buildSegmentInstruction } = await import('../src/services/speechOutput.js');
const { matchSpokenPlace } = await import('../src/services/placeSpeech.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Recorder {
  static isTypeSupported() { return true; }
  constructor() { Recorder.latest=this; this.state='inactive'; this.mimeType='audio/webm'; }
  start() { this.state='recording'; }
  stop() { this.state='inactive'; this.ondataavailable?.({data:new Blob(['voice'])}); this.onstop?.(); }
}
function setup(extra={}) {
  let stopped=0, texts=[]; const stream={ getTracks:()=>[{stop:()=>stopped++}] };
  const input=createSpeechInput({ onText:t=>texts.push(t),upload:async()=>'去荷塘',mediaDevices:{getUserMedia:async()=>stream},Recorder,secure:true,schedule:()=>1,unschedule:()=>{},...extra });
  return { input,texts,stops:()=>stopped,stream };
}
test('recorder produces editable text and releases tracks after stop', async()=> { const {input,texts,stops}=setup(); await input.start(); assert.equal(input.state.value,'recording'); input.finish(); await tick(); assert.deepEqual(texts,['去荷塘']); assert.equal(stops(),1); assert.equal(input.state.value,'idle'); });
test('cancel while permission is pending releases a late stream without recording',async()=> { let release; const pending=new Promise(r=>release=r); const {input,stream,stops,texts}=setup({mediaDevices:{getUserMedia:()=>pending}}); const start=input.start(); input.cancel(); release(stream); await start; assert.equal(stops(),1); assert.equal(input.state.value,'idle'); assert.deepEqual(texts,[]); });
test('cancel rejects late transcription and aborts active request',async()=> { let release,signal; const {input,texts}=setup({upload:(_blob,options)=>{signal=options.signal;return new Promise(r=>release=r);}}); input.file(new Blob(['voice'])); input.cancel(); release('late'); await tick(); assert.equal(signal.aborted,true); assert.deepEqual(texts,[]); });
test('record permission and insecure origins have actionable errors',async()=> { const {input}=setup({mediaDevices:{getUserMedia:async()=>{throw Object.assign(new Error(),{name:'NotAllowedError'});}}}); await input.start(); assert.match(input.error.value,/权限/); assert.equal(input.state.value,'idle'); const unsafe=setup({secure:false}); await unsafe.input.start(); assert.match(unsafe.input.error.value,/HTTPS/); });
test('automatic stop uses the same transcription path',async()=> { let timeout; const {input,texts}=setup({schedule:f=>{timeout=f;return 1;}}); await input.start(); timeout(); await tick(); assert.deepEqual(texts,['去荷塘']); });
test('oversized and failed audio requests return clear errors',async()=> { await assert.rejects(transcribeAudio(new Blob([new Uint8Array(5*1024*1024+1)])),/5MB/); const old=globalThis.fetch;globalThis.fetch=async()=>({ok:false,json:async()=>({detail:'没有人声'})});try {await assert.rejects(transcribeAudio(new Blob(['audio'])),/没有人声/);}finally {globalThis.fetch=old;} });
test('place matching is unique and does not create unknown select values',()=> { const options=[{label:'荷塘水景休息区',value:'a'},{label:'荷塘入口休息区',value:'b'}]; assert.equal(matchSpokenPlace('我想去荷塘水景休息区。',options),'a'); assert.equal(matchSpokenPlace('荷塘',options),null); assert.equal(matchSpokenPlace('不存在的地方',options),null); assert.equal(matchSpokenPlace('',options),null); });
test('speech chooses local Chinese voice, cancels previous and ignores stale events',()=> { const utterances=[];let cancels=0;const voice={lang:'zh-CN',localService:true};const output=createSpeechOutput({synthesis:{cancel:()=>cancels++,getVoices:()=>[{lang:'en-US'},voice],speak:u=>utterances.push(u)},Utterance:class {constructor(text){this.text=text;}}});assert.equal(output.speak('第一段'),true);assert.equal(utterances[0].voice,voice);output.speak('第二段');utterances[0].onend();assert.equal(output.playing.value,true);utterances[1].onerror();assert.match(output.error.value,/播报/);output.stop();assert.ok(cancels>=3); });
test('unsupported speech stays readable, segment announcements contain current hazards',()=> { const output=createSpeechOutput({synthesis:null,Utterance:null});assert.equal(output.speak('路线'),false);assert.match(output.error.value,/文字/); const text=buildSegmentInstruction({name:'台阶路',step_count:5,risk_tags:['湿滑','湿滑'],has_ramp:true},1,2); assert.match(text,/第2段/);assert.match(text,/5级台阶/);assert.match(text,/坡道/);assert.equal((text.match(/湿滑/g)||[]).length,1);assert.match(text,/核对目的地/); });
