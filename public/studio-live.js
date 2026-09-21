// Fetch-based SSE keeps the admin credential out of the URL. A reconnect gets
// current cursors; consumers resync their bounded views instead of losing events.
export async function subscribe(onChange) {
  while (true) {
    try {
      const r = await fetch("/api/core/stream", {
        headers: { Authorization: "Bearer " + (sessionStorage.token || "") },
      });
      if (!r.ok) throw Error("stream unavailable");
      const reader = r.body.getReader(),
        decoder = new TextDecoder();
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
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
}
