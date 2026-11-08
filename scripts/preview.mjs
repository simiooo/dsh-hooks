/** Component visual QA in a real browser. The surrounding composer is a fixture, not a running Harness. */
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const reactDir = dirname(require.resolve('react/package.json'));
const reactDomDir = dirname(require.resolve('react-dom/package.json'));
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hooks component QA</title>
<style>*{box-sizing:border-box}body{margin:0;font:14px/1.5 "Segoe UI",sans-serif;background:#f7f8fb;color:#20232b}main{max-width:780px;margin:40px auto;padding:24px}header{font-size:18px;font-weight:600;margin-bottom:180px}.composer{background:#fff;padding:16px;border:1px solid #d9dde8;border-radius:16px;box-shadow:0 8px 32px #20232b09}textarea{width:100%;border:0;resize:none;padding:10px 0;color:inherit;font:inherit;outline:none}footer{display:flex;align-items:center;justify-content:space-between;color:#636a7b;font-size:12px}.send{background:#3155d9;color:white;border:0;border-radius:50%;width:32px;height:32px}@media(max-width:480px){main{padding:16px;margin:16px auto}header{margin-bottom:100px}}</style>
<main><header>DeepSeek Harness · Hooks</header><div class="composer" id="root"></div></main>
<script src="/react.js"></script><script src="/react-dom.js"></script><script>window.__ModuleLoader__={load(def){window.hooksPlugin=def.factory(()=>React)}};</script><script src="/client.js"></script>
<script>
const h=React.createElement; let Dock, Revoke; window.answers=[];
let requests=[{id:'preview',schema:'dsh-hooks/approval-v1',scope:'session',sessionId:'preview',cwd:'D:/work/project',fingerprint:'a'.repeat(64),hooks:[
{event:'SessionStart',statusMessage:'加载项目上下文',command:'node ./hooks/context.mjs',source:'.codex/hooks.json'},
{event:'PreToolUse',statusMessage:'检查待执行命令',command:'node ./hooks/guard.mjs',source:'.codex/hooks.json'}]}];
const ctx={effect:fn=>fn(),inject:(_keys,fn)=>fn(ctx),locale:{register:(_ns,dict)=>{window.t=k=>dict.zh[k];return()=>{}}},slots:{inject:(_name,fn)=>fn(),register:(spec,Comp)=>{if(spec.name==='conversation.input.dock')Dock=Comp;else Revoke=Comp;return()=>{}}},remote:{$mount:async()=>()=>{},dshHooksPermissions:{list:async()=>({ok:true,value:{requests}}),answer:async request=>{answers.push(request);requests=[];return{ok:true,value:{accepted:true}}},revoke:async()=>({ok:true,value:{revoked:true}})}}};
(async()=>{await hooksPlugin.apply(ctx);ReactDOM.createRoot(document.getElementById('root')).render(h(React.Fragment,null,h(Dock,{sessionId:'preview',t}),h('textarea',{'aria-label':'message',placeholder:'发送消息',rows:2,defaultValue:'正在编辑的草稿'}),h('footer',null,h('span',null,'DeepSeek V4'),h('div',null,h(Revoke,{sessionId:'preview',t}),h('button',{className:'send','aria-label':'发送'},'↑')))));})();
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
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.getByRole('button', { name: '本会话允许' }).waitFor();
  await page.getByRole('button', { name: '查看 Hook 命令' }).click();
  await page.screenshot({ path: new URL('permissions-desktop.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 760 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: new URL('permissions-mobile.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  await page.getByRole('button', { name: '本会话允许' }).click();
  await page.getByRole('button', { name: '本会话允许' }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('textbox', { name: 'message' }).inputValue(), '正在编辑的草稿');
  assert.equal(await page.evaluate(() => answers[0].decision), 'allow-session');
  assert.deepEqual(errors, []);
  console.log('Browser component QA passed: desktop, narrow viewport, expanded details, session approval, retained draft.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
