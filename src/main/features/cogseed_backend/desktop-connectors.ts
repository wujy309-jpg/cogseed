/** Host bridge for the connector page's registry. The isolated Runtime must not decrypt desktop
 * credentials or instantiate Electron-dependent connector managers. Keep tool discovery and
 * execution behind the existing host JSONL channel, with live actor/user/subtool checks.
 * The native Runtime connector store remains available for its own non-catalog IDs.
 */
import { resolveVisibleConnectors, stringifyMcpResult } from '../connectors/tools-adapter';
import { callTool, listInstances } from '../connectors/manager';
import { findCatalogEntry } from '../connectors/catalog';
import { cogseedConnectorManager } from './connector-manager';
import type { RuntimeRunRequest } from '../cogseed_runtime/protocol';
import type { CogSeedHostToolResult } from './office-adapter';

export async function runDesktopConnectorTool(userId: string, name: string, input: Record<string, unknown>,
  request: RuntimeRunRequest, signal?: AbortSignal | null): Promise<CogSeedHostToolResult> {
  if (request.user_id !== userId || request.tool_policy?.connectors !== 'enabled') {
    return { content: '[E_RUNTIME_CONNECTOR_DISABLED] Connectors are disabled', isError: true };
  }
  const id = typeof input.connector_id === 'string' ? input.connector_id.trim() : '';
  const visible = await resolveVisibleConnectors(userId, request.agent_id);
  const desktopIds = new Set(listInstances(userId).map(i => i.id));
  const isDesktop = (value: string) => desktopIds.has(value) || !!findCatalogEntry(value);
  if (name === 'desktop_connector_list_tools') {
    const selected = id ? visible.filter(v => v.instance.id === id) : visible;
    const tools = selected.flatMap(v => v.tools.map(t => ({ connector_id: v.instance.id,
      tool_name: t.name, description: t.description, input_schema: t.input_schema })));
    // Agent workers may access only explicitly enabled desktop connectors; don't widen their
    // scope through the parallel native store. Commander keeps existing native-store access.
    if (!request.agent_id && (!id || !isDesktop(id))) {
      const native = id ? await cogseedConnectorManager.listTools(userId, id, { signal: signal ?? undefined })
        : await cogseedConnectorManager.listAllTools(userId, { signal: signal ?? undefined });
      tools.push(...native.filter(t => !isDesktop(t.connectorId)).map(t => ({ connector_id: t.connectorId,
        tool_name: t.name, description: t.description, input_schema: t.input_schema })));
    }
    return { content: JSON.stringify(tools) };
  }
  const toolName = typeof input.tool_name === 'string' ? input.tool_name.trim() : '';
  if (!id || !toolName || !input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) {
    return { content: '[E_RUNTIME_CONNECTOR_INPUT] Invalid connector call', isError: true };
  }
  const args = input.arguments as Record<string, unknown>;
  if (isDesktop(id)) {
    const connector = visible.find(v => v.instance.id === id);
    if (!connector?.tools.some(t => t.name === toolName)) return { content: '[E_RUNTIME_CONNECTOR_SCOPE] Connector tool is unavailable', isError: true };
    const result = await callTool(userId, id, toolName, args, { signal: signal ?? undefined });
    return { content: stringifyMcpResult(result), ...((result as { isError?: boolean })?.isError ? { isError: true } : {}) };
  }
  if (request.agent_id) return { content: '[E_RUNTIME_CONNECTOR_SCOPE] Connector tool is unavailable', isError: true };
  const result = await cogseedConnectorManager.callTool(userId, id, toolName, args, { signal: signal ?? undefined });
  return { content: stringifyMcpResult(result), ...((result as { isError?: boolean })?.isError ? { isError: true } : {}) };
}
