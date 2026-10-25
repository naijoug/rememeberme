import type { ReloadContentScriptPayload } from 'wxt';
import { LOCAL_FEEDBACK_AVAILABLE, LOCAL_FEEDBACK_EVENT, LOCAL_FEEDBACK_ORIGIN, LOCAL_FEEDBACK_READY } from '~/config/local-feedback';

export async function reconnectLocalPage(tabId: number, frameId: number): Promise<void> {
  const target = { tabId, frameIds: [frameId] };
  const files = ['content-scripts/content.css'];
  await browser.scripting.removeCSS({ target, files });
  await browser.scripting.insertCSS({ target, files });
  await browser.scripting.executeScript({ target, files: ['/content-scripts/content.js'] });
}

export async function refreshLocalContent({ contentScript }: ReloadContentScriptPayload): Promise<void> {
  const files = contentScript.js;
  if (!files?.length) return;
  const scriptFiles = files.map(file => file.startsWith('/') ? file : '/' + file)
    .filter((file): file is '/content-scripts/content.js' => file === '/content-scripts/content.js');
  if (scriptFiles.length !== files.length) throw new Error('Unexpected local content script path');
  const id = `wxt:${files[0]}`;
  const registered = await browser.scripting.getRegisteredContentScripts();
  const updated = { ...contentScript, id, css: contentScript.css ?? [] };
  if (registered.some(script => script.id === id)) {
    await browser.scripting.updateContentScripts([updated]);
  } else {
    await browser.scripting.registerContentScripts([updated]);
  }

  const tabs = await browser.tabs.query({ url: contentScript.matches });
  await Promise.all(tabs.map(async tab => {
    if (tab.id == null) return;
    const target = { tabId: tab.id, allFrames: contentScript.allFrames ?? false };
    try {
      if (contentScript.css?.length) {
        await browser.scripting.removeCSS({ target, files: contentScript.css });
        await browser.scripting.insertCSS({ target, files: contentScript.css });
      }
      // WXT invalidates the previous content context when this script starts.
      await browser.scripting.executeScript({ target, files: scriptFiles });
    } catch {
      // Restricted pages or tabs closed during an update cannot be injected.
      // New/reloaded eligible pages still use the registered current version.
    }
  }));
}

export function startLocalFeedback(): () => void {
  let socket: WebSocket;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let disconnected = false;
  let pending = Promise.resolve();

  const connect = () => {
    socket = new WebSocket(LOCAL_FEEDBACK_ORIGIN.replace('http:', 'ws:'), 'vite-hmr');
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'custom', event: LOCAL_FEEDBACK_READY }));
    });
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.type === 'custom' && message.event === LOCAL_FEEDBACK_AVAILABLE && disconnected) {
        // A WebSocket can open while WXT is still replacing the output folder.
        // Reload only after the server confirms the manifest has been written.
        disconnected = false;
        browser.runtime.reload();
        return;
      }
      if (message?.type !== 'custom' || message.event !== LOCAL_FEEDBACK_EVENT ||
          !Array.isArray(message.data?.contentScript?.js) ||
          !Array.isArray(message.data?.contentScript?.matches)) return;
      pending = pending.then(() => refreshLocalContent(message.data)).catch(error => {
        console.error('Local content update failed:', error);
      });
    });
    socket.addEventListener('close', () => {
      disconnected = true;
      if (!stopped) retry = setTimeout(connect, 2000);
    });
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket.close();
  };
}
