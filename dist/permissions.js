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
import { object } from './protocol.js';
/** Host-side human permission queue, exported only through Harness's authenticated Typert Gateway. */
export async function installPermissionApi(ctx, revoke) {
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
        return class HooksPermissions extends _classSuper {
            static {
                const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
                _list_decorators = [Remote({ resources })];
                _answer_decorators = [Remote({ resources })];
                _revoke_decorators = [Remote({ resources })];
                __esDecorate(this, null, _list_decorators, { kind: "method", name: "list", static: false, private: false, access: { has: obj => "list" in obj, get: obj => obj.list }, metadata: _metadata }, null, _instanceExtraInitializers);
                __esDecorate(this, null, _answer_decorators, { kind: "method", name: "answer", static: false, private: false, access: { has: obj => "answer" in obj, get: obj => obj.answer }, metadata: _metadata }, null, _instanceExtraInitializers);
                __esDecorate(this, null, _revoke_decorators, { kind: "method", name: "revoke", static: false, private: false, access: { has: obj => "revoke" in obj, get: obj => obj.revoke }, metadata: _metadata }, null, _instanceExtraInitializers);
                if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            }
            constructor() {
                super(ctx, 'dshHooksPermissions');
                __runInitializers(this, _instanceExtraInitializers);
            }
            owner() {
                const invocation = this.ctx.invocation;
                if (!invocation || invocation.peer.principal.kind !== 'owner' || invocation.peer.interactions !== 'answer')
                    throw new Error('Only the interactive Host owner may review executable hooks');
            }
            list(request) {
                this.owner();
                const id = sessionId(request);
                return { requests: [...pending.values()].filter(p => p.request.sessionId === id).map(p => ({ ...p.request, id: p.id })) };
            }
            answer(request) {
                this.owner();
                const sid = sessionId(request);
                if (!object(request) || typeof request.id !== 'string' || typeof request.fingerprint !== 'string' || !['allow-session', 'deny'].includes(String(request.decision)))
                    throw new TypeError('invalid hook decision');
                const entry = pending.get(request.id);
                if (!entry || entry.request.sessionId !== sid || entry.request.fingerprint !== request.fingerprint)
                    return { accepted: false };
                entry.finish(request.decision === 'allow-session');
                return { accepted: true };
            }
            revoke(request) {
                this.owner();
                revoke(sessionId(request));
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
        if (request.schema !== 'dsh-hooks/approval-v1' || request.sessionId !== native.agent.id)
            return next();
        return new Promise(resolve => {
            const id = randomUUID();
            const finish = (allowed) => {
                if (!pending.delete(id))
                    return;
                native.signal?.removeEventListener('abort', abort);
                resolve(allowed ? 'allowed-once' : 'rejected');
            };
            const abort = () => finish(false);
            pending.set(id, { id, request, finish });
            native.signal?.addEventListener('abort', abort, { once: true });
            if (native.signal?.aborted)
                abort();
        });
    }, { prepend: true });
    ctx.effect(() => () => { for (const entry of [...pending.values()])
        entry.finish(false); }, 'dsh-hooks: withdraw permission requests');
}
//# sourceMappingURL=permissions.js.map