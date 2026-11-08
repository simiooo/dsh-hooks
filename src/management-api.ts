import { object } from './protocol.js';
import type { HooksManagement } from './management.js';

export async function installManagementApi(ctx: any, manager: HooksManagement): Promise<void> {
  const { TypertRemoteService, Remote } = await import('@deepseek-ai/dsh-typert-protocol');
  const input = (value: unknown, keys: string[], optional: string[] = []): Record<string, any> => {
    if (!object(value) || Object.keys(value).some(key => ![...keys, ...optional].includes(key))
      || keys.some(key => key === 'enabled' ? typeof value[key] !== 'boolean' : typeof value[key] !== 'string')
      || optional.some(key => value[key] !== undefined && typeof value[key] !== 'string')) throw new TypeError('Invalid hooks management request');
    return value;
  };
  class HooksManagementApi extends TypertRemoteService {
    constructor() { super(ctx, 'dshHooksManagement'); }
    private owner(): void {
      const peer = this.ctx.invocation?.peer;
      if (peer?.principal?.kind !== 'owner' || peer.interactions !== 'answer') throw new Error('Only the interactive Host owner may manage hooks');
    }
    @Remote
    catalog(request: unknown) { this.owner(); const data = input(request, [], ['scopeId']); return manager.catalog(data.scopeId); }
    @Remote
    setEnabled(request: unknown) { this.owner(); const data = input(request, ['scopeId', 'revision', 'id', 'enabled']); return manager.setEnabled(data.scopeId, data.revision, data.id, data.enabled); }
    @Remote
    readSource(request: unknown) { this.owner(); const data = input(request, ['scopeId', 'revision', 'sourceId']); return manager.readSource(data.scopeId, data.revision, data.sourceId); }
    @Remote
    writeSource(request: unknown) { this.owner(); const data = input(request, ['scopeId', 'revision', 'sourceId', 'content']); return manager.writeSource(data.scopeId, data.revision, data.sourceId, data.content); }
  }
  new HooksManagementApi();
}
