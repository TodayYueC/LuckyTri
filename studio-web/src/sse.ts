export async function subscribe(
  onChange: (value: unknown) => Promise<void> | void,
  options: {
    session?: string;
    signal?: AbortSignal;
    reconnectMs?: number;
  } = {},
) {
  const { session = "", signal, reconnectMs = 3000 } = options;
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      }
      signal?.addEventListener("abort", done, { once: true });
    });

  while (!signal?.aborted) {
    try {
      const url = new URL("/api/core/stream", location.origin);
      if (session) url.searchParams.set("session", session);
      const r = await fetch(url, {
        headers: { Authorization: "Bearer " + (sessionStorage.token || "") },
        signal,
      });
      if (!r.ok) throw Error("stream unavailable");
      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (frame.startsWith("data: "))
            await onChange(JSON.parse(frame.slice(6)));
        }
      }
    } catch {
      /* reconnect */
    }
    if (!signal?.aborted) await wait(reconnectMs);
  }
}
