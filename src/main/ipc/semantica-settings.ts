import * as semantica from '../features/recall/semantica-settings';
import {
  clearSemanticaDemoAssets,
  getSemanticaDemoStatus,
  seedSemanticaDemoAssets,
} from '../features/recall/semantica-demo-assets';

function requireSemanticaEnabled(userId: string): void {
  if (!semantica.readSemanticaSettings(userId).semanticaEnabled) {
    throw new Error('Semantica must be enabled before managing demo assets');
  }
}

export const invokeHandlers = {
  'semantica.settings.get': async (_payload: unknown, ctx: { userId: string }) => ({
    settings: semantica.settingsView(ctx.userId),
    demo: await getSemanticaDemoStatus(ctx.userId),
  }),
  'semantica.settings.save': async (payload: Record<string, unknown>, ctx: { userId: string }) => {
    const settings = semantica.updateSemanticaSettings({
      ...(typeof payload.semanticaEnabled === 'boolean' ? { semanticaEnabled: payload.semanticaEnabled } : {}),
    });
    return { settings: semantica.settingsView(ctx.userId), saved: settings };
  },
  'semantica.demo.seed': async (_payload: unknown, ctx: { userId: string }) => {
    requireSemanticaEnabled(ctx.userId);
    return seedSemanticaDemoAssets(ctx.userId);
  },
  'semantica.demo.clear': async (_payload: unknown, ctx: { userId: string }) => {
    requireSemanticaEnabled(ctx.userId);
    return clearSemanticaDemoAssets(ctx.userId);
  },
};
