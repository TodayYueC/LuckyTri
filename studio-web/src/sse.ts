export async function subscribe(
  onChange: (value: unknown) => Promise<void> | void,
) {
  while (true) {
    try {
      const r = await fetch("/api/core/stream", {
        headers: { Authorization: "Bearer " + (sessionStorage.token || "") },
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
    await new Promise((r) => setTimeout(r, 3000));
  }
}
