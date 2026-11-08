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
import { object } from './protocol.js';
export async function installManagementApi(ctx, manager) {
    const { TypertRemoteService, Remote } = await import('@deepseek-ai/dsh-typert-protocol');
    const input = (value, keys, optional = []) => {
        if (!object(value) || Object.keys(value).some(key => ![...keys, ...optional].includes(key))
            || keys.some(key => key === 'enabled' ? typeof value[key] !== 'boolean' : typeof value[key] !== 'string')
            || optional.some(key => value[key] !== undefined && typeof value[key] !== 'string'))
            throw new TypeError('Invalid hooks management request');
        return value;
    };
    let HooksManagementApi = (() => {
        let _classSuper = TypertRemoteService;
        let _instanceExtraInitializers = [];
        let _catalog_decorators;
        let _setEnabled_decorators;
        let _readSource_decorators;
        let _writeSource_decorators;
        return class HooksManagementApi extends _classSuper {
            static {
                const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
                _catalog_decorators = [Remote];
                _setEnabled_decorators = [Remote];
                _readSource_decorators = [Remote];
                _writeSource_decorators = [Remote];
                __esDecorate(this, null, _catalog_decorators, { kind: "method", name: "catalog", static: false, private: false, access: { has: obj => "catalog" in obj, get: obj => obj.catalog }, metadata: _metadata }, null, _instanceExtraInitializers);
                __esDecorate(this, null, _setEnabled_decorators, { kind: "method", name: "setEnabled", static: false, private: false, access: { has: obj => "setEnabled" in obj, get: obj => obj.setEnabled }, metadata: _metadata }, null, _instanceExtraInitializers);
                __esDecorate(this, null, _readSource_decorators, { kind: "method", name: "readSource", static: false, private: false, access: { has: obj => "readSource" in obj, get: obj => obj.readSource }, metadata: _metadata }, null, _instanceExtraInitializers);
                __esDecorate(this, null, _writeSource_decorators, { kind: "method", name: "writeSource", static: false, private: false, access: { has: obj => "writeSource" in obj, get: obj => obj.writeSource }, metadata: _metadata }, null, _instanceExtraInitializers);
                if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            }
            constructor() {
                super(ctx, 'dshHooksManagement');
                __runInitializers(this, _instanceExtraInitializers);
            }
            owner() {
                const peer = this.ctx.invocation?.peer;
                if (peer?.principal?.kind !== 'owner' || peer.interactions !== 'answer')
                    throw new Error('Only the interactive Host owner may manage hooks');
            }
            catalog(request) { this.owner(); const data = input(request, [], ['scopeId']); return manager.catalog(data.scopeId); }
            setEnabled(request) { this.owner(); const data = input(request, ['scopeId', 'revision', 'id', 'enabled']); return manager.setEnabled(data.scopeId, data.revision, data.id, data.enabled); }
            readSource(request) { this.owner(); const data = input(request, ['scopeId', 'revision', 'sourceId']); return manager.readSource(data.scopeId, data.revision, data.sourceId); }
            writeSource(request) { this.owner(); const data = input(request, ['scopeId', 'revision', 'sourceId', 'content']); return manager.writeSource(data.scopeId, data.revision, data.sourceId, data.content); }
        };
    })();
    new HooksManagementApi();
}
//# sourceMappingURL=management-api.js.map