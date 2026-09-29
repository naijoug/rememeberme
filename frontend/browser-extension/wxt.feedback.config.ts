import { defineConfig, type ReloadContentScriptPayload } from 'wxt';
import baseConfig from './wxt.config';
import { LOCAL_FEEDBACK_EVENT, LOCAL_FEEDBACK_ORIGIN, LOCAL_FEEDBACK_PORT, LOCAL_FEEDBACK_READY } from './config/local-feedback';

// Load the output once in your normal Chrome profile. No separate browser opens.
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
      // WXT 0.20 uses leading-only debounce, which can drop the last save in a
      // burst. Its existing build mutex already serializes and coalesces work.
      if (wxt.config.dev.server) wxt.config.dev.server.watchDebounce = 0;
    },
    'server:created': (_wxt, server) => {
      const latest = new Map<string, ReloadContentScriptPayload>();
      // WXT's default handler reloads entire matching tabs. The local feedback
      // build instead registers and reinjects scripts, preserving page state.
      server.reloadContentScript = payload => {
        latest.set(payload.contentScript.js?.join(',') ?? '', payload);
        server.ws.send(LOCAL_FEEDBACK_EVENT, payload);
      };
      server.ws.on(LOCAL_FEEDBACK_READY, () => {
        for (const payload of latest.values()) server.ws.send(LOCAL_FEEDBACK_EVENT, payload);
      });
    },
  },
});
