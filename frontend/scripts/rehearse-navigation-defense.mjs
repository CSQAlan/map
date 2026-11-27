import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

// Developer-only orchestration in this isolated copy; fixtures stay in their checks.
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Keep disposable Chrome profiles in the checkout, including the precheck.
for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = frontend;
// Never bridge production Vite environment overrides into synthetic browser checks.
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^VITE_/i.test(name)));
const steps = [
  { label: '休息/继续与信号恢复 [synthetic; AMap MOCK + fallback]', file: 'scripts/check-navigation-recovery.mjs' },
  { label: '前方台阶与可选单次语音 [synthetic; SDK MOCK + SVG fallback]', file: 'scripts/check-navigation-ahead.mjs' },
  { label: '地图休息点与步行计划 [synthetic; SDK MOCK + SVG fallback]', file: 'scripts/check-rest-waypoint.mjs' },
  { label: '返程地点预填与重新查询 [synthetic; fresh return route]', file: 'scripts/check-return-journey.mjs' },
  { label: '绕行连续步行预算 [synthetic; mobile Chrome; preview + unknown]', file: 'scripts/check-detour-rest-budget.mjs' },
  { label: '道路受阻与两次确认 [synthetic; guest App + API mocks]', file: 'scripts/check-navigation-obstruction.mjs' },
  { label: '暂停休息预览 [synthetic; SDK MOCK + SVG fallback]', file: 'scripts/check-paused-rest-preview.mjs' },
  { label: '简短播报 [synthetic; SDK MOCK + local voice mock + fallback]', file: 'scripts/check-navigation-brief.mjs' },
  { label: '普通路线备忘 [synthetic; in-memory download + guest App mocks]', file: 'scripts/check-navigation-memo.mjs' },
  { label: '登记照片提示 [synthetic; single image + caption; SDK MOCK + fallback]', file: 'scripts/check-navigation-photo-cue.mjs' },
  { label: '给身边的人看这一步 [synthetic; in-person help card; SDK MOCK + SVG fallback]', file: 'scripts/check-navigation-show-step.mjs' },
  { label: '导航大字模式 [synthetic; 320px + 100/150/200% text; SDK MOCK + SVG fallback]', file: 'scripts/check-navigation-large-text.mjs' },
  { label: '独立真实种子登记核对 [read-only local seed; NOT a real trip]', args: [
    '--test', '--test-name-pattern=real directed seed chain|actual seed roads',
    'tests/navigation-ahead.test.js', 'tests/navigation-rest-waypoint.test.js',
  ] },
];

// Independent current-cycle fixtures; never replace or extend the default suite.
const recentSteps = [
  { label: '出发前首段单图核对 [synthetic; real App + API/media mocks]', file: 'scripts/check-predeparture-first-leg-photo.mjs' },
  { label: '主动核对手动进度 [synthetic; NavigationPage fixture; SDK MOCK + SVG fallback]', file: 'scripts/check-navigation-manual-recovery.mjs' },
  { label: '撤销刚才的手动确认 [synthetic; real App + API mocks]', file: 'scripts/check-navigation-undo-manual-confirm.mjs' },
  { label: '本人到达选择与回执 [synthetic; real App + API mocks; NOT realtime arrival]', file: 'scripts/check-navigation-arrival.mjs' },
];

const help = `答辩前自检 — local synthetic browser checks (not a production demo mode)
Usage (from frontend): node scripts/rehearse-navigation-defense.mjs [--recent]
       node scripts/rehearse-navigation-defense.mjs -h | --help

Valid arguments: none, --recent alone, -h alone, or --help alone.
Combinations, duplicates and forwarded child flags are rejected before precheck.
Default: ${steps.filter(step => step.file).length} synthetic browser groups sequentially, then the original read-only
real-seed tests as group ${steps.length}. Includes obstruction, paused rest, brief, ordinary
route memo, registered photo cue, in-person help card and large text.
--recent: exactly ${recentSteps.length} independent synthetic browser groups, in this order; no seed audit:
  scripts/check-predeparture-first-leg-photo.mjs
  scripts/check-navigation-manual-recovery.mjs
  scripts/check-navigation-undo-manual-confirm.mjs
  scripts/check-navigation-arrival.mjs
All browser children receive --no-artifacts, including the two checks that are
artifact-free by default. No demo/recording mode is forwarded to children.
Requires already-installed Node, Chrome, @playwright/test, Vite and Vue.
No install/fetch/backend/real accounts/publish/deploy; only local loopback servers
and intercepted synthetic browser API/GPS/speech. No automatic retries.
Each step has a 120s limit; failure stops the sequence with step and exit status.
On interruption/timeout only this launcher's live child tree is terminated.
Retry manually after fixing the named requirement; never kill all Chrome/Node.

Fallback requirements: SDK MOCK and SVG fallback must both pass where tested.
Missing/ambiguous geometry keeps text guidance; uncertain location uses current
registered-map/text recovery. Optional speech needs a local voice on the real
device; use the visible text if sound is unavailable. No true GPS/sound/device
setup guarantee, and no field accessibility or actual arrival certification.
Mock checks do not certify real users or real phones, including readability,
accessibility or in-person help. The help card cannot confirm current location.

184 m = real-seed registered distance before ENTRY to the stair-containing leg,
not live distance to a stair. 159.63→86 m = synthetic manual-progress data only.
Waypoint = registered network node, not a seat position or confirmed arrival.
For --recent, verified means query/registration/photo matching in local fixtures,
not verified walking routes, current photo conditions or realtime arrival.
Manual step, distinct confirmed-segment count and personal arrival choice are
independent. A receipt is a local manual choice, not GPS or family verification.

The launcher and all child checks disable artifact writes. Existing screenshots,
reports and recordings are left untouched.
Default success prints the existing 55-second order, separate detour comparison and a
short Building B competition scene, with an optional 5-second large-text/help-card
insert. --recent success prints a separate fixture-labelled recording order.
These are manual presentation cues, not a hardware validation claim.`;

async function precheck(selectedSteps) {
  const required = [
    ...selectedSteps.flatMap(step => step.file ? [step.file] : step.args.filter(arg => arg.endsWith('.js'))),
    ...(selectedSteps === recentSteps ? [
      'src/components/PredepartureFirstLegPhoto.vue', 'src/composables/useMapData.js',
      'src/composables/useNavigationReceipt.js',
    ] : []),
    'scripts/fixtures/navigation-map-fixture.js', 'package.json', 'index.html', 'vite.config.js',
    'src/main.js', 'src/App.vue', 'src/router/index.js', 'src/pages/NavigationPage.vue',
    'src/components/AmapRouteMap.vue', 'src/components/FallbackRouteMap.vue',
    'src/styles.css', 'src/styles/base.css', 'src/styles/mobile-refresh.css',
    'src/services/navigationJourney.js', 'src/services/amapLoader.js',
    'src/composables/useRoutePlanner.js', 'src/composables/useAuthSession.js',
    'src/utils/navigationAhead.js', 'src/utils/navigationRest.js',
    'src/utils/navigationRestWaypoint.js', 'src/utils/navigationRestPlan.js',
    'src/utils/navigationBrief.js', 'src/utils/navigationMemo.js',
    'src/utils/navigationPhotoCue.js', 'src/services/routeMemoDownload.js',
    'src/pages/RouteOptionsPage.vue', 'src/utils/detourRestBudget.js',
    'tests/detour-rest-budget.test.js',
    '../backend/app/db/seed_data/core_segments.json',
    '../backend/app/db/seed_data/core_nodes.json', '../backend/app/db/seed_data/core_pois.json',
  ];
  for (const file of required) {
    const absolute = resolve(frontend, file);
    if (!(await stat(absolute).catch(() => null))?.isFile()) throw Error(`required file missing: ${absolute}`);
  }
  for (const name of ['@playwright/test', 'vite', '@vitejs/plugin-vue', 'vue']) {
    try { await access(fileURLToPath(import.meta.resolve(name))); }
    catch { throw Error(`already-installed dependency missing: ${name}; restore it separately, no automatic install`); }
  }
  // Same Chrome channel used by the existing checks; do not download a browser.
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  await browser.close();
  if (process.platform === 'win32') await access(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'));
  console.log(`PRECHECK PASS: ${required.length} exact required files, installed modules and local Chrome.`);
}

async function runStep(step, index, total) {
  const name = `[${index + 1}/${total}] ${step.label}`;
  console.log(`\nSTART ${name}`);
  const args = step.file
    ? [resolve(frontend, step.file), '--no-artifacts', ...(step.args || [])]
    : step.args;
  const child = spawn(process.execPath, args, {
    cwd: frontend, stdio: 'inherit', shell: false,
    detached: process.platform !== 'win32',
    env: { ...childEnv, UI_BROWSER: 'chrome' },
  });
  let stopping;
  const stop = () => stopping ||= new Promise(done => {
    // PID is an owned, still-live child, never a name/global process search.
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return done();
    if (process.platform === 'win32') {
      const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false, windowsHide: true });
      killer.once('error', error => { console.error(`Child cleanup failed: ${error.message}`); child.kill(); done(); });
      killer.once('close', code => { if (code && child.exitCode === null && child.signalCode === null) { console.error(`Child cleanup taskkill exit=${code}`); child.kill(); } done(); });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') console.error(error.message); }
      done();
    }
  });
  let interruption = null;
  const onInterrupt = signal => { interruption ||= signal; void stop(); };
  const onInt = () => onInterrupt('SIGINT'), onTerm = () => onInterrupt('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  const timer = setTimeout(() => { interruption ||= 'TIMEOUT (120s)'; void stop(); }, 120_000);
  const result = await new Promise(done => {
    child.once('error', error => done({ code: null, signal: null, error: error.message }));
    child.once('close', (code, signal) => done({ code, signal }));
  });
  clearTimeout(timer);
  await stopping;
  process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  const status = `exit=${result.code ?? 'null'}, signal=${result.signal ?? 'none'}${result.error ? `, spawn error=${result.error}` : ''}`;
  if (interruption || result.code !== 0) {
    console.error(`FAIL ${name}: ${status}${interruption ? `; ${interruption}` : ''}. No later steps run.`);
    return interruption === 'SIGINT' ? 130 : interruption === 'SIGTERM' ? 143 : interruption ? 124 : result.code || 1;
  }
  console.log(`PASS ${name}: ${status}`);
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) { console.log(help); return 0; }
  const recent = args.length === 1 && args[0] === '--recent';
  if (args.length && !recent) { console.error(`Unknown arguments: ${args.join(' ')}\nUse -h or --help. No check started.`); return 2; }
  const selectedSteps = recent ? recentSteps : steps;
  const browserCount = selectedSteps.filter(step => step.file).length;
  const seedCount = selectedSteps.length - browserCount;
  console.log(help);
  console.log(`\nSELECTED ${recent ? '--recent' : 'default'}: ${browserCount} synthetic browser groups + ${seedCount} read-only seed audit groups = ${selectedSteps.length} groups.`);
  try { await precheck(selectedSteps); }
  catch (error) { console.error(`FAIL precheck: ${error.message}; exit=1. No check started. Use --help for requirements.`); return 1; }
  for (const [index, step] of selectedSteps.entries()) {
    const code = await runStep(step, index, selectedSteps.length);
    if (code) return code;
  }
  if (recent) {
    console.log(`\n答辩前自检 --recent PASS — all ${selectedSteps.length}/${selectedSteps.length} groups exited 0: ${browserCount} synthetic browser groups; ${seedCount} seed audit groups.
The original seed audit was not run; use the default command for that coverage.
Short recording order (manual, separate fixture clips; launcher is headless and saves no recording):
  0–12s  First-leg photo: real App, two synthetic 100 m legs, synthetic pixels.
         Explicitly open one checked first-leg image; explain it cannot confirm conditions or position.
 12–24s  CUT to NavigationPage fixture: three synthetic 100 m legs, SDK MOCK + SVG fallback.
         我不确定走到哪 → 查看本段登记地图 / 按本段文字继续; no actual location claim.
 24–36s  CUT to undo App fixture: three synthetic 120 m legs.
         已走完这段: step 2, 1/3 → immediately 撤销刚才的确认: step 1, 0/3.
         Opening recovery or another action expires undo; record this as a fresh clip.
 36–48s  CUT to arrival App fixture: separate three synthetic 120 m legs.
         Mark one segment, end, explicitly choose arrival or unconfirmed; show 1/3 and return entry.
         Counts are not carried across scripts. Personal arrival choice is not realtime arrival proof.
Verified here means local query/registration/photo matching only; no real route, photo pixels,
GPS, road conditions, audible speech, phone accessibility or family service was verified.
See docs/navigation-defense-current-cycle.md from the repository root for fixture/demo details.`);
    return 0;
  }
  console.log(`\n答辩前自检 PASS — all ${steps.length} steps exited 0: ${browserCount} synthetic browser groups + ${seedCount} read-only seed audit group.
55-second demo order (manual presentation; this launcher does not open demo UI):
  0–10s  Show registered route/text; explain 184 m seed entry comparison vs synthetic 159.63→86 m.
 10–20s  累了，休息一下 → 继续前行: retain the manual segment; show signal recovery text/map choices.
 20–32s  Inspect ahead stairs on the registered map; optionally 听前方情况, then 停止播报; text is the fallback.
 32–45s  Inspect the rest waypoint; select a 100 m plan: synthetic excess 59.63 m → spare 14 m after manual advance.
 45–55s  Explicitly end; 填入返程地点 only prefills, then explicitly query a fresh return route.
Optional selectable 5-second insert before ending (manual; 60 seconds if selected):
  Select 放大导航文字, then 给身边的人看 to show the existing in-person help card.
  State: 这是我在查看的路线步骤，不能确认我就在这里。 Close 关闭大字卡, then 关闭导航文字放大.
Optional separate 10-second detour demo (synthetic; outside the 55-second sequence):
  Plan the 260 m original; pick one excluded leg and a 200 m continuous-walking budget.
  Wait for the 340 m candidate: longest 170 m vs original 260 m; candidate within budget.
  Keep it in preview: budget changes do not fetch or start navigation; missing evidence stays unknown.
Short second competition scene — Building B (manual presentation; local repository evidence):
  师大苑大学城西路入口 → 师大苑楼栋组团B: repository seed 92 + 94 = 186 m, not GPS distance.
  Photo cue follows manual current/next; explicitly request one photo and its caption at a time.
  First two registered captions: 师大苑内部主路入口段; 内部主路及停车混行环境.
  Second picture in the Building B group: 楼栋组团周边道路. Optionally request the one-shot brief.
  Save an ordinary route memo for later reference; it is not GPS navigation.
  Local repository photo evidence is separate from browser synthetic images/voice/GPS;
  neither verifies real walking, current road conditions or actual arrival.
Mock results do not certify real users or phones, including large-text readability or in-person help.
No true GPS, audible sound, device setup or actual arrival guarantee. Check the venue/device separately.`);
  return 0;
}

process.exitCode = await main();
