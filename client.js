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
    function parseRequest(value, sessionId) {
      try {
        if (!value || value.schema !== 'dsh-hooks/approval-v1' || value.scope !== 'session' || value.sessionId !== sessionId || typeof value.id !== 'string'
          || typeof value.cwd !== 'string' || !/^[0-9a-f]{64}$/.test(value.fingerprint) || !Array.isArray(value.hooks)
          || !value.hooks.length || !value.hooks.every(hook => typeof hook.event === 'string' && typeof hook.command === 'string' && typeof hook.source === 'string')) return null;
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
    return {
      inject: ['slots', 'locale', 'remote'],
      async apply(ctx) {
        ctx.effect(() => ctx.locale.register('dsh-hooks', { en, zh }), 'dsh-hooks: permission copy');
        await ctx.remote.$mount({ package: '@simiooo/dsh-hooks', descriptors });
        ctx.inject(['remote.dshHooksPermissions'], scope => {
          const api = scope.remote.dshHooksPermissions;
          const unwrap = result => { if (!result.ok) throw result.error; return result.value; };
          function PermissionDock({ sessionId, t }) {
            const [request, setRequest] = React.useState(null);
            const [offline, setOffline] = React.useState(false);
            React.useEffect(() => {
              let active = true, timer;
              setRequest(null);
              const poll = async () => {
                try {
                  const result = unwrap(await api.list({ sessionId }));
                  if (!active) return;
                  const next = parseRequest(result.requests?.[0], sessionId);
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
                const reply = unwrap(await api.answer({ sessionId, id: request.id, fingerprint: request.fingerprint, decision: outcome === 'allowed-once' ? 'allow-session' : 'deny' }));
                if (!reply.accepted) throw new Error('Hook permission request was withdrawn');
                setRequest(current => current?.id === request.id ? null : current);
              },
            } : null, [request, sessionId]);
            if (!pending) return offline ? h('div', { className: 'dsh-hooks-scope', role: 'status' }, t('disconnected')) : null;
            return h(PermissionPanel, { key: pending.key, pending, request, t });
          }
          function Revoke({ sessionId, t }) {
            const [busy, setBusy] = React.useState(false);
            const [failed, setFailed] = React.useState(false);
            return h('button', { type: 'button', title: failed ? t('failed') : t('revoke'), 'aria-label': t('revoke'), disabled: busy,
              style: { background: 'transparent', color: 'inherit', border: 0, borderRadius: 6, padding: 6, cursor: 'pointer' },
              onClick: async () => { setBusy(true); try { unwrap(await api.revoke({ sessionId })); setFailed(false); } catch { setFailed(true); } finally { setBusy(false); } },
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
