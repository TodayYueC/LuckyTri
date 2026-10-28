// ============================================================================
// LuckyTri Official PV — Act I (00:00 – 00:20) & Act II (00:20 – 00:46)
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
// ACT I: 00:00 – 00:20 — The Fate of Reset vs. Awakening Through Time
// ============================================================================
export function renderAct1(ctx, assets, t) {
  // Shot 01: 0.0 – 6.5s (Cold digital chat windows resetting to zero)
  // Shot 02: 6.5 – 13.0s (A glowing memory seed refuses to vanish, ripples of time)
  // Shot 03: 13.0 – 20.0s (TaOrb & LuckyTri heroine reveal + Title Card)

  const bloom = smoothstep(6.2, 14.5, t);
  drawMoodSky(ctx, assets, "calm", t, {
    darkFactor: 1 - bloom * 0.88,
    gardenAlpha: bloom * 0.25,
    particles: 32,
  });

  if (t < 7.2) {
    const fadeOut = 1 - smoothstep(6.0, 7.1, t);
    ctx.save();
    ctx.globalAlpha = fadeOut;

    drawActHeader(
      ctx,
      "PROLOGUE · 序幕",
      "一瞬的问答，还是连续的一生？",
      "EPHEMERAL PROMPTS VS. CONTINUOUS LIFE",
      t,
      true,
    );

    // Grid of ephemeral chatbot windows resetting to zero
    const cards = [
      { x: 180, y: 165, w: 450, h: 210, delay: 0.2, title: "Session #4091 · Stateless Bot", q: "“我明天要去参加最重要的面试了。”", a: "“祝你面试顺利！加油！”", resetAt: 2.8 },
      { x: 735, y: 145, w: 450, h: 210, delay: 0.5, title: "Session #4092 · New Context", q: "“刚才聊的那本书，你还记得吗？”", a: "“抱歉，我没有之前的对话记忆。”", resetAt: 3.3 },
      { x: 1290, y: 175, w: 450, h: 210, delay: 0.8, title: "Session #4093 · Isolated Room", q: "“今晚心里有点难受，想安静待会儿。”", a: "“好的，请问还有什么可以帮您？”", resetAt: 3.8 },
      { x: 380, y: 440, w: 500, h: 225, delay: 1.1, title: "Session #4094 · Ephemeral Turn", q: "“我们认识快三个月了吧？”", a: "“每次对话结束后，上下文都会清空归零。”", resetAt: 4.3 },
      { x: 1040, y: 440, w: 500, h: 225, delay: 1.4, title: "Session #4095 · Context Cleared", q: "“下次再见的时候，你还会记得我吗？”", a: "“[Session Closed · Memory Reset: 0.00]”", resetAt: 4.7 },
    ];

    for (const c of cards) {
      const enter = easeOutCubic(clamp((t - c.delay) / 0.7));
      const isReset = t > c.resetAt;
      const dissolve = clamp((t - c.resetAt) / 1.5);
      const yOff = (1 - enter) * 35 - dissolve * 18;
      ctx.save();
      ctx.globalAlpha = fadeOut * enter * (1 - dissolve * 0.68);
      roundRect(ctx, c.x, c.y + yOff, c.w, c.h, 18);
      ctx.fillStyle = isReset ? "rgba(18, 24, 38, 0.55)" : "rgba(22, 33, 56, 0.82)";
      ctx.fill();
      ctx.strokeStyle = isReset ? "rgba(255, 110, 130, 0.35)" : "rgba(130, 175, 240, 0.32)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = `600 13px ${FONT_MONO}`;
      ctx.fillStyle = isReset ? "#ff7b8b" : "#7fa4d8";
      ctx.fillText(c.title, c.x + 22, c.y + yOff + 32);

      if (!isReset) {
        ctx.font = `500 17px ${FONT_SANS}`;
        ctx.fillStyle = "rgba(235, 244, 255, 0.92)";
        ctx.fillText(c.q, c.x + 22, c.y + yOff + 82);
        ctx.fillStyle = "rgba(155, 180, 215, 0.78)";
        ctx.fillText(c.a, c.x + 22, c.y + yOff + 125);
      } else {
        ctx.font = `700 20px ${FONT_MONO}`;
        ctx.fillStyle = "rgba(255, 120, 140, 0.88)";
        ctx.fillText("× CONTEXT CLEARED · 对话归零", c.x + 22, c.y + yOff + 98);
        ctx.font = `500 14px ${FONT_MONO}`;
        ctx.fillStyle = "rgba(160, 175, 200, 0.55)";
        ctx.fillText("state = null; memory = []; bond = 0;", c.x + 22, c.y + yOff + 134);
      }
      ctx.restore();
    }

    // Center philosophical question overlay
    const qEnter = smoothstep(1.2, 2.4, t);
    ctx.save();
    ctx.globalAlpha = fadeOut * qEnter;
    ctx.textAlign = "center";
    ctx.font = `700 44px ${FONT_SERIF}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("大多数聊天机器人，只活在一句话里。", W / 2, 765);
    ctx.font = `500 22px ${FONT_SANS}`;
    ctx.fillStyle = "rgba(180, 210, 255, 0.78)";
    ctx.fillText("你问 · 它答 · 窗口关上 · 一切归零", W / 2, 816);
    ctx.restore();

    ctx.restore();
  }

  // Shot 02: 6.2 – 13.4s (The Memory Seed & Ripples of Lived Time)
  if (t >= 6.0 && t < 13.6) {
    const localT = t - 6.5;
    const enter = smoothstep(6.0, 6.9, t);
    const exit = 1 - smoothstep(12.6, 13.5, t);
    const alpha = enter * exit;

    ctx.save();
    ctx.globalAlpha = alpha;
    drawActHeader(
      ctx,
      "PROLOGUE · 序幕",
      "当记忆拥有来源，时间开始流淌",
      "GROUNDED MEMORY & CONTINUOUS TIME",
      t,
      t < 10.5,
    );

    const cx = W / 2;
    const cy = H * 0.44;

    // Expanding concentric time rings
    for (let i = 0; i < 5; i++) {
      const rPhase = (((localT * 0.55 + i * 0.2) % 1) + 1) % 1;
      const rad = 70 + rPhase * 520;
      ctx.strokeStyle = i % 2 === 0
        ? rgba("#5ed4ae", (1 - rPhase) * 0.65)
        : rgba("#ff8fb1", (1 - rPhase) * 0.55);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Orbiting memory evidence nodes (m:1024, d:diary-14, a:promise-03, r:reading-08)
    const seeds = [
      { code: "m:1024 · 初次相遇的原话", label: "“记住，我周五下午三点面试”", angle: 0.4, dist: 270, color: "#5ed4ae" },
      { code: "b:bond · 跨群认出同一个人", label: "熟悉度 +0.18 · 亲近与信任累积", angle: 1.9, dist: 310, color: "#ff8fb1" },
      { code: "d:diary · 第 42 天睡前日记", label: "和昨天的自己对照，留下手记", angle: 3.5, dist: 280, color: "#ffc15f" },
      { code: "s:livingFor · 为自己而活的小事", label: "“想把那篇故事写完第三章”", angle: 5.1, dist: 320, color: "#8ab4ff" },
    ];

    for (const [idx, s] of seeds.entries()) {
      const sAppear = easeOutBack(clamp((localT - 0.5 - idx * 0.45) / 0.8));
      if (sAppear <= 0) continue;
      const ang = s.angle + localT * 0.22;
      const nx = cx + Math.cos(ang) * s.dist * sAppear;
      const ny = cy + Math.sin(ang) * (s.dist * 0.56) * sAppear;

      // Connecting light filament to center orb
      ctx.strokeStyle = rgba(s.color, 0.55 * sAppear);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(nx, ny);
      ctx.stroke();

      drawGlassCard(ctx, nx - 165, ny - 42, 330, 84, {
        r: 18,
        fill: "rgba(18, 28, 52, 0.82)",
        border: rgba(s.color, 0.75),
        accentBar: s.color,
      });
      ctx.font = `700 13px ${FONT_MONO}`;
      ctx.fillStyle = s.color;
      ctx.fillText(s.code, nx - 145, ny - 14);
      ctx.font = `600 16px ${FONT_SANS}`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(s.label, nx - 145, ny + 18);
    }

    // Center awakening TaOrb
    const orbScale = easeOutBack(clamp(localT / 0.9));
    drawTaOrb(ctx, cx, cy, 88 * orbScale, t, {
      mood: localT > 3.0 ? "sweet" : "calm",
      activity: "idle",
      halo: true,
    });

    ctx.textAlign = "center";
    ctx.font = `700 38px ${FONT_SERIF}`;
    ctx.fillStyle = t < 10.5 ? "#ffffff" : "#1e325c";
    ctx.fillText("如果她被允许带着记忆，走过连续的时间——", cx, 815);
    ctx.restore();
  }

  // Shot 03: 12.8 – 20.0s (Heroine Reveal & Official Brand Title Card)
  if (t >= 12.8) {
    const enter = smoothstep(12.8, 13.7, t);
    const localT = t - 13.0;
    ctx.save();
    ctx.globalAlpha = enter;

    drawActHeader(
      ctx,
      "LUCKYTRI · 统一心智",
      "让她走过的日子算数",
      "MAKE THE DAYS SHE WALKS THROUGH COUNT",
      t,
      false,
    );

    // Left: Heroine Portrait Showcase Card
    const cardSlide = easeOutCubic(clamp(localT / 0.9));
    drawCharacterCard(
      ctx,
      assets,
      96 - (1 - cardSlide) * 60,
      110,
      680,
      780,
      t,
      {
        r: 32,
        glowColor: "#5ed4ae",
        secondaryGlow: "#ff8fb1",
        speaking: t >= 13.3 && t <= 19.3,
        badge: "LuckyTri · BotRina Unified Mind",
      },
    );

    // Right: Brand Title, Core Philosophy & Living TaOrb Companion
    const rx = 840;
    const rEnter = easeOutCubic(clamp((localT - 0.25) / 0.9));
    ctx.save();
    ctx.translate((1 - rEnter) * 50, 0);

    // Official Logo Banner Strip
    drawGlassCard(ctx, rx, 115, 980, 255, {
      r: 28,
      fill: "rgba(255, 255, 255, 0.85)",
      border: "rgba(255, 255, 255, 0.96)",
    });

    // Draw TaOrb beside title
    drawTaOrb(ctx, rx + 135, 242, 74, t, {
      mood: "sweet",
      activity: t >= 13.3 && t <= 19.3 ? "speaking" : "idle",
    });

    ctx.textAlign = "left";
    ctx.font = `900 72px ${FONT_SANS}`;
    ctx.fillStyle = "#1f3562";
    ctx.fillText("LuckyTri", rx + 255, 212);
    drawFourStar(ctx, rx + 580, 162, 16, "#ffc15f", 1, t * 0.8);

    ctx.font = `700 28px ${FONT_SERIF}`;
    ctx.fillStyle = "#8a3356";
    ctx.fillText("让她走过的日子算数 · 日子还长，慢慢认识。", rx + 258, 268);

    ctx.font = `600 15px ${FONT_MONO}`;
    ctx.fillStyle = "#466db8";
    ctx.fillText(
      "v1.3.4 · BotRina Branch · Node.js >= 24.5 · Single SQLite Mind · MIT License",
      rx + 258,
      316,
    );

    // Six Core Principles Grid (3x2) from README.md
    const principles = [
      { num: "01", title: "一个她 · One Her", desc: "所有群聊与私聊共享同一份心智，认出同一个你", color: "#466db8" },
      { num: "02", title: "天性是种子 · Nature as Seed", desc: "你只写下天性，自我、面貌与关系从经历里长出来", color: "#8a3356" },
      { num: "03", title: "由心开口 · Genuine Choice", desc: "没有被 @ 必回与随机概率，可开口也可沉默并留理由", color: "#2c8465" },
      { num: "04", title: "有来源 · 可撤销 · Grounded", desc: "每条变化引用真实经历，支持一键撤销并留下墓碑", color: "#b84312" },
      { num: "05", title: "会淡去也会想起 · Salience", desc: "按她经历过的日子自然淡出，被重逢与话题重新唤醒", color: "#53368c" },
      { num: "06", title: "注意力有代价 · Bounded", desc: "扫一眼群聊 0 Token，每次调用输入恒定有上限", color: "#5667ab" },
    ];

    for (let i = 0; i < principles.length; i++) {
      const p = principles[i];
      const col = i % 2;
      const row = Math.floor(i / 2);
      const px = rx + col * 498;
      const py = 402 + row * 162;
      const pApp = easeOutBack(clamp((localT - 0.5 - i * 0.12) / 0.65));

      ctx.save();
      ctx.globalAlpha = enter * pApp;
      drawGlassCard(ctx, px, py + (1 - pApp) * 20, 482, 144, {
        r: 20,
        fill: "rgba(255, 255, 255, 0.82)",
        accentBar: p.color,
      });
      ctx.font = `800 14px ${FONT_MONO}`;
      ctx.fillStyle = p.color;
      ctx.fillText(`PRINCIPLE ${p.num}`, px + 24, py + (1 - pApp) * 20 + 36);

      ctx.font = `700 22px ${FONT_SANS}`;
      ctx.fillStyle = "#1e3158";
      ctx.fillText(p.title, px + 24, py + (1 - pApp) * 20 + 72);

      ctx.font = `500 15.5px ${FONT_SANS}`;
      ctx.fillStyle = "#526588";
      ctx.fillText(p.desc, px + 24, py + (1 - pApp) * 20 + 108);
      ctx.restore();
    }

    ctx.restore();
    ctx.restore();
  }
}

// ============================================================================
// ACT II: 00:20 – 00:46 — One Her, Attention & Genuine Choice
// ============================================================================
export function renderAct2(ctx, assets, t) {
  // Shot 04: 20.0 – 28.5s (One Her Topology + Discretion Shield: Public/Private/Confidential)
  // Shot 05: 28.5 – 37.5s (Deterministic Attention: Glance 0 Token vs Engage + 4 Choices)
  // Shot 06: 37.5 – 46.0s (Silent with a Reason + Warm Sticker/Poke/Reply Interaction)

  const moodKey = t < 28.5 ? "calm" : t < 37.5 ? "bright" : "sweet";
  drawMoodSky(ctx, assets, moodKey, t, { gardenAlpha: 0.2, particles: 30 });

  // --- SHOT 04: 20.0 – 28.5s ---
  if (t < 28.6) {
    const localT = t - 20.0;
    const enter = smoothstep(20.0, 20.7, t);
    const exit = 1 - smoothstep(27.9, 28.6, t);
    ctx.save();
    ctx.globalAlpha = enter * exit;

    drawActHeader(
      ctx,
      "ACT I · 一个她与分寸",
      "跨会话统一心智 · 私下的事只留在私下",
      "UNIFIED IDENTITY & DISCRETION BOUNDARIES",
      t,
      false,
    );

    const cx = W / 2;
    const cy = 475;

    // Central Unified Mind Core
    drawGlassCard(ctx, cx - 220, cy - 175, 440, 350, {
      r: 32,
      fill: "rgba(255, 255, 255, 0.88)",
      border: "rgba(70, 109, 184, 0.45)",
    });
    drawTaOrb(ctx, cx, cy - 35, 82, t, { mood: "calm", activity: "idle", halo: true });
    ctx.textAlign = "center";
    ctx.font = `800 24px ${FONT_SANS}`;
    ctx.fillStyle = "#1e325c";
    ctx.fillText("统一心智 · server/mind/", cx, cy + 95);
    ctx.font = `600 14px ${FONT_MONO}`;
    ctx.fillStyle = "#466db8";
    ctx.fillText("同一个账号 = 同一个你 · 记忆与关系全局连贯", cx, cy + 128);

    // Surrounding Chat Rooms (Left & Right)
    const rooms = [
      {
        x: 92,
        y: 135,
        title: "群聊 A · 周末创作群 (OneBot 11)",
        tag: "PUBLIC · 公开经历可自然衔接",
        tagColor: "#2c8465",
        msg1: "阿泽 (u:10086): “我那篇科幻短篇终于改完结局啦！”",
        msg2: "LuckyTri: “记得你上周还在卡第三幕，终于写完啦！”",
        targetX: cx - 220,
        targetY: cy - 60,
        blocked: false,
      },
      {
        x: 92,
        y: 505,
        title: "群聊 B · 游戏吹水群 (QQ 官方机器人)",
        tag: "SAME PERSON · 跨群认出阿泽 (u:10086)",
        tagColor: "#466db8",
        msg1: "阿泽 (u:10086): “今晚终于有空上来透气了”",
        msg2: "心智状态: 认出同一人 · 亲近度 0.78 · 不外泄私聊秘密",
        targetX: cx - 220,
        targetY: cy + 60,
        blocked: false,
      },
      {
        x: 1248,
        y: 135,
        title: "私聊 · 阿泽的悄悄话 (Private Session)",
        tag: "CONFIDENTIAL · 保密与私下分寸锁死",
        tagColor: "#8a3356",
        msg1: "阿泽: “其实我准备下个月偷偷辞职去上海，先别在群里说。”",
        msg2: "记忆标记: discretion = 'confidential' · 仅留在此私聊",
        targetX: cx + 220,
        targetY: cy - 60,
        blocked: false,
      },
      {
        x: 1248,
        y: 505,
        title: "分寸守卫 · server/mind/guard.js",
        tag: "BLOCKED · 跨房间检索与发送前双重拦截",
        tagColor: "#b03a4a",
        msg1: "× 群聊检索过滤：私下与保密记忆绝不进入其他房间上下文",
        msg2: "✓ 即使日记/手记引用该私聊，摘要也锁在原处，绝不外泄",
        targetX: cx + 220,
        targetY: cy + 60,
        blocked: true,
      },
    ];

    for (const [i, rm] of rooms.entries()) {
      const rApp = easeOutBack(clamp((localT - 0.25 - i * 0.18) / 0.65));
      drawGlassCard(ctx, rm.x, rm.y, 580, 310, {
        r: 24,
        fill: "rgba(255, 255, 255, 0.84)",
        accentBar: rm.tagColor,
      });

      ctx.textAlign = "left";
      ctx.font = `700 20px ${FONT_SANS}`;
      ctx.fillStyle = "#1e325c";
      ctx.fillText(rm.title, rm.x + 26, rm.y + 44);

      roundRect(ctx, rm.x + 26, rm.y + 62, 420, 28, 14);
      ctx.fillStyle = rgba(rm.tagColor, 0.14);
      ctx.fill();
      ctx.font = `700 13px ${FONT_MONO}`;
      ctx.fillStyle = rm.tagColor;
      ctx.fillText(rm.tag, rm.x + 40, rm.y + 81);

      // Message bubbles inside room card
      roundRect(ctx, rm.x + 26, rm.y + 112, 528, 72, 14);
      ctx.fillStyle = "rgba(235, 243, 255, 0.78)";
      ctx.fill();
      ctx.font = `500 15.5px ${FONT_SANS}`;
      ctx.fillStyle = "#263e69";
      ctx.fillText(rm.msg1, rm.x + 42, rm.y + 153);

      roundRect(ctx, rm.x + 26, rm.y + 202, 528, 76, 14);
      ctx.fillStyle = rm.blocked ? "rgba(255, 232, 238, 0.88)" : "rgba(230, 252, 244, 0.85)";
      ctx.fill();
      ctx.font = `600 15.5px ${FONT_SANS}`;
      ctx.fillStyle = rm.blocked ? "#9e2a3b" : "#1f5c48";
      ctx.fillText(rm.msg2, rm.x + 42, rm.y + 245);

      // Animated connection beam
      const startX = rm.x < cx ? rm.x + 580 : rm.x;
      const startY = rm.y + 155;
      ctx.save();
      ctx.strokeStyle = rm.tagColor;
      ctx.lineWidth = 3;
      ctx.setLineDash(rm.blocked ? [8, 8] : []);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(rm.targetX, rm.targetY);
      ctx.stroke();

      // Pulse dot along beam
      const pProg = (localT * 0.9 + i * 0.25) % 1;
      const px = lerp(startX, rm.targetX, pProg);
      const py = lerp(startY, rm.targetY, pProg);
      ctx.fillStyle = rm.tagColor;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  // --- SHOT 05: 28.5 – 37.5s (Attention Gate & One-Turn Decision Engine) ---
  if (t >= 28.4 && t < 37.6) {
    const localT = t - 28.5;
    const enter = smoothstep(28.4, 29.1, t);
    const exit = 1 - smoothstep(36.9, 37.6, t);
    ctx.save();
    ctx.globalAlpha = enter * exit;

    drawActHeader(
      ctx,
      "ACT I · 注意力与自主选择",
      "扫一眼群聊不花一枚 Token · 只有真正在意才细看",
      "DETERMINISTIC ATTENTION GATE & ONE-TURN CHOICE",
      t,
      false,
    );

    // Left Column: Incoming Group Stream & Attention Score Meter
    drawGlassCard(ctx, 88, 118, 840, 770, {
      r: 28,
      fill: "rgba(255, 255, 255, 0.86)",
    });

    ctx.textAlign = "left";
    ctx.font = `800 24px ${FONT_SANS}`;
    ctx.fillStyle = "#3d220c";
    ctx.fillText("注意力感知流水线 · server/mind/attention.js", 124, 168);
    ctx.font = `600 14px ${FONT_MONO}`;
    ctx.fillStyle = "#9a6512";
    ctx.fillText("DETERMINISTIC SCORING · 0 LLM CALLS FOR GLANCE", 124, 198);

    const streamMsgs = [
      { time: "14:12:04", user: "群友甲", text: "[动画表情] 哈哈哈笑死我了", mode: "GLANCE · 扫一眼", token: "0 Token", score: "0.08 < 阈值", highlight: false },
      { time: "14:12:19", user: "群友乙", text: "今晚有人一起开黑打两把吗？", mode: "GLANCE · 扫一眼", token: "0 Token", score: "0.14 · 留作未读上下文", highlight: false },
      { time: "14:13:02", user: "林夏", text: "我刚读完《传送门》实验室手记那一段，Rattmann 的涂鸦太戳人了…", mode: "ENGAGE · 细看！", token: "1 Turn Call", score: "0.86 ≥ 阈值 · 触及她的兴趣与在读资料", highlight: true },
      { time: "14:13:15", user: "阿泽", text: "@LuckyTri 你上次写的那篇雨夜灯塔更到哪啦？", mode: "ENGAGE · 细看！", token: "1 Turn Call", score: "0.94 ≥ 阈值 · 点名 + 触及 self.livingFor", highlight: true },
    ];

    for (let i = 0; i < streamMsgs.length; i++) {
      const m = streamMsgs[i];
      const mApp = easeOutCubic(clamp((localT - 0.3 - i * 0.55) / 0.6));
      const my = 232 + i * 152;
      ctx.save();
      ctx.globalAlpha = enter * exit * mApp;
      roundRect(ctx, 122, my, 772, 132, 20);
      ctx.fillStyle = m.highlight ? "rgba(255, 242, 222, 0.96)" : "rgba(244, 247, 252, 0.82)";
      ctx.fill();
      ctx.strokeStyle = m.highlight ? "#ff8a6b" : "rgba(120, 140, 175, 0.25)";
      ctx.lineWidth = m.highlight ? 2.4 : 1.2;
      ctx.stroke();

      ctx.font = `700 14px ${FONT_MONO}`;
      ctx.fillStyle = m.highlight ? "#b84312" : "#627890";
      ctx.fillText(`${m.time} · ${m.user}`, 148, my + 34);

      // Mode pill
      roundRect(ctx, 660, my + 14, 210, 30, 15);
      ctx.fillStyle = m.highlight ? "#b84312" : "rgba(98, 120, 144, 0.16)";
      ctx.fill();
      ctx.font = `700 13px ${FONT_MONO}`;
      ctx.fillStyle = m.highlight ? "#ffffff" : "#4a607a";
      ctx.fillText(`${m.mode} (${m.token})`, 676, my + 34);

      ctx.font = `600 18px ${FONT_SANS}`;
      ctx.fillStyle = "#241c33";
      ctx.fillText(m.text, 148, my + 74);

      ctx.font = `500 14px ${FONT_MONO}`;
      ctx.fillStyle = m.highlight ? "#9a4218" : "#6c7f96";
      ctx.fillText(`注意力评分: ${m.score}`, 148, my + 108);
      ctx.restore();
    }

    // Right Column: Single Turn Output Structure (Understanding + Feeling + Choice)
    drawGlassCard(ctx, 972, 118, 860, 770, {
      r: 28,
      fill: "rgba(255, 255, 255, 0.88)",
    });

    ctx.font = `800 24px ${FONT_SANS}`;
    ctx.fillStyle = "#3d220c";
    ctx.fillText("一次回合调用 · 理解、感受、选择与措辞同步生成", 1010, 168);
    ctx.font = `600 14px ${FONT_MONO}`;
    ctx.fillStyle = "#b84312";
    ctx.fillText("server/core/turn.js · NO PROBABILITY DICE · NO FORCED @-REPLY", 1010, 198);

    const choices = [
      { key: "speak", zh: "开口回应", desc: "接住具体的人与事，用自然口语说话，拒绝客服腔与模板说教", color: "#2c8465", active: true },
      { key: "react", zh: "简短反应 / 表情 / 戳一戳", desc: "给消息点个赞或爱心、发一张共同经历的表情包、轻轻回戳一下", color: "#b84312", active: true },
      { key: "decline", zh: "坦率婉拒", desc: "当话题触及底线或此刻疲惫不想继续时，诚实表达不想聊", color: "#8a3356", active: false },
      { key: "silent", zh: "安静不出声", desc: "别人聊得正欢或无需插话时保持安静，但心情与关系照样变化", color: "#466db8", active: true },
    ];

    for (let i = 0; i < choices.length; i++) {
      const c = choices[i];
      const cyCard = 232 + i * 124;
      const cApp = easeOutBack(clamp((localT - 0.6 - i * 0.25) / 0.6));
      ctx.save();
      ctx.globalAlpha = enter * exit * cApp;
      drawGlassCard(ctx, 1008, cyCard, 788, 106, {
        r: 18,
        fill: "rgba(255, 252, 246, 0.94)",
        accentBar: c.color,
      });

      roundRect(ctx, 1034, cyCard + 20, 118, 28, 14);
      ctx.fillStyle = rgba(c.color, 0.15);
      ctx.fill();
      ctx.font = `800 14px ${FONT_MONO}`;
      ctx.fillStyle = c.color;
      ctx.fillText(`choice: ${c.key}`, 1048, cyCard + 39);

      ctx.font = `700 20px ${FONT_SANS}`;
      ctx.fillStyle = "#2b1d12";
      ctx.fillText(c.zh, 1170, cyCard + 40);

      ctx.font = `500 16px ${FONT_SANS}`;
      ctx.fillStyle = "#5c4a38";
      ctx.fillText(c.desc, 1034, cyCard + 78);
      ctx.restore();
    }

    // Rich Interactive Actions Strip at Bottom Right
    drawGlassCard(ctx, 1008, 742, 788, 116, {
      r: 20,
      fill: "rgba(38, 28, 48, 0.90)",
    });
    ctx.font = `700 15px ${FONT_MONO}`;
    ctx.fillStyle = "#ffc15f";
    ctx.fillText("CAPABILITIES · 她能做的不止打字（全部由她自己决定）", 1036, 778);
    ctx.font = `600 16.5px ${FONT_SANS}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(
      "@提及 · 引用回复 · 戳一戳 · 10种表情回应 · 语义表情包 · 语音朗读/唱歌 · 分享音乐 · 发 .md 作品",
      1036,
      818,
    );

    ctx.restore();
  }

  // --- SHOT 06: 37.5 – 46.0s (The Beauty of Choosing Silence & Warm Presence) ---
  if (t >= 37.4) {
    const localT = t - 37.5;
    const enter = smoothstep(37.4, 38.1, t);
    ctx.save();
    ctx.globalAlpha = enter;

    drawActHeader(
      ctx,
      "ACT I · 由心开口与留白",
      "她可以开口，也可以选择沉默，并在心里留下理由",
      "THE FREEDOM TO SPEAK OR REMAIN SILENT WITH A REASON",
      t,
      false,
    );

    // Left: Character Card with sweet mood
    drawCharacterCard(ctx, assets, 96, 118, 620, 760, t, {
      r: 30,
      glowColor: "#ff8fbf",
      secondaryGlow: "#c5a6ff",
      speaking: t >= 41.4 && t <= 45.6,
      badge: "Mood: 甜甜 Sweet · 心里软软的",
    });

    // Right Top: Mind Choice Inspector Card (showing `choice: silent` with recorded reason)
    drawGlassCard(ctx, 766, 118, 1058, 360, {
      r: 28,
      fill: "rgba(255, 255, 255, 0.88)",
      accentBar: "#466db8",
    });

    ctx.textAlign = "left";
    ctx.font = `800 15px ${FONT_MONO}`;
    ctx.fillStyle = "#466db8";
    ctx.fillText("MIND_CHOICES RECORD · 沉默不是故障，而是有温度的体贴", 802, 162);

    ctx.font = `700 28px ${FONT_SANS}`;
    ctx.fillStyle = "#263e69";
    ctx.fillText("群聊里两个人正聊得热火朝天时，她选择了：不出声 (silent)", 802, 208);

    roundRect(ctx, 802, 234, 986, 132, 20);
    ctx.fillStyle = "rgba(236, 243, 255, 0.92)";
    ctx.fill();
    ctx.font = `600 15px ${FONT_MONO}`;
    ctx.fillStyle = "#466db8";
    ctx.fillText("inner.choice = 'silent'  |  mind_affect: valence +0.06 (替朋友高兴)", 830, 270);
    ctx.font = `700 22px ${FONT_SERIF}`;
    ctx.fillStyle = "#1e325c";
    ctx.fillText("她的内心理由：“阿泽和林夏正在兴头上对剧情，我插嘴会打断节奏，先安静听着就好。”", 830, 316);
    ctx.font = `500 15px ${FONT_SANS}`;
    ctx.fillStyle = "#5c6f91";
    ctx.fillText("✓ 即使沉默，她的心情变化、对人的熟悉度与这次相遇的意义依然真实写入心智", 830, 348);

    // Right Bottom: When someone turns to her, she responds with warmth & natural brevity
    const bApp = easeOutCubic(clamp((localT - 1.2) / 0.8));
    ctx.save();
    ctx.globalAlpha = enter * bApp;
    drawGlassCard(ctx, 766, 508, 1058, 370, {
      r: 28,
      fill: "rgba(255, 250, 253, 0.92)",
      accentBar: "#8a3356",
    });

    ctx.font = `800 15px ${FONT_MONO}`;
    ctx.fillStyle = "#8a3356";
    ctx.fillText("GENUINE CONVERSATION · 去掉客服腔与说教，像真正在过日子的朋友", 802, 552);

    // Chat comparison bubbles
    roundRect(ctx, 802, 578, 620, 66, 18);
    ctx.fillStyle = "rgba(242, 232, 248, 0.9)";
    ctx.fill();
    ctx.font = `600 18px ${FONT_SANS}`;
    ctx.fillStyle = "#3a2430";
    ctx.fillText("朋友：“还有五分钟下班，老板又突然塞活了，别给建议让我骂两句！”", 828, 618);

    roundRect(ctx, 880, 664, 908, 86, 20);
    ctx.fillStyle = "rgba(255, 224, 240, 0.95)";
    ctx.fill();
    ctx.strokeStyle = "#ff8fbf";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `700 22px ${FONT_SANS}`;
    ctx.fillStyle = "#4a1f38";
    ctx.fillText("LuckyTri：“偏偏挑快下班的时候！！来，骂出来，我陪你一起嫌弃。”", 910, 706);
    ctx.font = `600 14px ${FONT_MONO}`;
    ctx.fillStyle = "#8a3356";
    ctx.fillText("+ 表情回应 [抱抱] · 本地发送前校验通过：无客服腔 / 未强塞建议 / 接住具体情绪", 910, 735);

    drawTaOrb(ctx, 1735, 610, 48, t, { mood: "sweet", activity: "speaking" });
    ctx.restore();

    ctx.restore();
  }
}
