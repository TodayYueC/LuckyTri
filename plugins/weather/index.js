const CODES = {
  0: "晴",
  1: "大部晴朗",
  2: "多云",
  3: "阴",
  45: "有雾",
  48: "有雾",
  51: "小雨",
  61: "下雨",
  63: "下雨",
  65: "大雨",
  71: "下雪",
  80: "阵雨",
  95: "雷雨",
};

async function lookup(place) {
  const found = await fetch(
    "https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name=" +
      encodeURIComponent(place),
  );
  const data = await found.json();
  const hit = data.results?.[0];
  if (!hit) return null;
  const weather = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,weather_code`,
  );
  const now = (await weather.json()).current || {};
  return {
    place: hit.name,
    text: `${CODES[now.weather_code] || "天气不明"}，${Math.round(now.temperature_2m)}°C`,
    code: now.weather_code,
  };
}

let timer;

export default {
  async activate(ctx) {
    clearInterval(timer);
    const refresh = async () => {
      const settings = await ctx.settings.get();
      if (!settings.place) {
        ctx.status.set({ text: "还没有填写地点", tone: "warn" });
        return;
      }
      try {
        const current = await lookup(settings.place);
        if (!current) {
          ctx.status.set({ text: "没有找到这个地点", tone: "warn" });
          return;
        }
        const discretion = settings.shareInGroups ? "open" : "private";
        ctx.senses.set("weather", {
          text: `窗外${current.text}`,
          discretion,
          ttlMinutes: 90,
        });
        const previous = await ctx.storage.get("code");
        if (previous !== current.code) {
          await ctx.storage.set("code", current.code);
          if (previous != null)
            await ctx.mind.observe({
              summary: `${current.place}的天气变成了${current.text}`,
              discretion,
            });
        }
        ctx.status.set({ text: current.text, tone: "ok" });
      } catch (error) {
        ctx.log.warn(error.message);
        ctx.status.set({ text: "天气暂时读不到", tone: "error" });
      }
    };
    ctx.settings.onChange(refresh);
    await refresh();
    timer = setInterval(refresh, 30 * 60000);
  },
  deactivate() {
    clearInterval(timer);
    timer = null;
  },
};
