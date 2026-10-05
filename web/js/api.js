// Talking to the Rust backend.

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // No error message means the server doesn't know this request at all: usually a game
    // server started before an update, serving pages that are newer than it is.
    const err = new Error(data.error || (res.status === 404
      ? "The game server is out of date. Restart it (Ctrl+C in its terminal, then cargo run) and reload this page."
      : `Something went wrong on the game server (error ${res.status}).`));
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  state: () => request("GET", "/api/state"),
  level: id => request("GET", `/api/level/${encodeURIComponent(id)}`),
  lesson: id => request("GET", `/api/lesson/${encodeURIComponent(id)}`),
  run: (id, code) => request("POST", "/api/run", { id, code }),
  play: (code, id) => request("POST", "/api/play", { code, id }),
  quiz: (id, choice) => request("POST", "/api/quiz", { id, choice }),
  skip: id => request("POST", "/api/skip", { id }),
  replay: id => request("POST", "/api/replay", { id }),
  draft: (id, code) => request("POST", "/api/draft", { id, code }),
  setName: name => request("POST", "/api/name", { name }),
  saveSettings: s => request("POST", "/api/settings", s),
  models: () => request("GET", "/api/models"),
  testModel: (model, effort) => request("POST", "/api/models/test", { model, effort }),
  refreshModels: () => request("POST", "/api/models/refresh"),
  explain: code => request("GET", `/api/explain/${encodeURIComponent(code)}`),

  /** Stream Ferris' reply; calls onEvent for each JSON event. */
  async ferris(payload, onEvent, stopSignal) {
    // The server gives up after 4 minutes; this is a backstop in case it never answers.
    const timeout = AbortSignal.timeout(5 * 60 * 1000);
    const signal = stopSignal ? AbortSignal.any([stopSignal, timeout]) : timeout;
    const res = await fetch("/api/ferris", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Ferris couldn't answer (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          try { onEvent(JSON.parse(line)); } catch { /* ignore a bad line */ }
        }
      }
    }
  },
};
