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

test('slow local-only speech is explicit, one shot, and does not change ordinary defaults', () => {
  const remote = { lang: 'zh-CN', localService: false }, local = { lang: 'zh-Hans', localService: true };
  const utterances = [];
  let voices = [remote, local], cancels = 0;
  const output = createSpeechOutput({ synthesis: { cancel: () => cancels++, getVoices: () => voices,
    speak: u => utterances.push(u) }, Utterance: class { constructor(text) { this.text = text; } } });
  assert.equal(output.speak('本段简述。', { rate: 0.70, localOnly: true }), true);
  assert.equal(utterances.length, 1); assert.equal(utterances[0].rate, 0.70);
  assert.equal(utterances[0].voice, local); assert.equal(utterances[0].text, '本段简述。');
  utterances[0].onend(); assert.equal(output.playing.value, false);
  assert.equal(utterances.length, 1, 'completion never repeats');
  voices = [remote];
  assert.equal(output.speak('普通播报'), true);
  assert.equal(utterances[1].rate, 0.85); assert.equal(utterances[1].voice, remote);
  utterances[0].onerror(); assert.equal(output.playing.value, true); assert.equal(output.error.value, '');
  output.stop(); utterances[1].onend(); utterances[1].onerror();
  assert.equal(output.playing.value, false); assert.equal(output.error.value, '');
  assert.ok(cancels >= 3);
});

test('local-only speech rejects remote, missing, unconfirmed and non-Chinese voices without fallback', () => {
  for (const voices of [[], [{ lang: 'zh-CN', localService: false }], [{ lang: 'zh-CN' }],
    [{ lang: 'zh-CN', localService: 'true' }], [{ lang: 'en-US', localService: true }]]) {
    const spoken = [];
    const output = createSpeechOutput({ synthesis: { cancel() {}, getVoices: () => voices, speak: u => spoken.push(u) },
      Utterance: class {} });
    assert.equal(output.speak('仅本地简述', { rate: 0.70, localOnly: true }), false);
    assert.equal(output.playing.value, false); assert.deepEqual(spoken, []);
    assert.match(output.error.value, /本地中文语音.*不可用.*文字/);
    output.speak('普通播报'); assert.equal(spoken.length, 1, 'legacy fallback remains available to ordinary consumers');
    assert.equal(spoken[0].rate, 0.85);
  }
});

test('voice enumeration failure and unsupported synthesis keep local-only speech silent', () => {
  let spoken = 0;
  const output = createSpeechOutput({ synthesis: { cancel() {}, getVoices() { throw Error('unavailable'); }, speak() { spoken++; } },
    Utterance: class {} });
  assert.equal(output.speak('这一段', { rate: 0.70, localOnly: true }), false);
  assert.equal(spoken, 0); assert.match(output.error.value, /本地中文语音.*文字/);
  assert.throws(() => output.speak('普通播报'), /unavailable/, 'ordinary enumeration failure keeps its prior behavior');
  assert.equal(spoken, 0);
  const unsupported = createSpeechOutput({ synthesis: null, Utterance: null });
  assert.equal(unsupported.speak('这一段', { rate: 0.70, localOnly: true }), false);
  assert.match(unsupported.error.value, /不支持.*文字/);
});
