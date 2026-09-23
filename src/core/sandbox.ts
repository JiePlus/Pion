import bridge from "./sandbox-bridge.js?raw";
import { i18n } from "./i18n.ts";
import sdk from "./worker-sdk.js?raw";

export function sandbox(source: string, receive: (message: unknown) => void) {
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.title = "Isolated plugin worker";
  iframe.setAttribute("sandbox", "allow-scripts");
  const channel = crypto.randomUUID();
  const workerSource = `"use strict";\nlet desktopLocale = ${JSON.stringify(i18n.getLocale())};\n${sdk}\nconst plugin = (() => {\n${source}\nreturn { activate, deactivate: typeof deactivate === "function" ? deactivate : undefined };\n})();\nPromise.resolve().then(() => plugin.activate(context)).then(() => send({kind:"ready"})).catch(error => send({kind:"crash",error:String(error)}));`;
  // The bridge has a fixed hash; arbitrary plugin source is never interpolated into HTML.
  iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${import.meta.env.PLUGIN_BRIDGE_HASH}' blob:; worker-src blob:; connect-src 'none'; child-src blob:"><script>${bridge}</script>`;
  let booted = false;
  function listener(event: MessageEvent) {
    if (event.source !== iframe.contentWindow) return;
    if (event.data?.boot && !booted) {
      booted = true;
      iframe.contentWindow?.postMessage({ channel, kind: "start", source: workerSource }, "*");
    } else if (event.data?.channel === channel) receive(event.data.payload);
  }
  window.addEventListener("message", listener);
  document.body.append(iframe);
  return {
    send(payload: unknown) {
      iframe.contentWindow?.postMessage({ channel, kind: "message", payload }, "*");
    },
    destroy() {
      iframe.contentWindow?.postMessage({ channel, kind: "stop" }, "*");
      window.removeEventListener("message", listener);
      iframe.remove();
    },
  };
}
