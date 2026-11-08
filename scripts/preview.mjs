/** Component visual QA in a real browser. The surrounding composer is a fixture, not a running Harness. */
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { nativeUiPreview } from './native-ui-preview.mjs';

const require = createRequire(import.meta.url);
const reactDir = dirname(require.resolve('react/package.json'));
const reactDomDir = dirname(require.resolve('react-dom/package.json'));
const native = await nativeUiPreview(process.env.DSH_SOURCE_DIR);
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hooks component QA</title>
<style>*{box-sizing:border-box}body{margin:0;font:14px/1.5 "Segoe UI",sans-serif;background:#f7f8fb;color:#20232b}main{max-width:780px;margin:40px auto;padding:24px}header{font-size:18px;font-weight:600;margin-bottom:180px}.composer{background:#fff;padding:16px;border:1px solid #d9dde8;border-radius:16px;box-shadow:0 8px 32px #20232b09}textarea{width:100%;border:0;resize:none;padding:10px 0;color:inherit;font:inherit;outline:none}footer{display:flex;align-items:center;justify-content:space-between;color:#636a7b;font-size:12px}.send{background:#3155d9;color:white;border:0;border-radius:50%;width:32px;height:32px}@media(max-width:480px){main{padding:16px;margin:16px auto}header{margin-bottom:100px}}</style>
<main><header>DeepSeek Harness · Hooks</header><div id="root"></div></main>
<style>main{max-width:none}#root{--dsh-composer-card-max-width:720px;--dsh-composer-side-clearance:16px;--dsh-composer-stack-gap:6px;display:flex;flex-direction:column;gap:var(--dsh-composer-stack-gap)}#root[data-layout=hero]{width:min(calc(var(--dsh-composer-card-max-width) + 2 * var(--dsh-composer-side-clearance)),100%);margin-inline:auto}</style>
<style>${native.css}button{font-family:inherit}.native-modal-body{min-width:0}</style><script src="/react.js"></script><script src="/react-dom.js"></script><script>${native.js}</script><script>window.__ModuleLoader__={load(def){window.hooksPlugin=def.factory(name=>name==='react'?React:hooksUi)}};</script><script src="/client.js"></script>
<script>
const h=React.createElement; let Dock; window.answers=[];window.forgotten=[];window.permissionStatus=null;window.registeredSlots=[];window.instanceAnswers=[];window.ruleFailure=null;
let requests=[{id:'preview',schema:'dsh-hooks/approval-v1',scope:'session',sessionId:'preview',cwd:'D:/work/project',fingerprint:'a'.repeat(64),hooks:[
{event:'SessionStart',statusMessage:'加载项目上下文',command:'node ./hooks/context.mjs',source:'.codex/hooks.json'},
{event:'PreToolUse',statusMessage:'检查待执行命令',command:'node ./hooks/guard.mjs',source:'.codex/hooks.json'}]}];
const ctx={effect:fn=>fn(),inject:(_keys,fn)=>fn(ctx),locale:{register:(_ns,dict)=>{window.t=k=>dict.zh[k];return()=>{}}},slots:{inject:(_name,fn)=>fn(),register:(spec,Comp)=>{registeredSlots.push(spec.name);if(spec.name==='conversation.input.dock')Dock=Comp;return()=>{}}},remote:{$mount:async()=>()=>{},dshHooksPermissions:{list:async()=>({ok:true,value:{requests,status:permissionStatus}}),answer:async request=>{answers.push(request);permissionStatus={...requests[0],session:request.decision!=='deny',permanent:request.decision==='allow-permanent'};requests=[];return{ok:true,value:{accepted:true}}},status:async()=>({ok:true,value:permissionStatus}),forget:async request=>{forgotten.push(request);permissionStatus=null;return{ok:true,value:{revoked:true}}},revoke:async()=>({ok:true,value:{revoked:true}}),setRule:async request=>{instanceAnswers.push(request);if(ruleFailure)return{ok:false,error:{message:ruleFailure}};const p=permissionStatus.policy;const hooks=p.hooks.map(row=>row.id!==request.id?row:{...row,choice:request.choice,effective:request.choice==='inherit'?'allow':request.choice,from:request.choice==='inherit'?'global':'session'});const next={...p,revision:'e'.repeat(64),hooks};permissionStatus={...permissionStatus,policy:next};return{ok:true,value:next};}}}};
(async()=>{await hooksPlugin.apply(ctx);ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment,null,h(Dock,{sessionId:'preview',t}),h('div',{className:'native-inputbar-root'},h('div',{className:'composer native-inputbar-card','data-composer-card':''},h('textarea',{'aria-label':'message',placeholder:'发送消息',rows:2,defaultValue:'正在编辑的草稿'}),h('footer',null,h('span',null,'DeepSeek V4'),h('div',null,h('button',{className:'send','aria-label':'发送'},'↑')))))));})();
</script></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const path = { '/react.js': join(reactDir, 'umd/react.development.js'), '/react-dom.js': join(reactDomDir, 'umd/react-dom.development.js'), '/client.js': new URL('../client.js', import.meta.url) }[req.url];
    res.setHeader('Content-Type', path ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.end(path ? await readFile(path) : html);
  } catch { res.statusCode = 500; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  const output = new URL('../.artifacts/', import.meta.url); await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.getByRole('button', { name: 'Hooks 待授权' }).waitFor();
  assert.equal(await page.evaluate(() => registeredSlots.includes('conversation.input.right')), false);
  assert.equal(await page.locator('[data-composer-card] [aria-label="管理 Hooks 授权"]').count(), 0);
  assert.equal(await page.getByRole('button', { name: '本会话允许' }).count(), 0);
  const trigger = page.getByRole('button', { name: 'Hooks 待授权' }); const rect = await trigger.boundingBox(); assert(rect.height <= 36 && rect.width < 240);
  async function aligned() {
    const [badge, card] = await Promise.all([page.locator('.dsh-hooks-trigger').boundingBox(), page.locator('[data-composer-card]').boundingBox()]);
    assert(Math.abs(badge.x-card.x)<1, `badge ${badge.x} must align with native input card ${card.x}`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  for (const geometry of [
    { width: 1440, cap:'720px', side:'16px', layout:'normal' },
    { width: 1000, cap:'520px', side:'24px', layout:'normal' },
    { width: 1000, cap:'720px', side:'16px', layout:'hero' },
    { width: 390, cap:'720px', side:'16px', layout:'normal' },
    { width: 390, cap:'min(calc(100% - 16px), 952px)', side:'8px', layout:'embedded' },
  ]) {
    await page.setViewportSize({width:geometry.width,height:760});
    await page.evaluate(g=>{const root=document.getElementById('root');root.style.setProperty('--dsh-composer-card-max-width',g.cap);root.style.setProperty('--dsh-composer-side-clearance',g.side);root.dataset.layout=g.layout;},geometry);
    await aligned();
  }
  await page.setViewportSize({width:1000,height:760});
  await page.evaluate(()=>{const root=document.getElementById('root');root.style.setProperty('--dsh-composer-card-max-width','720px');root.style.setProperty('--dsh-composer-side-clearance','16px');root.dataset.layout='normal';});
  await page.screenshot({ path: new URL('permissions-compact-desktop.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  await trigger.click(); await page.getByRole('dialog', { name: 'Hooks 授权' }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '关闭');
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await page.evaluate(() => answers.length), 0);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Hooks 待授权');
  await trigger.click();
  await page.keyboard.press('Shift+Tab'); assert(await page.evaluate(() => document.activeElement.closest('[role="dialog"]') !== null));
  await page.getByRole('dialog').dispatchEvent('compositionstart'); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 1);
  await page.getByRole('dialog').dispatchEvent('compositionend'); await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: new URL('permissions-desktop.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 760 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: new URL('permissions-mobile.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  const modal = page.getByRole('dialog'); const modalRect = await modal.boundingBox(); assert(modalRect.x >= 0 && modalRect.x + modalRect.width <= 390);
  await page.getByRole('button', { name: '本会话允许', exact: true }).click();
  await page.getByRole('button', { name: '本会话允许', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('textbox', { name: 'message' }).inputValue(), '正在编辑的草稿');
  assert.equal(await page.evaluate(() => answers[0].decision), 'allow-session');
  await page.getByRole('button', { name: '管理 Hooks 授权' }).waitFor();
  assert.equal(await page.locator('.dsh-hooks-trigger').count(), 1); await aligned();
  await page.screenshot({ path: new URL('permissions-allowed.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  await page.getByRole('button', { name: '管理 Hooks 授权' }).click(); await page.getByRole('button', { name: '撤销本会话' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    document.body.setAttribute('data-ds-dark-theme', '');
    requests = [{ id: 'long', schema: 'dsh-hooks/approval-v1', scope: 'session', sessionId: 'preview', cwd: 'D:/work/' + 'long-path-'.repeat(30), fingerprint: 'b'.repeat(64),
      hooks: Array.from({ length: 25 }, (_, i) => ({ event: 'PreToolUse', command: 'node ./' + 'long-script-name-'.repeat(30) + i + '.mjs', source: '.codex/hooks.json' })) }];
  });
  await page.addStyleTag({ content: 'body,.composer{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}textarea{background:transparent}.composer{border-color:var(--dsw-alias-border-l3)}' });
  await page.setViewportSize({ width: 390, height: 600 }); await page.getByRole('button', { name: 'Hooks 待授权' }).click();
  const longModal = await page.getByRole('dialog').boundingBox(); assert(longModal.y >= 0 && longModal.y + longModal.height <= 600);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: new URL('permissions-mobile-dark.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  await page.getByRole('button', { name: '关闭' }).click(); assert.equal(await page.evaluate(() => answers.length), 1);
  await page.evaluate(() => { permissionStatus = { ...requests[0], session:false, permanent:false, approvalPolicy:'never', review:{...requests[0],id:'manual:preview',manual:true} }; requests=[]; });
  await page.getByRole('button', { name: 'Hooks 已跳过' }).waitFor(); assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('textbox', { name:'message' }).fill('未授权时仍可输入和发送');
  await page.screenshot({ path: new URL('permissions-skipped.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  await aligned();
  await page.getByRole('button', { name: 'Hooks 已跳过' }).click(); assert.equal(await page.getByRole('button', { name:'永久允许', exact:true }).count(), 0);
  assert(await page.getByRole('dialog').innerText().then(text=>text.includes('手动授权从后续事件生效')));
  await page.screenshot({ path: new URL('permissions-manual.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  await page.getByRole('button', { name:'本会话允许', exact:true }).click(); assert.equal(await page.evaluate(()=>answers[1].id),'manual:preview');
  await page.evaluate(() => {
    requests=[];permissionStatus={hierarchical:true,policy:{cwd:'D:/work/project',revision:'d'.repeat(64),hooks:[
      {id:'a'.repeat(64),version:'b'.repeat(64),event:'UserPromptSubmit',name:'Recall',command:'node ./recall.mjs',source:'.codex/hooks.json',enabled:true,choice:'inherit',global:'allow',project:'inherit',effective:'allow',from:'global',reviewRequired:false},
      {id:'c'.repeat(64),version:'d'.repeat(64),event:'Stop',name:'Capture',command:'node ./capture.mjs',source:'.codex/hooks.json',enabled:true,choice:'inherit',global:'allow',project:'deny',effective:'deny',from:'project',reviewRequired:false}
    ]}};
  });
  const instance = page.getByRole('button', { name:'Hooks 权限', exact:true }); await instance.waitFor(); await aligned(); await instance.click();
  assert.equal(await page.getByRole('button',{name:'永久允许',exact:true}).count(),0);assert.equal(await page.getByRole('combobox',{name:'权限范围'}).count(),0);
  const recall=page.getByRole('combobox',{name:'Recall 的权限'}); await recall.selectOption('deny');
  await page.getByRole('button',{name:'恢复继承',exact:true}).waitFor();assert((await page.getByRole('dialog').innerText()).includes('本会话'));
  await page.getByRole('button',{name:'恢复继承',exact:true}).click();await page.waitForFunction(()=>instanceAnswers.length===2);
  assert.deepEqual(await page.evaluate(()=>Object.keys(instanceAnswers[0]).sort()),['choice','id','revision','sessionId']);
  assert((await page.getByRole('dialog').innerText()).includes('来自项目'));assert((await page.getByRole('dialog').innerText()).includes('来自全局设置'));
  await page.screenshot({path:new URL('hierarchy-session-mobile-dark.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.evaluate(()=>{ruleFailure='permission disk unavailable';});await recall.selectOption('deny');await page.getByRole('alert').waitFor();
  await page.getByRole('textbox',{name:'message'}).fill('授权异常后草稿仍可输入');await page.getByRole('button',{name:'关闭',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'message'}).inputValue(),'授权异常后草稿仍可输入');
  await page.evaluate(()=>{document.body.removeAttribute('data-ds-dark-theme');ruleFailure=null;});await page.setViewportSize({width:1000,height:760});await aligned();await instance.click();
  await page.screenshot({path:new URL('hierarchy-session-error-desktop.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  await recall.selectOption('deny'); await page.getByRole('button',{name:'恢复继承',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="Recall 的权限"]').value==='inherit');
  await page.getByRole('alert').waitFor({state:'hidden'});
  await page.screenshot({path:new URL('hierarchy-session-desktop.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  assert.deepEqual(errors, []);
  console.log('Browser QA passed with real Harness Modal/Button/theme: compact trigger, desktop/mobile dialog, focus restoration, per-hook instance policies, restore inheritance, isolated failures and retained draft.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
