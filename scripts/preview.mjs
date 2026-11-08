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
<style>${native.css}button{font-family:inherit}.native-modal-body{min-width:0}</style><script src="/react.js"></script><script src="/react-dom.js"></script><script>${native.js}</script><script>window.__ModuleLoader__={load(def){window.hooksPlugin=def.factory(name=>name==='react'?React:hooksUi)}};</script><script src="/client.js"></script>
<script>
const h=React.createElement; let Dock, Revoke; window.answers=[];window.forgotten=[];
let requests=[{id:'preview',schema:'dsh-hooks/approval-v1',scope:'session',sessionId:'preview',cwd:'D:/work/project',fingerprint:'a'.repeat(64),hooks:[
{event:'SessionStart',statusMessage:'加载项目上下文',command:'node ./hooks/context.mjs',source:'.codex/hooks.json'},
{event:'PreToolUse',statusMessage:'检查待执行命令',command:'node ./hooks/guard.mjs',source:'.codex/hooks.json'}]}];
const ctx={effect:fn=>fn(),inject:(_keys,fn)=>fn(ctx),locale:{register:(_ns,dict)=>{window.t=k=>dict.zh[k];return()=>{}}},slots:{inject:(_name,fn)=>fn(),register:(spec,Comp)=>{if(spec.name==='conversation.input.dock')Dock=Comp;else if(spec.name==='conversation.input.right')Revoke=Comp;return()=>{}}},remote:{$mount:async()=>()=>{},dshHooksPermissions:{list:async()=>({ok:true,value:{requests}}),answer:async request=>{answers.push(request);requests=[];return{ok:true,value:{accepted:true}}},status:async()=>({ok:true,value:{permanent:true,cwd:'D:/work/project',session:true}}),forget:async request=>{forgotten.push(request);return{ok:true,value:{revoked:true}}},revoke:async()=>({ok:true,value:{revoked:true}})}}};
(async()=>{await hooksPlugin.apply(ctx);ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment,null,h(Dock,{sessionId:'preview',t}),h('div',{className:'composer'},h('textarea',{'aria-label':'message',placeholder:'发送消息',rows:2,defaultValue:'正在编辑的草稿'}),h('footer',null,h('span',null,'DeepSeek V4'),h('div',null,h(Revoke,{sessionId:'preview',t}),h('button',{className:'send','aria-label':'发送'},'↑'))))));})();
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
  assert.equal(await page.getByRole('button', { name: '本会话允许' }).count(), 0);
  const trigger = page.getByRole('button', { name: 'Hooks 待授权' }); const rect = await trigger.boundingBox(); assert(rect.height <= 36 && rect.width < 240);
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
  await page.getByRole('button', { name: '永久允许', exact: true }).click();
  await page.getByRole('button', { name: '永久允许', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('textbox', { name: 'message' }).inputValue(), '正在编辑的草稿');
  assert.equal(await page.evaluate(() => answers[0].decision), 'allow-permanent');
  await page.getByRole('button', { name: '管理 Hooks 授权' }).click(); await page.getByRole('button', { name: '撤销永久允许' }).click();
  assert.equal(await page.evaluate(() => forgotten[0].sessionId), 'preview');
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
  assert.deepEqual(errors, []);
  console.log('Browser QA passed with real Harness Modal/Button/theme: compact trigger, desktop/mobile dialog, focus restoration, permanent approval, revoke and retained draft.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
