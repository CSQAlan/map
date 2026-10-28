import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output=process.env.UI_OUTPUT_DIR || 'artifacts/speech-live';await mkdir(output,{recursive:true});
const audio=process.env.SPEECH_TEST_AUDIO || '../.logs/speech-zh-synthetic.wav';
const browser=await chromium.launch({channel:process.env.UI_BROWSER || 'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});let sent=null;let transcriptions=0;
  page.on('request',request=>{if(request.url().endsWith('/assistant/chat'))sent=request.postDataJSON();if(request.url().endsWith('/speech/transcribe'))transcriptions++;});
  await page.goto(base+'/#/elder/assistant');await page.locator('input[type=file]').setInputFiles(audio);
  await page.getByText('语音已转成文字，请检查后发送。').waitFor({timeout:120000});const transcript=await page.getByLabel('向出行助手提问').inputValue();assert.match(transcript,/路线/);assert.equal(sent,null);assert.equal(transcriptions,1);
  await page.getByRole('button',{name:'发送问题',exact:true}).click();await page.locator('.chat-turn--assistant').waitFor({timeout:180000});
  assert.equal(sent.messages.at(-1).content,transcript);const reply=await page.locator('.chat-turn--assistant p').innerText();assert.ok(reply.length>5);
  await page.screenshot({path:output+'/speech-ai-390.png',fullPage:true});await writeFile(output+'/result.json',JSON.stringify({syntheticAudio:true,transcript,reply,model:'configured local Ollama',flow:'audio -> local faster-whisper -> editable draft -> explicit send -> Ollama'},null,2));
  console.log('PASS: actual audio upload, local ASR, editable draft, explicit send and actual Ollama reply. Transcript:',transcript);
} finally {await browser.close();}
