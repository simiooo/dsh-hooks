/* Client factory: React and the composer come from Harness, never from a second app root. */
window.__ModuleLoader__.load({
  id: '@simiooo/dsh-hooks',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const en = {
      waiting: 'Hooks need permission', allow: 'Allow for this session', reject: 'Deny',
      details: 'Review hook commands', scope: 'This session only. File changes require a new review.',
      withdrawn: 'Request withdrawn', failed: 'Could not submit. Try again.', cwd: 'Working directory', revoke: 'Revoke hook permissions', disconnected: 'Hook permission connection unavailable',
    };
    const zh = {
      waiting: 'Hooks 待授权', allow: '本会话允许', reject: '拒绝', details: '查看 Hook 命令',
      scope: '仅限本会话；文件变化后重新授权。', withdrawn: '请求已撤回', failed: '提交失败，请重试。', cwd: '工作目录', revoke: '撤销 Hooks 授权', disconnected: 'Hooks 权限连接不可用',
    };
    Object.assign(en, { hooksTitle: 'Hooks', hooksIntro: 'Lifecycle hooks from configuration and plugins.', learn: 'Learn more', sources: 'From configuration',
      user: 'User configuration', project: 'Project configuration', plugin: 'Plugin configuration', custom: 'Custom configuration', allProjects: 'All projects',
      refresh: 'Refresh hooks', loading: 'Loading…', empty: 'No hook configuration found', hookCount: '{count} hooks', issueCount: '{count} issues',
      close: 'Close', edit: 'Edit configuration', expand: 'Show hook details', collapse: 'Hide hook details', enabled: 'Enabled', unsupported: 'Unsupported by this Harness version',
      hookType: 'Hook type', command: 'Command', timeout: 'Timeout', seconds: '{count}s', matcher: 'Matcher', background: 'Background', yes: 'Yes', no: 'No',
      sourcePath: 'Configuration file', save: 'Save', cancel: 'Cancel', saveFailed: 'Could not save. Try again.', conflict: 'Configuration changed. Reopen it before saving.',
      bounded: 'effective limit: 1–3s', SessionStart: 'When a session starts', UserPromptSubmit: 'When a user submits a prompt', PreToolUse: 'Before tool execution',
      PostToolUse: 'After tool execution', Stop: 'When a turn is about to stop', Interrupt: 'When the user interrupts a turn', SessionEnd: 'When a session ends',
      PreCompact: 'Before conversation compaction', PostCompact: 'After conversation compaction',
      create: 'Create configuration', state: 'Status', eventUnsupported: '{event} is unsupported by this version.', limitIgnored: '{event} cannot emit additionalContext; the limit is ignored.', matcherIgnored: '{event} ignores matcher.',
    });
    Object.assign(zh, { hooksTitle: '钩子', hooksIntro: '配置和插件中的生命周期钩子。', learn: '了解更多', sources: '来自配置',
      user: '用户配置', project: '项目配置', plugin: '插件配置', custom: '自定义配置', allProjects: '所有项目',
      refresh: '刷新钩子', loading: '加载中…', empty: '暂无 Hook 配置', hookCount: '{count} 个钩子', issueCount: '{count} 个问题',
      close: '关闭', edit: '编辑配置', expand: '展开钩子详情', collapse: '收起钩子详情', enabled: '启用', unsupported: '当前 Harness 版本未支持',
      hookType: 'Hook 类型', command: '命令', timeout: '超时', seconds: '{count}秒', matcher: '匹配器', background: '后台运行', yes: '是', no: '否',
      sourcePath: '配置文件', save: '保存', cancel: '取消', saveFailed: '保存失败，请重试。', conflict: '配置已变化，请重新打开后再保存。',
      bounded: '实际限制：1–3秒', SessionStart: '当新会话开始时', UserPromptSubmit: '当用户提交提示时', PreToolUse: '在工具执行之前',
      PostToolUse: '在工具执行之后', Stop: '当回合即将停止时', Interrupt: '当用户中断回合时', SessionEnd: '当会话结束时',
      PreCompact: '在对话压缩之前', PostCompact: '在对话压缩之后',
      create: '创建配置', state: '状态', eventUnsupported: '当前版本未支持 {event}。', limitIgnored: '{event} 不输出上下文，忽略 additionalContextLimit。', matcherIgnored: '{event} 忽略 matcher。',
    });
    const label = (t, key, count) => t(key).replace('{count}', String(count));
    const issueLabel = (t, issue, path) => {
      for (const [pattern, key] of [[/unsupported event (\w+)/i, 'eventUnsupported'], [/ignoring additionalContextLimit for (\w+)/i, 'limitIgnored'], [/ignoring matcher for (\w+)/i, 'matcherIgnored']]) {
        const match = issue.match(pattern); if (match) return t(key).replace('{event}', match[1]);
      }
      return issue.startsWith(path + ': ') ? issue.slice(path.length + 2) : issue;
    };
    const iconPaths = {
      refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3a7 7 0 0 0 11.6-1',
      gear: 'm9 3-1 3-3 1v4l-2 1 2 4 3 1 1 3h5l1-3 3-1 2-4-2-1V7l-3-1-1-3H9Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
      hook: 'M12 9v11M5 13v2a7 7 0 0 0 14 0v-2M3 15l2-2 2 2m10 0 2-2 2 2M15 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
      chevron: 'm9 5 7 7-7 7', down: 'm6 9 6 6 6-6', close: 'm6 6 12 12M18 6 6 18', edit: 'M14 4h6v6m0-6L10 14M9 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-4',
      warning: 'M12 8v5m0 3v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    };
    const icon = (name, size = 18) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: iconPaths[name] }));
    const settingsCss = `
      .dsh-hooks-settings,.dsh-hooks-dialog{--hooks-line:var(--dsw-alias-border-l4,rgba(127,127,127,.2));--hooks-muted:var(--dsw-alias-label-secondary,#777);color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:14px;line-height:1.5}
      .dsh-hooks-settings{width:100%;padding:20px 0;box-sizing:border-box}.dsh-hooks-settings h2{font-size:28px;line-height:1.3;margin:0 0 8px;font-weight:600}.dsh-hooks-settings p{color:var(--hooks-muted);margin:0;font-size:14px}.dsh-hooks-settings a{color:var(--dsw-alias-brand-primary,#2673ed);text-decoration:none;margin-left:8px}
      .dsh-hooks-heading,.dsh-hooks-source,.dsh-hooks-source-main,.dsh-hooks-dialog-head,.dsh-hooks-event-head,.dsh-hooks-item-line,.dsh-hooks-item-actions,.dsh-hooks-editor-footer{display:flex;align-items:center;gap:14px}.dsh-hooks-heading{justify-content:space-between;align-items:flex-start}.dsh-hooks-source-main{min-width:0;flex:1;text-align:left}.dsh-hooks-source-main>span{min-width:0}.dsh-hooks-source-main small,.dsh-hooks-subtitle{display:block;color:var(--hooks-muted);font-size:13px;font-weight:400}.dsh-hooks-settings h3{font-size:15px;font-weight:600;margin:48px 0 18px}.dsh-hooks-source{width:100%;border:1px solid var(--hooks-line);border-radius:18px;background:transparent;color:inherit;padding:17px 20px;margin:12px 0;cursor:pointer;font:inherit}.dsh-hooks-source strong{display:block;font-weight:600}.dsh-hooks-source:hover{background:color-mix(in srgb,currentColor 3%,transparent)}.dsh-hooks-source-issues{display:flex;align-items:center;gap:9px;white-space:nowrap;font-size:13px}.dsh-hooks-source-issues svg{color:#ee6c35}.dsh-hooks-icon{border:0!important;background:transparent!important;color:var(--hooks-muted);width:32px;min-width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;padding:0;cursor:pointer}.dsh-hooks-icon:hover{background:color-mix(in srgb,currentColor 7%,transparent)!important}.dsh-hooks-icon:disabled{opacity:.45;cursor:default}.dsh-hooks-settings :focus-visible,.dsh-hooks-dialog :focus-visible{outline:2px solid Highlight;outline-offset:3px}.dsh-hooks-scope-select{max-width:100%;margin-top:20px;padding:7px 10px;color:inherit;background:transparent;border:1px solid var(--hooks-line);border-radius:8px;font:inherit}.dsh-hooks-notice{font-size:13px;color:var(--hooks-muted);margin:20px 0}.dsh-hooks-management-error{color:var(--dsw-alias-status-error,#bc3723);font-size:13px;margin:12px 0;white-space:pre-wrap;overflow-wrap:anywhere}
      .dsh-hooks-dialog{box-sizing:border-box;width:820px;max-width:calc(100vw - 32px);max-height:90dvh;padding:0;border:1px solid var(--hooks-line);border-radius:22px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#202124);box-shadow:0 16px 60px #0002;overflow:hidden}.dsh-hooks-dialog::backdrop{background:#0003}.dsh-hooks-dialog-head{justify-content:space-between;padding:24px 24px 8px}.dsh-hooks-dialog-title{display:flex;align-items:center;gap:10px;min-width:0}.dsh-hooks-dialog h2{font-size:22px;margin:0;font-weight:600}.dsh-hooks-dialog .dsh-hooks-subtitle{margin:0 24px 14px;overflow-wrap:anywhere}.dsh-hooks-dialog-body{overflow:auto;max-height:calc(90dvh - 120px);padding:0 24px 24px;box-sizing:border-box}.dsh-hooks-issues{border:1px solid #f3bda5;border-radius:14px;padding:12px 14px;margin:0 0 16px;color:var(--hooks-muted);font-size:13px;overflow-wrap:anywhere}.dsh-hooks-issues div+div{margin-top:8px}.dsh-hooks-events{border:1px solid var(--hooks-line);border-radius:18px;overflow:hidden}.dsh-hooks-event-head{padding:16px 20px;border-bottom:1px solid var(--hooks-line)}.dsh-hooks-event-head strong{font-weight:600}.dsh-hooks-event+.dsh-hooks-event{border-top:1px solid var(--hooks-line)}.dsh-hooks-item{margin:0 20px}.dsh-hooks-item+.dsh-hooks-item{border-top:1px solid var(--hooks-line)}.dsh-hooks-item-line{min-height:54px;gap:8px}.dsh-hooks-item-name{font-size:15px;flex:1;min-width:0;overflow-wrap:anywhere}.dsh-hooks-item-actions{gap:2px;flex-shrink:0}.dsh-hooks-switch{corner-shape:round;height:24px;width:40px;min-width:40px;border-radius:20px;border:0;background:#a4a7ae;padding:3px;cursor:pointer;margin-left:6px;display:inline-flex;align-items:center}.dsh-hooks-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary,#3884ff)}.dsh-hooks-switch span{corner-shape:round;display:block;background:white;width:18px;height:18px;border-radius:50%;box-shadow:0 1px 3px #0002;transform:translateX(0)}.dsh-hooks-switch[aria-checked=true] span{transform:translateX(16px)}.dsh-hooks-switch:disabled{opacity:.4;cursor:default}.dsh-hooks-source-location{color:var(--hooks-muted);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:12px 0}.dsh-hooks-details-grid{margin:0 0 12px 30px;padding:14px;border:1px solid var(--hooks-line);border-radius:12px;display:grid;grid-template-columns:82px minmax(0,1fr);gap:10px 14px;font-size:13px}.dsh-hooks-details-grid dt{color:var(--hooks-muted)}.dsh-hooks-details-grid dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.dsh-hooks-details-grid code{font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace}.dsh-hooks-config-editor{box-sizing:border-box;width:100%;height:46dvh;min-height:180px;resize:vertical;padding:14px;border:1px solid var(--hooks-line);border-radius:12px;background:transparent;color:inherit;font:12px/1.7 ui-monospace,Consolas,monospace;tab-size:2}.dsh-hooks-editor-footer{justify-content:flex-end;margin-top:16px}.dsh-hooks-editor-footer button{font:inherit;padding:7px 16px;border:1px solid var(--hooks-line);background:transparent;color:inherit;border-radius:8px;cursor:pointer}.dsh-hooks-editor-footer button:last-child{background:var(--dsw-alias-brand-primary,#3884ff);color:white;border-color:transparent}.dsh-hooks-editor-footer button:disabled{opacity:.45;cursor:default}
      @media(max-width:520px){.dsh-hooks-dialog{max-width:calc(100vw - 16px);border-radius:16px}.dsh-hooks-dialog-head{padding:18px 16px 8px}.dsh-hooks-dialog .dsh-hooks-subtitle{margin-left:16px;margin-right:16px}.dsh-hooks-dialog-body{padding:0 12px 16px}.dsh-hooks-event-head{padding:14px 12px}.dsh-hooks-item{margin:0 12px}.dsh-hooks-item-line{align-items:flex-start;padding:10px 0}.dsh-hooks-item-name{padding-top:5px}.dsh-hooks-source-location{color:var(--hooks-muted);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:12px 0}.dsh-hooks-details-grid{margin-left:0;grid-template-columns:62px minmax(0,1fr);gap:8px}.dsh-hooks-source{padding:14px;gap:8px}.dsh-hooks-source-issues{font-size:12px}.dsh-hooks-settings h3{margin-top:32px}}
    `;
    const iconButton = (name, title, onClick, props = {}) => h('button', { type: 'button', className: 'dsh-hooks-icon', title, 'aria-label': title, onClick, ...props }, icon(name));
    function HooksDialog({ title, subtitle, closeLabel, onClose, children }) {
      const ref = React.useRef(null); const titleId = React.useId();
      React.useEffect(() => {
        const previous = document.activeElement, dialog = ref.current;
        if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
        return () => { if (dialog.close) dialog.close(); if (previous?.isConnected) previous.focus(); };
      }, []);
      return h('dialog', { ref, className: 'dsh-hooks-dialog', 'aria-labelledby': titleId, onCancel: event => { event.preventDefault(); onClose(); }, onClick: event => { if (event.target === ref.current) { const r = ref.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } } },
        h('style', null, settingsCss), h('div', { className: 'dsh-hooks-dialog-head' }, h('div', { className: 'dsh-hooks-dialog-title' }, icon('gear'), h('h2', { id: titleId }, title)), iconButton('close', closeLabel, onClose)),
        h('div', { className: 'dsh-hooks-subtitle' }, subtitle), h('div', { className: 'dsh-hooks-dialog-body' }, children));
    }
    function HooksEditor({ editor, t, onClose, onSave }) {
      const [content, setContent] = React.useState(editor.content), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
      const lock = React.useRef(false), alive = React.useRef(true);
      React.useEffect(() => () => { alive.current = false; }, []);
      const save = async () => {
        if (lock.current) return; lock.current = true; setBusy(true); setError('');
        try { await onSave(content); }
        catch (error) { if (alive.current) { setError(String(error?.message ?? t('saveFailed'))); setBusy(false); lock.current = false; } }
      };
      return h(HooksDialog, { title: t(editor.missing ? 'create' : 'edit'), subtitle: editor.path, closeLabel: t('close'), onClose: busy ? () => {} : onClose },
        h('textarea', { className: 'dsh-hooks-config-editor', 'aria-label': t('sourcePath'), value: content, disabled: busy, spellCheck: false, onChange: event => setContent(event.target.value) }),
        error && h('div', { className: 'dsh-hooks-management-error', role: 'alert' }, error),
        h('div', { className: 'dsh-hooks-editor-footer' }, h('button', { type: 'button', disabled: busy, onClick: onClose }, t('cancel')), h('button', { type: 'button', disabled: busy || content === editor.content, onClick: save }, t('save'))));
    }
    function HooksSettings({ api, t }) {
      const [data, setData] = React.useState(null), [scopeId, setScopeId] = React.useState(''), [sourceId, setSourceId] = React.useState(null);
      const [expanded, setExpanded] = React.useState(new Set()), [editor, setEditor] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
      const lock = React.useRef(false), sequence = React.useRef(0), alive = React.useRef(true), actionError = React.useRef(false);
      const unwrap = reply => { if (!reply.ok) throw new Error(reply.error?.message ?? t('failed')); return reply.value; };
      const errorText = error => String(error?.message ?? t('failed')).includes('Hooks changed') ? t('conflict') : String(error?.message ?? t('failed'));
      React.useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
      React.useEffect(() => {
        let active = true, timer;
        const poll = async () => {
          if (!lock.current) {
            const seq = ++sequence.current;
            try { const next = unwrap(await api.catalog(scopeId ? { scopeId } : {})); if (active && seq === sequence.current) { setData(next); if (!actionError.current) setError(''); } }
            catch (error) { if (active && seq === sequence.current) {
              if (scopeId && String(error?.message).includes('scope is no longer available')) { setScopeId(''); setData(null); setSourceId(null); }
              if (!actionError.current) setError(errorText(error));
            } }
          }
          if (active) timer = setTimeout(poll, 1500);
        };
        void poll(); return () => { active = false; clearTimeout(timer); sequence.current++; };
      }, [api, scopeId]);
      const perform = async operation => {
        if (lock.current) return; lock.current = true; sequence.current++; actionError.current = false; setBusy(true); setError('');
        try { const result = await operation(); if (alive.current && result?.sources) setData(result); return result; }
        catch (error) { actionError.current = true; if (alive.current) setError(errorText(error)); throw error; }
        finally { lock.current = false; sequence.current++; if (alive.current) setBusy(false); }
      };
      const refresh = () => { void perform(async () => unwrap(await api.catalog(scopeId ? { scopeId } : {}))).catch(() => {}); };
      const edit = source => { void perform(async () => { const result = unwrap(await api.readSource({ scopeId: data.scopeId, revision: data.revision, sourceId: source.id })); if (alive.current) setEditor({ ...result, missing: source.missing, sourceId: source.id, scopeId: data.scopeId }); }).catch(() => {}); };
      const source = data?.sources.find(source => source.id === sourceId);
      const save = async content => {
        try { await perform(async () => unwrap(await api.writeSource({ scopeId: editor.scopeId, revision: editor.revision, sourceId: editor.sourceId, content }))); }
        catch (error) { throw new Error(errorText(error)); }
        if (alive.current) setEditor(null);
      };
      const toggle = hook => { void perform(async () => unwrap(await api.setEnabled({ scopeId: data.scopeId, revision: data.revision, id: hook.id, enabled: !hook.enabled }))).catch(() => {}); };
      const expand = id => setExpanded(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
      const field = (key, value) => [h('dt', { key: `${key}-label` }, t(key)), h('dd', { key }, value)];
      return h('section', { className: 'dsh-hooks-settings', 'aria-label': t('hooksTitle') }, h('style', null, settingsCss),
        h('div', { className: 'dsh-hooks-heading' }, h('div', null, h('h2', null, t('hooksTitle')), h('p', null, t('hooksIntro'), h('a', { href: 'https://github.com/simiooo/dsh-hooks#兼容范围', target: '_blank', rel: 'noreferrer' }, t('learn')))), iconButton('refresh', t('refresh'), refresh, { disabled: busy })),
        data?.scopes.length > 1 && h('select', { className: 'dsh-hooks-scope-select', value: data.scopeId, 'aria-label': t('cwd'), disabled: busy || !!editor, onChange: event => { actionError.current = false; setError(''); setScopeId(event.target.value); setData(null); setSourceId(null); setExpanded(new Set()); } }, data.scopes.map(scope => h('option', { key: scope.id, value: scope.id }, scope.cwd))),
        h('h3', null, t('sources')), !data && h('div', { className: 'dsh-hooks-notice', role: 'status' }, error ? t('disconnected') : t('loading')),
        error && h('div', { className: 'dsh-hooks-management-error', role: 'alert' }, error), data?.issues.map((issue, index) => h('div', { key: index, className: 'dsh-hooks-management-error', role: 'status' }, issue)),
        data?.sources.length === 0 && h('div', { className: 'dsh-hooks-notice' }, t('empty')),
        data?.sources.map(source => h('button', { key: source.id, type: 'button', className: 'dsh-hooks-source', onClick: () => setSourceId(source.id) },
          h('span', { className: 'dsh-hooks-source-main' }, icon('gear', 20), h('span', null, h('strong', null, t(source.kind)), h('small', null, label(t, 'hookCount', source.hooks.length)))),
          source.issues.length > 0 && h('span', { className: 'dsh-hooks-source-issues' }, icon('warning', 14), label(t, 'issueCount', source.issues.length)), icon('chevron', 17))),
        editor ? h(HooksEditor, { key: `${editor.sourceId}:${editor.revision}`, editor, t, onClose: () => setEditor(null), onSave: save }) : source && h(HooksDialog, { title: t(source.kind), closeLabel: t('close'), subtitle: source.kind === 'user' ? t('allProjects') : data.scopes.find(scope => scope.id === data.scopeId)?.cwd, onClose: () => setSourceId(null) },
          h('div', { className: 'dsh-hooks-heading' }, h('div', { className: 'dsh-hooks-source-location', title: source.path }, source.path), iconButton('edit', t(source.missing ? 'create' : 'edit'), () => edit(source), { disabled: busy })),
          source.issues.length > 0 && h('div', { className: 'dsh-hooks-issues', role: 'status' }, source.issues.map((issue, index) => h('div', { key: index }, issueLabel(t, issue, source.path)))),
          error && h('div', { className: 'dsh-hooks-management-error', role: 'alert' }, error),
          source.hooks.length === 0 && h('div', { className: 'dsh-hooks-notice' }, t('empty')),
          h('div', { className: 'dsh-hooks-events' }, [...new Set(source.hooks.map(hook => hook.event))].map(event => h('section', { key: event, className: 'dsh-hooks-event' },
            h('div', { className: 'dsh-hooks-event-head' }, icon('hook'), h('div', null, h('strong', null, event), h('div', { className: 'dsh-hooks-subtitle', style: { margin: 0 } }, ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd', 'PreCompact', 'PostCompact'].includes(event) ? t(event) : t('unsupported')))),
            source.hooks.filter(hook => hook.event === event).map((hook, index) => h('div', { key: hook.id, className: 'dsh-hooks-item' },
              h('div', { className: 'dsh-hooks-item-line' }, h('span', { className: 'dsh-hooks-item-name' }, `${index + 1} - ${hook.name}`), h('div', { className: 'dsh-hooks-item-actions' },
                iconButton('edit', `${t('edit')} · ${hook.name}`, () => edit(source), { disabled: busy }),
                iconButton('down', expanded.has(hook.id) ? t('collapse') : t('expand'), () => expand(hook.id), { 'aria-expanded': expanded.has(hook.id), 'aria-controls': `dsh-hook-${hook.id}`, style: { transform: expanded.has(hook.id) ? 'rotate(180deg)' : undefined } }),
                h('button', { type: 'button', role: 'switch', className: 'dsh-hooks-switch', 'aria-checked': hook.enabled, 'aria-label': `${t('enabled')} ${hook.name}`, title: hook.supported ? `${t('enabled')} ${hook.name}` : t('unsupported'), disabled: busy || !hook.supported, onClick: () => toggle(hook) }, h('span')))),
              expanded.has(hook.id) && h('dl', { className: 'dsh-hooks-details-grid', id: `dsh-hook-${hook.id}` },
                ...field('hookType', hook.event), ...field('command', h('code', null, hook.command)), ...field('timeout', `${label(t, 'seconds', hook.timeout)}${['Interrupt', 'SessionEnd'].includes(event) ? ` · ${t('bounded')}` : ''}`),
                ...(hook.matcher ? field('matcher', hook.matcher) : []), ...field('background', t(hook.async ? 'yes' : 'no')), ...(hook.problem ? field('state', issueLabel(t, hook.problem, source.path)) : [])))))))));
    }
    function parseRequest(value, sessionId) {
      try {
        if (!value || value.schema !== 'dsh-hooks/approval-v1' || value.scope !== 'session' || value.sessionId !== sessionId || typeof value.id !== 'string' || !value.id
          || typeof value.cwd !== 'string' || typeof value.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(value.fingerprint) || !Array.isArray(value.hooks)
          || !value.hooks.length || !value.hooks.every(hook => hook && ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd'].includes(hook.event) && typeof hook.command === 'string' && hook.command.trim() && typeof hook.source === 'string')) return null;
        return value;
      } catch { return null; }
    }
    const css = `
      .dsh-hooks-permission{color:inherit;border-bottom:1px solid color-mix(in srgb,currentColor 16%,transparent);padding:12px 0;margin-bottom:10px;font-size:13px}
      .dsh-hooks-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .dsh-hooks-title{display:flex;align-items:center;gap:8px;min-width:0;flex:1;font-weight:600}
      .dsh-hooks-count{font-size:11px;font-weight:500;padding:2px 6px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:20px}
      .dsh-hooks-actions{display:flex;gap:8px;align-items:center}
      .dsh-hooks-permission button{font:inherit;color:inherit;background:transparent;border:1px solid color-mix(in srgb,currentColor 24%,transparent);border-radius:8px;min-height:32px;padding:5px 10px;cursor:pointer}
      .dsh-hooks-permission button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
      .dsh-hooks-permission button:focus-visible,.dsh-hooks-details:focus-visible{outline:2px solid Highlight;outline-offset:3px}
      .dsh-hooks-permission button:disabled{opacity:.5;cursor:default}
      .dsh-hooks-permission .dsh-hooks-allow{background:var(--accent,#3155d9);border-color:transparent;color:#fff}
      .dsh-hooks-permission .dsh-hooks-allow:hover{filter:brightness(1.1)}
      .dsh-hooks-permission .dsh-hooks-details-button{padding:5px;min-width:32px;line-height:0}
      .dsh-hooks-scope{margin-top:8px;font-size:12px;opacity:.72}
      .dsh-hooks-details{max-height:min(35vh,320px);overflow:auto;margin-top:12px;border-top:1px solid color-mix(in srgb,currentColor 16%,transparent);padding-top:10px}
      .dsh-hooks-command{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;margin:6px 0 10px}
      .dsh-hooks-source{font-size:11px;opacity:.7;overflow-wrap:anywhere}
      .dsh-hooks-hook+.dsh-hooks-hook{border-top:1px solid color-mix(in srgb,currentColor 12%,transparent);padding-top:10px;margin-top:10px}
      .dsh-hooks-error{margin-top:8px;color:var(--text-danger,#b42318)}
      @media(max-width:480px){.dsh-hooks-actions{width:100%;justify-content:flex-end}.dsh-hooks-details{max-height:28vh}}
    `;
    function PermissionPanel({ pending, request, t }) {
      const [expanded, setExpanded] = React.useState(false);
      const [submitting, setSubmitting] = React.useState(false);
      const [error, setError] = React.useState('');
      const lock = React.useRef(false);
      const active = React.useRef(true);
      const detailsId = React.useId();
      React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
      const answer = async outcome => {
        if (lock.current || !pending.answerable) return;
        lock.current = true; setSubmitting(true); setError('');
        try { await pending.answer(outcome); }
        catch { if (active.current) { lock.current = false; setSubmitting(false); setError(t('failed')); } }
      };
      const disabled = submitting || !pending.answerable;
      return h('section', {
        className: 'dsh-hooks-permission', 'aria-label': t('waiting'), 'aria-busy': submitting,
        onMouseDown: event => event.stopPropagation(),
        onKeyDown: event => {
          // No global Enter handler: typing or IME input must never grant permission.
          if (event.key === 'Escape' && !event.nativeEvent?.isComposing && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault(); event.stopPropagation(); void answer('rejected');
          }
        },
      }, h('style', null, css),
      h('div', { className: 'dsh-hooks-row' },
        h('div', { className: 'dsh-hooks-title', role: 'status' },
          h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
            h('path', { d: 'M12 3 4.5 6v5.5c0 4.4 3 7.8 7.5 9.5 4.5-1.7 7.5-5.1 7.5-9.5V6L12 3Z' }), h('path', { d: 'M12 8v5m0 3v.1' })),
          h('span', null, pending.answerable ? t('waiting') : t('withdrawn')),
          h('span', { className: 'dsh-hooks-count', title: request.fingerprint.slice(0, 12) }, request.hooks.length)),
        h('div', { className: 'dsh-hooks-actions' },
          h('button', { type: 'button', className: 'dsh-hooks-details-button', title: t('details'), 'aria-label': t('details'), 'aria-expanded': expanded, 'aria-controls': detailsId, onClick: () => setExpanded(!expanded) },
            h('svg', { viewBox: '0 0 20 20', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true, style: { transform: expanded ? 'rotate(180deg)' : undefined } }, h('path', { d: 'm5 7.5 5 5 5-5' }))),
          h('button', { type: 'button', disabled, onClick: () => { void answer('rejected'); } }, t('reject')),
          h('button', { type: 'button', className: 'dsh-hooks-allow', disabled, onClick: () => { void answer('allowed-once'); } }, t('allow')))),
      h('div', { className: 'dsh-hooks-scope' }, t('scope')),
      expanded && h('div', { id: detailsId, className: 'dsh-hooks-details', tabIndex: 0 },
        h('div', { className: 'dsh-hooks-source' }, `${t('cwd')}: ${request.cwd}`),
        request.hooks.map((hook, index) => h('div', { className: 'dsh-hooks-hook', key: index },
          h('strong', null, hook.statusMessage || hook.event),
          h('pre', { className: 'dsh-hooks-command' }, hook.command),
          h('div', { className: 'dsh-hooks-source' }, `${hook.event} · ${hook.source}`)))),
      error && h('div', { className: 'dsh-hooks-error', role: 'alert' }, error));
    }
    const descriptors = ['list', 'answer', 'revoke'].map(method => ({
      id: `@simiooo/dsh-hooks#permissions.${method}`, service: 'dshHooksPermissions', namespace: 'dshHooksPermissions', method,
      invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: {
        mode: 'strict', typeSymbol: `@simiooo/dsh-hooks#${method}Input`,
        create: () => ({ parse(value) {
          const keys = method === 'answer' ? ['sessionId', 'id', 'fingerprint', 'decision'] : ['sessionId'];
          if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))
            || keys.some(k => typeof value[k] !== 'string' || !value[k])
            || (method === 'answer' && (!/^[a-f0-9]{64}$/.test(value.fingerprint) || !['allow-session', 'deny'].includes(value.decision)))) throw new TypeError('Invalid hook permission request');
          return value;
        } }),
      } }], result: { mode: 'src-json' },
    }));
    const managementKeys = { catalog: [], setEnabled: ['scopeId', 'revision', 'id', 'enabled'], readSource: ['scopeId', 'revision', 'sourceId'], writeSource: ['scopeId', 'revision', 'sourceId', 'content'] };
    for (const [method, required] of Object.entries(managementKeys)) descriptors.push({
      id: `@simiooo/dsh-hooks#management.${method}`, service: 'dshHooksManagement', namespace: 'dshHooksManagement', method, invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: `@simiooo/dsh-hooks#${method}Input`, create: () => ({ parse(value) {
        const keys = method === 'catalog' ? ['scopeId'] : required;
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))
          || required.some(key => key === 'enabled' ? typeof value[key] !== 'boolean' : typeof value[key] !== 'string')
          || (method === 'catalog' && value.scopeId !== undefined && typeof value.scopeId !== 'string')) throw new TypeError('Invalid hooks management request');
        return value;
      } }) } }], result: { mode: 'src-json' },
    });
    return {
      inject: ['slots', 'locale', 'remote'],
      async apply(ctx) {
        ctx.effect(() => ctx.locale.register('dsh-hooks', { en, zh }), 'dsh-hooks: permission copy');
        await ctx.remote.$mount({ package: '@simiooo/dsh-hooks', descriptors });
        ctx.inject(['remote.dshHooksManagement'], scope => {
          function HooksSection({ subject, t }) {
            return (subject?.kind === 'bundle' || subject?.kind === 'row') && subject.pkg?.name === '@simiooo/dsh-hooks'
              ? h(HooksSettings, { api: scope.remote.dshHooksManagement, t }) : null;
          }
          scope.slots.inject('plugins.detail.section', () => scope.slots.register({ name: 'plugins.detail.section', id: 'dsh-hooks-settings', order: 0, locale: 'dsh-hooks' }, HooksSection));
        });
        ctx.inject(['remote.dshHooksPermissions'], scope => {
          const api = scope.remote.dshHooksPermissions;
          const unwrap = result => { if (!result.ok) throw result.error; return result.value; };
          function PermissionDock({ sessionId, t }) {
            return h(SessionPermissionDock, { key: sessionId, sessionId, t });
          }
          function SessionPermissionDock({ sessionId, t }) {
            const [request, setRequest] = React.useState(null);
            const [offline, setOffline] = React.useState(false);
            const settled = React.useRef(new Set());
            React.useEffect(() => {
              let active = true, timer;
              setRequest(null);
              const poll = async () => {
                try {
                  const result = unwrap(await api.list({ sessionId }));
                  if (!active) return;
                  const next = (result.requests ?? []).map(row => parseRequest(row, sessionId)).find(row => row && !settled.current.has(row.id)) ?? null;
                  setRequest(current => current?.id === next?.id ? current : next); setOffline(false);
                } catch { if (active) { setOffline(true); setRequest(null); } }
                finally { if (active) timer = setTimeout(poll, 500); }
              };
              void poll();
              return () => { active = false; clearTimeout(timer); };
            }, [sessionId]);
            const pending = React.useMemo(() => request ? {
              key: request.id, answerable: true,
              async answer(outcome) {
                unwrap(await api.answer({ sessionId, id: request.id, fingerprint: request.fingerprint, decision: outcome === 'allowed-once' ? 'allow-session' : 'deny' }));
                // A withdrawn/answered request is final. Ignore stale in-flight list responses.
                settled.current.add(request.id);
                if (settled.current.size > 512) settled.current.delete(settled.current.values().next().value);
                setRequest(current => current?.id === request.id ? null : current);
              },
            } : null, [request, sessionId]);
            if (!pending) return offline ? h('div', { className: 'dsh-hooks-scope', role: 'status' }, t('disconnected')) : null;
            return h(PermissionPanel, { key: pending.key, pending, request, t });
          }
          function Revoke({ sessionId, t }) {
            return h(SessionRevoke, { key: sessionId, sessionId, t });
          }
          function SessionRevoke({ sessionId, t }) {
            const [busy, setBusy] = React.useState(false);
            const [failed, setFailed] = React.useState(false);
            const lock = React.useRef(false);
            return h('button', { type: 'button', title: failed ? t('failed') : t('revoke'), 'aria-label': t('revoke'), disabled: busy,
              style: { background: 'transparent', color: 'inherit', border: 0, borderRadius: 6, padding: 6, cursor: 'pointer' },
              onClick: async () => { if (lock.current) return; lock.current = true; setBusy(true); try { unwrap(await api.revoke({ sessionId })); setFailed(false); } catch { setFailed(true); } finally { lock.current = false; setBusy(false); } },
            }, h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
              h('path', { d: 'M12 3 4.5 6v5.5c0 4.4 3 7.8 7.5 9.5 4.5-1.7 7.5-5.1 7.5-9.5V6L12 3Z' }), h('path', { d: 'm9 9 6 6m0-6-6 6' })));
          }
          scope.slots.inject('conversation.input.dock', () => scope.slots.register({ name: 'conversation.input.dock', id: 'dsh-hooks', order: -20, locale: 'dsh-hooks' }, PermissionDock));
          scope.slots.inject('conversation.input.right', () => scope.slots.register({ name: 'conversation.input.right', id: 'dsh-hooks-revoke', order: -20, locale: 'dsh-hooks' }, Revoke));
        });
      },
    };
  },
});
