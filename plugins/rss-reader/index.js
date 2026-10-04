function decode(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function items(xml) {
  const chunks = String(xml)
    .split(/<item[\s>]|<entry[\s>]/)
    .slice(1);
  return chunks
    .map((chunk) => ({
      title: decode(chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]).slice(
        0,
        180,
      ),
      link: decode(
        chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1] ||
          chunk.match(/href="([^"]+)"/)?.[1],
      ),
      content: decode(
        chunk.match(
          /<content[^>]*>([\s\S]*?)<\/content>|<description[^>]*>([\s\S]*?)<\/description>/,
        )?.[1] ||
          chunk.match(/<description[^>]*>([\s\S]*?)<\/description>/)?.[1],
      ).slice(0, 6000),
    }))
    .filter((item) => item.title && item.content);
}

export default {
  activate(ctx) {
    ctx.activities.handle("browse", async () => {
      const settings = await ctx.settings.get();
      const feeds = Array.isArray(settings.feeds) ? settings.feeds : [];
      if (!feeds.length)
        return { available: false, reason: "还没有填写订阅地址" };
      const seen = new Set((await ctx.storage.get("seen")) || []);
      for (const feed of feeds) {
        const response = await ctx.net.fetch(feed);
        if (response.status >= 400) continue;
        const next = items(await response.text()).find(
          (item) => !seen.has(item.link || item.title),
        );
        if (!next) continue;
        seen.add(next.link || next.title);
        await ctx.storage.set("seen", [...seen].slice(-200));
        if (next.content.length > 1500)
          await ctx.knowledge.offer({
            title: next.title,
            text: next.content,
            url: next.link,
          });
        return {
          available: true,
          materials: [
            { title: next.title, url: next.link || "", content: next.content },
          ],
          duration: { minutes: 15, basis: "读完这一篇" },
        };
      }
      return { available: false, reason: "订阅里暂时没有新的文章" };
    });
    ctx.status.set({ text: "订阅已接上", tone: "ok" });
  },
};
