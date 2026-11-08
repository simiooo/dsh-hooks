var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { randomUUID } from 'node:crypto';
import { EVENTS, object } from './protocol.js';
export function isPermissionRequest(value) {
    return object(value) && value.schema === 'dsh-hooks/approval-v1' && value.scope === 'session'
        && typeof value.sessionId === 'string' && !!value.sessionId && typeof value.cwd === 'string'
        && typeof value.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.fingerprint)
        && Array.isArray(value.hooks) && value.hooks.length > 0 && value.hooks.every(hook => object(hook)
        && EVENTS.includes(hook.event) && typeof hook.command === 'string' && !!hook.command.trim()
        && typeof hook.source === 'string' && (hook.statusMessage === undefined || typeof hook.statusMessage === 'string'));
}
export async function installPermissionApi(ctx, actions) {
    const { TypertRemoteService, Remote } = await import('@deepseek-ai/dsh-typert-protocol');
    const pending = new Map();
    const sessionId = (request) => {
        if (!object(request) || typeof request.sessionId !== 'string' || !request.sessionId)
            throw new TypeError('sessionId is required');
        return request.sessionId;
    };
    const resources = { session: (request) => sessionId(request) };
    let HooksPermissions = (() => {
        let _classSuper = TypertRemoteService;
        let _instanceExtraInitializers = [];
        let _list_decorators;
        let _answer_decorators;
        let _revoke_decorators;
        let _status_decorators;
        let _forget_decorators;
        return class HooksPermissions extends _classSuper {
            static {
                const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
                _list_decorators = [Remote({ resources })];
                _answer_decorators = [Remote({ resources })];
                _revoke_decorators = [Remote({ resources })];
                _status_decorators = [Remote({ resources })];
                _forget_decorators = [Remote({ resources })];
                __esDecorate(this, null, _list_decorators, { kind: "method", name: "list", static: false, private: false, access: { has: obj => "list" in obj, get: obj => obj.list }, metadata: _metadata }, null, _instanceExtraInitializers);
                __esDecorate(this, null, _answer_decorators, { kind: "method", name: "answer", static: false, private: false, access: { has: obj => "answer" in obj, get: obj => obj.answer }, metadata: _metadata }, null, _instanceExtraInitializers);
                __esDecorate(this, null, _revoke_decorators, { kind: "method", name: "revoke", static: false, private: false, access: { has: obj => "revoke" in obj, get: obj => obj.revoke }, metadata: _metadata }, null, _instanceExtraInitializers);
                __esDecorate(this, null, _status_decorators, { kind: "method", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers);
                __esDecorate(this, null, _forget_decorators, { kind: "method", name: "forget", static: false, private: false, access: { has: obj => "forget" in obj, get: obj => obj.forget }, metadata: _metadata }, null, _instanceExtraInitializers);
                if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            }
            constructor() {
                super(ctx, 'dshHooksPermissions');
                __runInitializers(this, _instanceExtraInitializers);
            }
            owner() {
                const invocation = this.ctx.invocation;
                if (invocation?.peer?.principal?.kind !== 'owner' || invocation.peer.interactions !== 'answer')
                    throw new Error('Only the interactive Host owner may review executable hooks');
            }
            async list(request) {
                this.owner();
                const id = sessionId(request);
                return { requests: [...pending.values()].filter(p => p.request.sessionId === id).map(p => ({ ...p.request, id: p.id })), status: await actions.status(id) };
            }
            async answer(request) {
                this.owner();
                const sid = sessionId(request);
                if (!object(request) || typeof request.id !== 'string' || !request.id || typeof request.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(request.fingerprint) || typeof request.decision !== 'string' || !['allow-session', 'allow-permanent', 'deny'].includes(request.decision))
                    throw new TypeError('invalid hook decision');
                const entry = pending.get(request.id);
                if (!entry || entry.request.sessionId !== sid || entry.request.fingerprint !== request.fingerprint)
                    return { accepted: false };
                return { accepted: await entry.finish(request.decision) };
            }
            revoke(request) {
                this.owner();
                actions.revoke(sessionId(request));
                return { revoked: true };
            }
            status(request) {
                this.owner();
                return actions.status(sessionId(request));
            }
            async forget(request) {
                this.owner();
                await actions.forget(sessionId(request));
                return { revoked: true };
            }
        };
    })();
    new HooksPermissions();
    ctx.on('approval/request', (native, next) => {
        if (native.toolName !== 'dsh-hooks')
            return next();
        let request;
        try {
            request = JSON.parse(native.reason);
        }
        catch {
            return next();
        }
        if (!isPermissionRequest(request) || request.sessionId !== native.agent?.id)
            return next();
        const review = request;
        return new Promise(resolve => {
            const id = randomUUID();
            let saving = false;
            const settle = (allowed) => {
                if (!pending.delete(id))
                    return;
                native.signal?.removeEventListener('abort', abort);
                resolve(allowed ? 'allowed-once' : 'rejected');
            };
            const finish = async (decision) => {
                if (!pending.has(id) || saving)
                    return false;
                saving = true;
                try {
                    if (decision === 'allow-permanent')
                        await actions.remember(review, native.signal);
                    if (!pending.has(id) || native.signal?.aborted)
                        return false;
                    settle(decision !== 'deny');
                    return true;
                }
                finally {
                    saving = false;
                }
            };
            const abort = () => settle(false);
            pending.set(id, { id, request: review, finish, cancel: abort });
            native.signal?.addEventListener('abort', abort, { once: true });
            if (native.signal?.aborted)
                abort();
        });
    }, { prepend: true });
    ctx.effect(() => () => { for (const entry of [...pending.values()])
        entry.cancel(); }, 'dsh-hooks: withdraw permission requests');
}
//# sourceMappingURL=permissions.js.map