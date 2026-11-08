import { randomUUID } from 'node:crypto';
import { object } from './protocol.js';
import type { PermissionRequest } from './engine.js';

/** Host-side human permission queue, exported only through Harness's authenticated Typert Gateway. */
export async function installPermissionApi(ctx: any, revoke: (sessionId: string) => void): Promise<void> {
  const { TypertRemoteService, Remote } = await import('@deepseek-ai/dsh-typert-protocol');
  type Pending = { id: string; request: PermissionRequest; finish(allowed: boolean): void };
  const pending = new Map<string, Pending>();
  const sessionId = (request: unknown): string => {
    if (!object(request) || typeof request.sessionId !== 'string' || !request.sessionId) throw new TypeError('sessionId is required');
    return request.sessionId;
  };
  const resources = { session: (request: unknown) => sessionId(request) };
  class HooksPermissions extends TypertRemoteService {
    constructor() { super(ctx, 'dshHooksPermissions'); }
    private owner(): void {
      const invocation = this.ctx.invocation;
      if (!invocation || invocation.peer.principal.kind !== 'owner' || invocation.peer.interactions !== 'answer') throw new Error('Only the interactive Host owner may review executable hooks');
    }
    @Remote({ resources })
    list(request: unknown) {
      this.owner(); const id = sessionId(request);
      return { requests: [...pending.values()].filter(p => p.request.sessionId === id).map(p => ({ ...p.request, id: p.id })) };
    }
    @Remote({ resources })
    answer(request: unknown) {
      this.owner(); const sid = sessionId(request);
      if (!object(request) || typeof request.id !== 'string' || typeof request.fingerprint !== 'string' || !['allow-session', 'deny'].includes(String(request.decision))) throw new TypeError('invalid hook decision');
      const entry = pending.get(request.id);
      if (!entry || entry.request.sessionId !== sid || entry.request.fingerprint !== request.fingerprint) return { accepted: false };
      entry.finish(request.decision === 'allow-session'); return { accepted: true };
    }
    @Remote({ resources })
    revoke(request: unknown) {
      this.owner(); revoke(sessionId(request)); return { revoked: true };
    }
  }
  new HooksPermissions();
  ctx.on('approval/request', (native: any, next: () => Promise<string>) => {
    if (native.toolName !== 'dsh-hooks') return next();
    let request: PermissionRequest;
    try { request = JSON.parse(native.reason); } catch { return next(); }
    if (request.schema !== 'dsh-hooks/approval-v1' || request.sessionId !== native.agent.id) return next();
    return new Promise<string>(resolve => {
      const id = randomUUID();
      const finish = (allowed: boolean) => {
        if (!pending.delete(id)) return;
        native.signal?.removeEventListener('abort', abort);
        resolve(allowed ? 'allowed-once' : 'rejected');
      };
      const abort = () => finish(false);
      pending.set(id, { id, request, finish });
      native.signal?.addEventListener('abort', abort, { once: true });
      if (native.signal?.aborted) abort();
    });
  }, { prepend: true });
  ctx.effect(() => () => { for (const entry of [...pending.values()]) entry.finish(false); }, 'dsh-hooks: withdraw permission requests');
}
