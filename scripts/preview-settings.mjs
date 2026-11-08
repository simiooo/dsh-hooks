/** Real browser + real local management store. The outer plugin page is a fixture. */
import http from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { HooksManagement } from '../dist/management.js';

const require = createRequire(import.meta.url), dir = await mkdtemp(join(tmpdir(), 'dsh settings browser ')), home = join(dir, 'home');
await mkdir(home); await mkdir(join(dir, '.git'));
const file = join(home, 'hooks.json');
const handler = (command, statusMessage, extra = {}) => ({ type: 'command', command, statusMessage, timeout: 600, ...extra });
await writeFile(file, JSON.stringify({ hooks: {
  PreCompact: [{ hooks: [handler('node ./capture.mjs', 'Nuto · Capture memory before compaction')] }],
  PostCompact: [{ hooks: [handler('node ./refresh.mjs', 'Nuto · Refresh memory state after compaction')] }],
  SessionStart: [{ hooks: [handler('node ./context.mjs', 'Nuto · Restore memory after compaction')] }],
  UserPromptSubmit: [{ hooks: [handler('node ./recall.mjs', 'Nuto · Recall memory before prompt')] }],
  Stop: [{ hooks: [handler('node ./stop.mjs', 'Nuto · Capture verified progress', { additionalContextLimit: 2000 })] }],
} }, null, 2));
const manager = new HooksManagement({ codexHome: home, controlsPath: join(dir, 'controls.json'), shellFlavor: 'posix' }, () => [dir], async () => {});
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hook settings QA</title>
<style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#202124;font:14px/1.5 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:960px;margin:40px auto;padding:24px}nav{font-size:13px;color:#777;margin-bottom:28px}nav span{color:#222;margin-left:12px}@media(max-width:520px){main{margin:16px auto;padding:16px}}</style>
<main><nav>插件<span>DSH Hooks</span></nav><div id="root"></div></main>
<script src="/react.js"></script><script src="/react-dom.js"></script><script>window.__ModuleLoader__={load(def){window.hooksPlugin=def.factory(()=>React)}};</script><script src="/client.js"></script>
<script>let Settings;const api=Object.fromEntries(['catalog','setEnabled','readSource','writeSource'].map(method=>[method,async request=>{const reply=await fetch('/api/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});return reply.json();}]));
const ctx={effect:fn=>fn(),inject:(_keys,fn)=>fn(ctx),locale:{register:(_ns,dict)=>{window.t=k=>dict.zh[k];return()=>{}}},slots:{inject:(_name,fn)=>fn(),register:(spec,Comp)=>{if(spec.name==='plugins.detail.section')Settings=Comp;return()=>{}}},remote:{$mount:async()=>()=>{},dshHooksManagement:api}};
(async()=>{await hooksPlugin.apply(ctx);ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Settings,{subject:{kind:'bundle',pkg:{name:'@simiooo/dsh-hooks'}},t}));})();</script></html>`;
const react = dirname(require.resolve('react/package.json')), reactDom = dirname(require.resolve('react-dom/package.json'));
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body), method = req.url.slice(5);
      const result = method === 'catalog' ? await manager.catalog(input.scopeId)
        : method === 'setEnabled' ? await manager.setEnabled(input.scopeId, input.revision, input.id, input.enabled)
        : method === 'readSource' ? await manager.readSource(input.scopeId, input.revision, input.sourceId)
        : method === 'writeSource' ? await manager.writeSource(input.scopeId, input.revision, input.sourceId, input.content) : null;
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, value: result })); return;
    }
    const path = { '/react.js': join(react, 'umd/react.development.js'), '/react-dom.js': join(reactDom, 'umd/react-dom.development.js'), '/client.js': new URL('../client.js', import.meta.url) }[req.url];
    res.setHeader('Content-Type', path ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8'); res.end(path ? await readFile(path) : html);
  } catch (error) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: { message: error.message } })); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  const output = fileURLToPath(new URL('../.artifacts/', import.meta.url)); await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 1179, height: 850 } }); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const source = page.getByRole('button', { name: /用户配置/ }); await source.waitFor();
  assert((await source.textContent()).includes('5 个钩子')); assert((await source.textContent()).includes('3 个问题'));
  await page.screenshot({ path: join(output, 'settings-overview.png'), fullPage: true });
  await source.click(); await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '展开钩子详情', exact: true }).first().click();
  assert.equal(await page.getByRole('switch').first().isDisabled(), true);
  await page.screenshot({ path: join(output, 'settings-detail-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth));
  await page.screenshot({ path: join(output, 'settings-detail-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert(await source.evaluate(element => document.activeElement === element));
  await source.click(); const toggle = page.getByRole('switch', { name: '启用 Nuto · Restore memory after compaction' });
  await toggle.click(); await page.waitForFunction(() => document.querySelector('[role=switch][aria-label="启用 Nuto · Restore memory after compaction"]').getAttribute('aria-checked') === 'false');
  assert.equal((await manager.catalog()).sources[0].hooks.find(h => h.event === 'SessionStart').enabled, false);
  await page.getByRole('button', { name: '编辑配置', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '配置文件' }); await editor.waitFor(); await editor.fill((await editor.inputValue()).replace('node ./context.mjs', 'node ./revised-context.mjs'));
  await page.screenshot({ path: join(output, 'settings-editor-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '保存', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
  assert((await readFile(file, 'utf8')).includes('node ./revised-context.mjs')); assert.deepEqual(errors, []);
  console.log('Settings browser QA passed: overview, issues, event details, unsupported controls, narrow layout, native Escape/focus restore, persistent switch, source edit.');
} finally { await browser?.close(); await new Promise(r => server.close(r)); await manager.dispose(); await rm(dir, { recursive: true, force: true }); }
