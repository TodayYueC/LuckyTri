export default {
  async activate(ctx) {
    const online = new Set();
    await ctx.channel.provide("webchat", {
      start() {
        ctx.channel.status("webchat", { online: true });
        ctx.status.set({ text: "网页聊天开着", tone: "ok" });
      },
      stop() {
        ctx.channel.status("webchat", { online: false });
      },
      async send(message, text) {
        const room = message.sessionId;
        const log = (await ctx.storage.get(room)) || [];
        log.push({ role: "assistant", text, time: await ctx.now() });
        await ctx.storage.set(room, log.slice(-100));
        return { message_id: String(log.length) };
      },
      async fetchQuoted() {
        return null;
      },
      async fetchImage() {
        return null;
      },
      async refreshDirectory() {
        return 0;
      },
      canReach() {
        return true;
      },
      status() {
        return { online: true };
      },
    });
    ctx.http.hook("POST", "/say", async ({ body }) => {
      const settings = await ctx.settings.get();
      if (!settings.invite || body?.invite !== settings.invite)
        return { ok: false, error: "邀请口令不对" };
      const who = String(body.name || "网页上的人").slice(0, 40);
      const id = String(body.user || who).slice(0, 40);
      online.add(id);
      ctx.channel.receive("webchat", {
        kind: "private",
        nativeId: id,
        userId: id,
        name: who,
        text: String(body.text || "").slice(0, 2000),
        platformId: String(Date.now()),
      });
      return { ok: true };
    });
    ctx.http.route("GET", "/log", async ({ body }) => {
      const room = body?.sessionId || "";
      return { messages: (await ctx.storage.get(room)) || [] };
    });
  },
};
