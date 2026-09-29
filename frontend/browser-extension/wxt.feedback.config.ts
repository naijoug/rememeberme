import { defineConfig, type ReloadContentScriptPayload, type WxtDevServer } from 'wxt';
import baseConfig from './wxt.config';
import { LOCAL_FEEDBACK_AVAILABLE, LOCAL_FEEDBACK_EVENT, LOCAL_FEEDBACK_ORIGIN, LOCAL_FEEDBACK_PORT, LOCAL_FEEDBACK_READY } from './config/local-feedback';

type FeedbackServer = WxtDevServer & {
  rememberMe?: { ready: boolean; latest: Map<string, ReloadContentScriptPayload> };
};
function state(server: WxtDevServer) {
  return (server as FeedbackServer).rememberMe ??= { ready: false, latest: new Map() };
}

// Load this fixed output once in the normal Chrome profile.
export default defineConfig({
  ...baseConfig,
  browser: 'chrome',
  manifestVersion: 3,
  outDirTemplate: 'chrome-mv3-feedback',
  manifest: { ...baseConfig.manifest, name: 'Remember Me · Local' },
  webExt: { disabled: true },
  dev: { server: { host: '127.0.0.1', port: LOCAL_FEEDBACK_PORT, origin: LOCAL_FEEDBACK_ORIGIN } },
  hooks: {
    'config:resolved': wxt => {
      if (wxt.config.dev.server) wxt.config.dev.server.watchDebounce = 0;
    },
    'server:created': (_wxt, server) => {
      server.reloadContentScript = payload => {
        state(server).latest.set(payload.contentScript.js?.join(',') ?? '', payload);
        server.ws.send(LOCAL_FEEDBACK_EVENT, payload);
      };
    },
    'server:started': (_wxt, server) => {
      const current = state(server);
      current.ready = false;
      current.latest.clear();
      // Register on each new socket server, including config-triggered restarts.
      server.ws.on(LOCAL_FEEDBACK_READY, () => {
        if (!current.ready) return;
        server.ws.send(LOCAL_FEEDBACK_AVAILABLE, {});
        for (const payload of current.latest.values()) server.ws.send(LOCAL_FEEDBACK_EVENT, payload);
      });
    },
    'build:before': wxt => { if (wxt.server) state(wxt.server).ready = false; },
    'build:done': wxt => {
      if (!wxt.server) return;
      state(wxt.server).ready = true;
      wxt.server.ws.send(LOCAL_FEEDBACK_AVAILABLE, {});
    },
  },
});
