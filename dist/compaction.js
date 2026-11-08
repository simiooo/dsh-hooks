const marker = Symbol.for('@simiooo/dsh-hooks/compaction');
function method(target, key) {
    let at = target;
    while (at) {
        const descriptor = Object.getOwnPropertyDescriptor(at, key);
        if (descriptor) {
            if (typeof descriptor.value !== 'function')
                break;
            return descriptor.value;
        }
        at = Object.getPrototypeOf(at);
    }
    throw new Error(`Compaction hooks require the BasicCompactionEngine ${key} seam`);
}
function replace(target, key, value) {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, enumerable: previous?.enumerable ?? false, writable: true, value });
    return () => {
        // Preserve a later extension's wrapper. This wrapper becomes a transparent delegate after disposal.
        if (Object.getOwnPropertyDescriptor(target, key)?.value !== value)
            return;
        if (previous)
            Object.defineProperty(target, key, previous);
        else
            Reflect.deleteProperty(target, key);
    };
}
export function installCompactionBridge(service, hooks) {
    const region = method(service, 'compactRegion'), manual = method(service, 'compactNow'), summarize = method(service, 'summarize');
    if (summarize[marker])
        throw new Error('Compaction hooks already installed');
    const life = new AbortController(), frames = new Map(), active = new Set();
    let closed = false, disposal;
    const committed = (frame) => !!frame.id && frame.owner.session.snapshotEvents().slice(frame.offset)
        .some(event => event.type === 'compaction/end' && event.data.compactionId === frame.id && event.data.error === undefined);
    const enter = (owner, trigger, signal, job) => {
        if (frames.has(owner.session))
            return Promise.reject(new Error('A compaction is already active for this session'));
        const combined = AbortSignal.any([life.signal, ...signal ? [signal] : []]);
        const frame = { owner, trigger, signal: combined, offset: owner.session.snapshotEvents().length };
        frames.set(owner.session, frame);
        const pending = (async () => {
            let result, failure, failed = false;
            try {
                combined.throwIfAborted();
                result = await job(combined);
            }
            catch (error) {
                failed = true;
                failure = error;
            }
            try {
                // A persistence failure can follow a successful replacement. It still compacted the chat.
                if (!combined.aborted && frame.before && (result != null || committed(frame))) {
                    try {
                        await frame.before;
                        await hooks.after(owner, trigger, combined);
                    }
                    catch (error) {
                        if (!failed)
                            throw error;
                        hooks.warn(`PostCompact after committed compaction: ${String(error)}`);
                    }
                }
                if (failed)
                    throw failure;
                return result;
            }
            finally {
                frames.delete(owner.session);
            }
        })();
        active.add(pending);
        void pending.then(() => active.delete(pending), () => active.delete(pending));
        return pending;
    };
    const wrappedSummary = function (...args) {
        const owner = args[1], frame = frames.get(owner.session);
        if (!frame)
            return Reflect.apply(summarize, this, args);
        const receiver = this;
        return (async () => {
            frame.signal.throwIfAborted();
            if (!frame.before) {
                const start = owner.session.snapshotEvents().slice(frame.offset).findLast(event => event.type === 'compaction/start');
                if (!start)
                    throw new Error('Compaction backend did not open a durable transaction');
                frame.id = start.data.compactionId;
                frame.before = hooks.before(owner, frame.trigger, frame.signal);
            }
            await frame.before;
            frame.signal.throwIfAborted();
            // Preserve the exact replay input and arguments. Only join the lifecycle cancellation signal.
            const next = [...args];
            next[2] = AbortSignal.any([frame.signal, ...args[2] ? [args[2]] : []]);
            return Reflect.apply(summarize, receiver, next);
        })();
    };
    Object.defineProperty(wrappedSummary, marker, { value: true });
    const restorers = [replace(service, 'summarize', wrappedSummary)];
    try {
        restorers.push(replace(service, 'compactRegion', function (...args) {
            if (closed)
                return Reflect.apply(region, this, args);
            const receiver = this;
            return enter(args[2], 'auto', args[3], signal => Reflect.apply(region, receiver, [args[0], args[1], args[2], signal]));
        }));
        restorers.push(replace(service, 'compactNow', function (...args) {
            if (closed)
                return Reflect.apply(manual, this, args);
            const owner = args[0], maintenance = method(owner, 'runMaintenance');
            const guard = new AbortController();
            const delegated = [...args];
            delegated[1] = AbortSignal.any([args[1], life.signal, guard.signal]);
            let reserved = false, intercepting = true;
            const undo = replace(owner, 'runMaintenance', function (job) {
                if (!intercepting || closed)
                    return Reflect.apply(maintenance, this, [job]);
                reserved = true;
                return Reflect.apply(maintenance, this, [(signal) => enter(owner, 'manual', AbortSignal.any([signal, args[1], life.signal]), job)]);
            });
            try {
                // Native compactNow reserves maintenance synchronously. Keep the original agent identity.
                const pending = Reflect.apply(manual, this, delegated);
                if (!reserved) {
                    guard.abort(new Error('Unsupported asynchronous maintenance reservation'));
                    void Promise.resolve(pending).catch(() => { });
                    throw new Error('Compaction backend must reserve runMaintenance synchronously');
                }
                return pending;
            }
            finally {
                intercepting = false;
                undo();
            }
        }));
    }
    catch (error) {
        for (const restore of restorers.toReversed())
            restore();
        throw error;
    }
    return { dispose() {
            if (!disposal) {
                closed = true;
                life.abort(new Error('Compaction hooks disposed'));
                disposal = Promise.allSettled([...active]).then(() => { for (const restore of restorers.toReversed())
                    restore(); });
            }
            return disposal;
        } };
}
//# sourceMappingURL=compaction.js.map