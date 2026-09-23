// Trusted iframe bridge. Its exact bytes are authorized by a CSP SHA-256 hash.
let worker;
let channel;
let workerUrl;
window.onmessage = (event) => {
  if (event.source !== parent) return;
  if (event.data.kind === "start" && !worker) {
    channel = event.data.channel;
    try {
      workerUrl = URL.createObjectURL(new Blob([event.data.source], { type: "text/javascript" }));
      worker = new Worker(workerUrl);
      worker.onmessage = (message) => {
        URL.revokeObjectURL(workerUrl);
        parent.postMessage({ channel, payload: message.data }, "*");
      };
      worker.onerror = (error) =>
        parent.postMessage(
          {
            channel,
            payload: { kind: "crash", error: error.message || "Worker source could not be loaded" },
          },
          "*",
        );
    } catch (error) {
      parent.postMessage({ channel, payload: { kind: "crash", error: String(error) } }, "*");
    }
  } else if (event.data.channel === channel) {
    if (event.data.kind === "stop") {
      if (worker) worker.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      worker = null;
    } else if (worker) worker.postMessage(event.data.payload);
  }
};
parent.postMessage({ boot: true }, "*");
