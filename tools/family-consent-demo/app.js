const role = location.pathname === '/elder' ? 'elder' : 'family';
const $ = id => document.getElementById(id);
$(role).hidden = false;
$('title').textContent = role === 'elder' ? '老人测试页' : '家属测试页';
let state = null;
let epoch = 0;
let busy = false;
let polling = false;
async function request(options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`/api/${role}`, {...options, signal:controller.signal});
    const data = await response.json();
    return {response, data};
  } finally { clearTimeout(timer); }
}
function clear() {
  state = null;
  $('pair').textContent = '状态未确认，请检查本机演示服务';
  $('consent').textContent = '未确认授权，不显示共享内容';
  $('shared').textContent = '';
  $('code').textContent = '';
  updateButtons();
}
function updateButtons() {
  $('issue').disabled = busy || !state;
  $('accept').disabled = busy || !state;
  $('confirm').disabled = busy || !state || state.stage !== 'pending' || !state.remaining;
  $('grant').disabled = busy || !state || state.permission !== 'none' || !state.paired;
  $('revoke').disabled = busy || !state || !state.paired || state.permission === 'revoked';
}
function render(next) {
  if (state && next.revision < state.revision) return;
  state = next;
  $('pair').textContent = next.paired ? '已绑定测试角色' : next.stage === 'pending' ? '等待老人明确确认绑定' : '尚未绑定';
  $('consent').textContent = next.sharing ? '老人已单独同意共享' : next.permission === 'revoked' ? '共享已撤销，绑定保留；重新共享需要新邀请' : '未授权共享：绑定本身不会开放位置';
  $('shared').textContent = next.shared_message || '';
  $('code').textContent = next.code || '尚无演示邀请码';
  $('expiry').textContent = next.invitation_id ? (next.remaining ? `邀请剩余 ${next.remaining} 秒，接受和确认绑定须在到期前完成` : '邀请已过期，不能接受或确认新配对；已确认配对可首次单独开启共享') : '';
  updateButtons();
}
async function poll() {
  if (busy || polling) return;
  polling = true;
  const ticket = epoch;
  try {
    const {response, data:next} = await request({cache:'no-store'});
    if (!response.ok) throw Error('本机状态读取失败');
    if (ticket === epoch) render(next);
  } catch {
    if (ticket === epoch) clear();
  } finally { polling = false; }
}
async function command(action) {
  if (busy || !state) return;
  const invitation_id = action === 'accept' ? $('input').value.trim().toUpperCase() : action === 'revoke_location' || action === 'grant_location' ? state.pair_id : state.invitation_id;
  const target = role === 'family' && action === 'revoke_location' ? {pair_ref:state.pair_ref} : {invitation_id};
  busy = true;
  ++epoch; // Invalidate every pending pre-action GET.
  updateButtons();
  $('shared').textContent = '';
  try {
    const {response, data:next} = await request({method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action, ...target, request_id:crypto.randomUUID()})});
    if (!response.ok) { clear(); throw Error(next.error); }
    render(next);
    $('message').textContent = '操作完成，请在另一角色页查看状态。';
  } catch (error) {
    clear();
    $('message').textContent = error.message || '本机服务不可用，已清除共享显示';
  } finally { busy = false; updateButtons(); await poll(); }
}
for (const [id, action] of Object.entries({issue:'issue',accept:'accept',confirm:'confirm_pair',grant:'grant_location',revoke:'revoke_location'})) $(id).onclick = () => command(action);
clear();
poll();
setInterval(poll, 750);
