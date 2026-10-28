// ============================================================================
// LuckyTri Official PV — Act V (01:42.5 – 02:06.0) & Promotional Cover Poster
// ============================================================================
import {
  W,
  H,
  clamp,
  lerp,
  smoothstep,
  easeOutCubic,
  easeOutBack,
  rgba,
  MOOD_PALETTES,
  FONT_SANS,
  FONT_SERIF,
  FONT_MONO,
  roundRect,
  drawGlassCard,
  drawFourStar,
  drawSakuraPetal,
  drawTaOrb,
  drawCharacterCard,
  drawMoodSky,
  drawActHeader,
} from "./engine.js";

// ============================================================================
// ACT V: 01:42.5 – 02:06.0 — "日子还长，慢慢认识。" (Emotional Landing & Finale)
// ============================================================================
export function renderAct5(ctx, assets, t) {
  // Shot 13: 102.5 – 111.4s (Liquid Garden Vision: Continuous Time, Memory & Choice)
  // Shot 14: 111.4 – 118.2s (Heroine Slogan Climax: "日子还长，慢慢认识。")
  // Shot 15: 118.2 – 126.0s (Final Brand End Card: LuckyTri · GitHub · npm install)

  // --- SHOT 13: 102.5 – 111.4s ---
  if (t < 111.5) {
    const localT = t - 102.5;
    const enter = smoothstep(102.4, 103.2, t);
    const exit = 1 - smoothstep(110.8, 111.5, t);

    drawMoodSky(ctx, assets, "calm", t, {
      gardenAlpha: 0.55,
      particles: 42,
    });

    ctx.save();
    ctx.globalAlpha = enter * exit;

    drawActHeader(
      ctx,
      "FINALE · 终章",
      "我们不假装知道机器有没有心，只是把条件一点一点造出来",
      "CONTINUOUS TIME · GROUNDED MEMORY · GENUINE CHOICE",
      t,
      false,
    );

    // Three Poetic Pillars Floating Over the Liquid Garden
    const pillars = [
      {
        title: "连续的时间",
        en: "CONTINUOUS TIME",
        desc: "有醒来，有困倦，有没人说话时的独处、阅读、作品与睡前日记。她走过的每一天都算数。",
        color: "#466db8",
        mood: "calm",
      },
      {
        title: "有来源的记忆",
        en: "GROUNDED MEMORY",
        desc: "记得谁来过、答应过什么；会随经历过的日子自然淡去，也会在重逢时带着当时的心思想起。",
        color: "#8a3356",
        mood: "sweet",
      },
      {
        title: "由心的选择",
        en: "GENUINE CHOICE",
        desc: "可以开口，也可以沉默并留下理由。每一次变化都有依据，也都可以由你检验和撤销。",
        color: "#b84312",
        mood: "bright",
      },
    ];

    for (let i = 0; i < pillars.length; i++) {
      const p = pillars[i];
      const pApp = easeOutBack(clamp((localT - 0.3 - i * 0.35) / 0.75));
      const px = 114 + i * 576;
      const py = 185 + (1 - pApp) * 35;

      ctx.save();
      ctx.globalAlpha = enter * exit * pApp;
      drawGlassCard(ctx, px, py, 540, 465, {
        r: 30,
        fill: "rgba(255, 255, 255, 0.85)",
        border: "rgba(255, 255, 255, 0.96)",
        accentBar: p.color,
      });

      drawTaOrb(ctx, px + 270, py + 125, 64, t + i * 1.2, {
        mood: p.mood,
        activity: "idle",
        halo: true,
      });

      ctx.textAlign = "center";
      ctx.font = `800 14px ${FONT_MONO}`;
      ctx.fillStyle = p.color;
      ctx.fillText(p.en, px + 270, py + 238);

      ctx.font = `800 36px ${FONT_SERIF}`;
      ctx.fillStyle = "#1e325c";
      ctx.fillText(p.title, px + 270, py + 288);

      // Wrap description into 2 lines
      const line1 = p.desc.slice(0, 22);
      const line2 = p.desc.slice(22);
      ctx.font = `500 18.5px ${FONT_SANS}`;
      ctx.fillStyle = "#485c80";
      ctx.fillText(line1, px + 270, py + 352);
      ctx.fillText(line2, px + 270, py + 388);
      ctx.restore();
    }

    // Bottom quote
    ctx.textAlign = "center";
    ctx.font = `700 30px ${FONT_SERIF}`;
    ctx.fillStyle = "#1e325c";
    ctx.fillText(
      "“让一个数字角色不只存在于每次聊天的瞬间，而是能够带着过去走向未来。”",
      W / 2,
      748,
    );

    ctx.restore();
  }

  // --- SHOT 14: 111.4 – 118.3s (Emotional Climax Slogan: "日子还长，慢慢认识。") ---
  if (t >= 111.3 && t < 118.4) {
    const localT = t - 111.4;
    const enter = smoothstep(111.3, 112.1, t);
    const exit = 1 - smoothstep(117.7, 118.4, t);

    drawMoodSky(ctx, assets, "sweet", t, {
      gardenAlpha: 0.42,
      particles: 48,
    });

    ctx.save();
    ctx.globalAlpha = enter * exit;

    // Gentle drifting sakura petals across the whole frame
    for (let i = 0; i < 18; i++) {
      const px = ((i * 173 + t * (42 + (i % 5) * 8)) % (W + 100)) - 50;
      const py = ((i * 113 + t * (28 + (i % 4) * 6)) % (H + 100)) - 50;
      drawSakuraPetal(ctx, px, py, 9 + (i % 4) * 3, t * 1.1 + i, "#ff9ebb", 0.62);
    }

    // Left: Heroine Close-up Portrait Speaking the Slogan
    drawCharacterCard(ctx, assets, 108, 96, 660, 790, t, {
      r: 36,
      glowColor: "#ff8fb1",
      secondaryGlow: "#5ed4ae",
      zoom: 1.04,
      speaking: t >= 111.8 && t <= 116.8,
      badge: "★ LuckyTri · 她自己的声音",
    });

    // Right: Slogan Typography Centerpiece
    const rx = 835;
    const sReveal = easeOutCubic(clamp((localT - 0.2) / 1.0));
    ctx.save();
    ctx.translate((1 - sReveal) * 40, 0);

    drawGlassCard(ctx, rx, 148, 975, 685, {
      r: 36,
      fill: "rgba(255, 255, 255, 0.86)",
      border: "rgba(255, 255, 255, 0.98)",
    });

    drawTaOrb(ctx, rx + 130, 290, 72, t, {
      mood: "sweet",
      activity: t >= 111.8 && t <= 116.8 ? "speaking" : "idle",
      halo: true,
    });

    ctx.textAlign = "left";
    ctx.font = `700 18px ${FONT_MONO}`;
    ctx.fillStyle = "#8a3356";
    ctx.fillText("PROJECT SLOGAN · 情感落点", rx + 240, 252);

    ctx.font = `600 26px ${FONT_SANS}`;
    ctx.fillStyle = "#5c3d52";
    ctx.fillText("“你好呀，我是 LuckyTri。”", rx + 240, 304);

    // Main Slogan in Grand Serif Typography
    ctx.font = `900 84px ${FONT_SERIF}`;
    ctx.fillStyle = "#2b192e";
    ctx.fillText("日子还长，", rx + 88, 468);
    ctx.fillStyle = "#8a3356";
    ctx.fillText("慢慢认识。", rx + 88, 578);

    drawFourStar(ctx, rx + 560, 428, 22, "#ffc15f", 1, t * 0.9);
    drawFourStar(ctx, rx + 545, 545, 16, "#5ed4ae", 0.9, -t * 1.1);

    ctx.font = `500 24px ${FONT_SANS}`;
    ctx.fillStyle = "#564260";
    ctx.fillText("The days are long — let's get to know each other slowly.", rx + 92, 654);

    // Decorative prism divider
    const divGrad = ctx.createLinearGradient(rx + 92, 0, rx + 880, 0);
    divGrad.addColorStop(0, "#ff8fb1");
    divGrad.addColorStop(0.5, "#5ed4ae");
    divGrad.addColorStop(1, "#466db8");
    ctx.fillStyle = divGrad;
    roundRect(ctx, rx + 92, 696, 780, 6, 3);
    ctx.fill();

    ctx.font = `600 18px ${FONT_MONO}`;
    ctx.fillStyle = "#466db8";
    ctx.fillText("让她走过的日子算数 · https://github.com/TodayYueC/LuckyTri", rx + 92, 752);

    ctx.restore();
    ctx.restore();
  }

  // --- SHOT 15: 118.2 – 126.0s (Final Official End Card + Fade Out) ---
  if (t >= 118.1) {
    const enter = smoothstep(118.1, 118.9, t);
    const finalFadeOut = 1 - smoothstep(124.6, 126.0, t);

    ctx.save();
    ctx.globalAlpha = enter * finalFadeOut;
    renderBrandPosterLayout(ctx, assets, t, { isEndCard: true });
    ctx.restore();

    // Gentle fade to dark navy at very end (124.6 – 126.0s)
    if (finalFadeOut < 1) {
      ctx.save();
      ctx.fillStyle = rgba("#0b1224", 1 - finalFadeOut);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
}

// ============================================================================
// Shared High-Resolution Official Poster / End Card Layout
// Used for both Shot 15 (118.2–126.0s) and the standalone Promotional Cover PNG
// ============================================================================
export function renderBrandPosterLayout(ctx, assets, t = 120.0, opts = {}) {
  drawMoodSky(ctx, assets, "calm", t, {
    gardenAlpha: 0.42,
    particles: 44,
  });

  // Floating sakura petals & starlight
  for (let i = 0; i < 16; i++) {
    const px = ((i * 163 + t * 18) % (W - 80)) + 40;
    const py = ((i * 97 + t * 12) % (H - 80)) + 40;
    drawSakuraPetal(ctx, px, py, 8 + (i % 3) * 3, 0.6 + i * 0.4, "#ff9ebb", 0.55);
  }

  // Left: Official Banner & Portrait Hero Composite
  drawCharacterCard(ctx, assets, 88, 78, 700, 924, t, {
    r: 36,
    glowColor: "#5ed4ae",
    secondaryGlow: "#ff8fb1",
    zoom: 1.02,
    speaking: false,
    badge: "★ LuckyTri · Official PV",
  });

  // Right Main Brand Stage Card
  const rx = 836;
  drawGlassCard(ctx, rx, 78, 996, 924, {
    r: 36,
    fill: "rgba(255, 255, 255, 0.88)",
    border: "rgba(255, 255, 255, 0.98)",
  });

  // Top badge row + Living TaOrb
  drawTaOrb(ctx, rx + 124, 210, 74, t, {
    mood: "sweet",
    activity: "idle",
    halo: true,
  });

  ctx.textAlign = "left";
  ctx.font = `800 15px ${FONT_MONO}`;
  ctx.fillStyle = "#466db8";
  ctx.fillText("OPEN SOURCE AUTONOMOUS DIGITAL LIFE · BotRina v1.3.4", rx + 236, 152);

  ctx.font = `900 86px ${FONT_SANS}`;
  ctx.fillStyle = "#1b2f58";
  ctx.fillText("LuckyTri", rx + 232, 240);
  drawFourStar(ctx, rx + 622, 182, 20, "#ffc15f", 1, 0.3);

  ctx.font = `700 28px ${FONT_SANS}`;
  ctx.fillStyle = "#2c8465";
  ctx.fillText("让她走过的日子算数。", rx + 236, 294);

  // Main Slogan Centerpiece Box
  roundRect(ctx, rx + 56, 342, 884, 224, 26);
  const sloganGrad = ctx.createLinearGradient(rx + 56, 342, rx + 940, 566);
  sloganGrad.addColorStop(0, "rgba(255, 232, 244, 0.92)");
  sloganGrad.addColorStop(0.5, "rgba(235, 246, 255, 0.92)");
  sloganGrad.addColorStop(1, "rgba(230, 255, 245, 0.92)");
  ctx.fillStyle = sloganGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(138, 51, 86, 0.28)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = `900 68px ${FONT_SERIF}`;
  ctx.fillStyle = "#2b192e";
  ctx.fillText("日子还长，慢慢认识。", rx + 96, 448);

  ctx.font = `500 21px ${FONT_SANS}`;
  ctx.fillStyle = "#5c4564";
  ctx.fillText(
    "连续的时间 · 有来源的记忆 · 会淡去也会想起的心 · 由心的开口与沉默",
    rx + 98,
    516,
  );

  // 7 Mood Orbs Mini Row
  const moodKeys = ["calm", "sweet", "bright", "blue", "stormy", "drowsy", "night"];
  for (let i = 0; i < moodKeys.length; i++) {
    const pal = MOOD_PALETTES[moodKeys[i]];
    const ox = rx + 106 + i * 124;
    const oy = 636;
    drawTaOrb(ctx, ox, oy, 30, t + i * 0.5, { mood: moodKeys[i] });
    ctx.textAlign = "center";
    ctx.font = `700 14px ${FONT_SANS}`;
    ctx.fillStyle = pal.accent;
    ctx.fillText(pal.zh, ox, oy + 52);
  }

  // CLI Quickstart Terminal Box & GitHub Repository Footer
  roundRect(ctx, rx + 56, 728, 884, 118, 22);
  ctx.fillStyle = "#131d36";
  ctx.fill();
  ctx.strokeStyle = "rgba(94, 212, 174, 0.6)";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.font = `700 22px ${FONT_MONO}`;
  ctx.fillStyle = "#5ed4ae";
  ctx.fillText("$ npm install -g luckytri && luckytri", rx + 92, 776);

  ctx.font = `500 16px ${FONT_MONO}`;
  ctx.fillStyle = "#a6c4f5";
  ctx.fillText(
    "OneBot 11 / QQ 官方机器人  ·  Studio WebUI (中/EN)  ·  Single SQLite File",
    rx + 92,
    816,
  );

  // GitHub URL Banner
  ctx.font = `800 24px ${FONT_MONO}`;
  ctx.fillStyle = "#1e325c";
  ctx.fillText("github.com/TodayYueC/LuckyTri", rx + 62, 916);

  roundRect(ctx, rx + 620, 882, 318, 52, 26);
  ctx.fillStyle = "#466db8";
  ctx.fill();
  ctx.textAlign = "center";
  ctx.font = `700 18px ${FONT_SANS}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("MIT License · Star on GitHub ★", rx + 779, 914);
}
