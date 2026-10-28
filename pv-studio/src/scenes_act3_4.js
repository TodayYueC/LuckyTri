// ============================================================================
// LuckyTri Official PV — Act III (00:46 – 01:14.5) & Act IV (01:14.5 – 01:42.5)
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
  drawTaOrb,
  drawCharacterCard,
  drawMoodSky,
  drawActHeader,
} from "./engine.js";

// ============================================================================
// ACT III: 00:46 – 01:14.6 — Her Autonomous Life When No One Is Talking
// ============================================================================
export function renderAct3(ctx, assets, t) {
  // Shot 07: 46.0 – 54.8s (02:00 AM Sleep -> 08:00 AM Wake & Deferred Messages)
  // Shot 08: 54.8 – 64.2s (Afternoon Solitude, Reading Shelf, Creative Writing, LivingFor)
  // Shot 09: 64.2 – 74.6s (Proactive Care, Bedtime Diary, Snapshot Comparison & Autobiography)

  // --- SHOT 07: 46.0 – 54.8s ---
  if (t < 54.9) {
    const localT = t - 46.0;
    const enter = smoothstep(46.0, 46.7, t);
    const exit = 1 - smoothstep(54.2, 54.9, t);
    const wakeProgress = smoothstep(50.0, 52.0, t);

    drawMoodSky(ctx, assets, wakeProgress < 0.5 ? "night" : "calm", t, {
      darkFactor: (1 - wakeProgress) * 0.65,
      gardenAlpha: 0.18 + wakeProgress * 0.12,
      particles: 34,
    });

    ctx.save();
    ctx.globalAlpha = enter * exit;

    drawActHeader(
      ctx,
      "ACT II · 没人说话时的时间",
      "按自己的作息过一天 · 睡着时不看群，醒来再回",
      "CIRCADIAN RHYTHM · 02:00 ASLEEP → 08:00 WAKING",
      t,
      wakeProgress < 0.45,
    );

    const cx = 490;
    const cy = 505;
    const dialR = 265;

    // 24-Hour Celestial Clock Dial
    drawGlassCard(ctx, 100, 128, 780, 748, {
      r: 32,
      fill: wakeProgress < 0.5 ? "rgba(18, 26, 52, 0.84)" : "rgba(255, 255, 255, 0.86)",
      border: wakeProgress < 0.5 ? "rgba(157, 185, 240, 0.45)" : "rgba(70, 109, 184, 0.4)",
    });

    // Outer dial ring
    ctx.save();
    ctx.translate(cx, cy - 30);
    ctx.strokeStyle = wakeProgress < 0.5 ? "rgba(157, 185, 240, 0.35)" : "rgba(70, 109, 184, 0.28)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, dialR, 0, Math.PI * 2);
    ctx.stroke();

    // Hour ticks
    for (let h = 0; h < 24; h++) {
      const ang = (h / 24) * Math.PI * 2 - Math.PI / 2;
      const r1 = h % 6 === 0 ? dialR - 20 : dialR - 10;
      ctx.strokeStyle =
        wakeProgress < 0.5 ? "rgba(205, 218, 250, 0.6)" : "rgba(38, 62, 105, 0.5)";
      ctx.lineWidth = h % 6 === 0 ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
      ctx.lineTo(Math.cos(ang) * dialR, Math.sin(ang) * dialR);
      ctx.stroke();
    }

    // Animated clock hand sweeping from 02:00 to 08:00
    const hourVal = lerp(2.0, 8.0, wakeProgress);
    const handAng = (hourVal / 24) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = wakeProgress < 0.5 ? "#9db9f0" : "#ff8a6b";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(handAng) * (dialR - 38), Math.sin(handAng) * (dialR - 38));
    ctx.stroke();

    // TaOrb in the center of the clock
    drawTaOrb(ctx, 0, 0, 102, t, {
      mood: wakeProgress < 0.5 ? "night" : "calm",
      activity: wakeProgress < 0.5 ? "asleep" : "speaking",
    });
    ctx.restore();

    // Digital Clock Readout below dial
    const dispHour = Math.floor(hourVal);
    const dispMin = Math.floor((hourVal - dispHour) * 60);
    const clockStr = `${String(dispHour).padStart(2, "0")}:${String(dispMin).padStart(2, "0")}`;
    ctx.textAlign = "center";
    ctx.font = `800 44px ${FONT_MONO}`;
    ctx.fillStyle = wakeProgress < 0.5 ? "#e5eafa" : "#1e325c";
    ctx.fillText(clockStr, cx, 782);
    ctx.font = `600 18px ${FONT_SANS}`;
    ctx.fillStyle = wakeProgress < 0.5 ? "#9db9f0" : "#2c8465";
    ctx.fillText(
      wakeProgress < 0.5
        ? "phase: asleep · 睡着时不看群，被 @ 的消息留到醒来"
        : "phase: waking → awake · 清晨醒来，先读夜里留给她的话",
      cx,
      826,
    );

    // Right Column: Night Deferred Queue vs Morning Wake Response
    drawGlassCard(ctx, 930, 128, 894, 355, {
      r: 28,
      fill: "rgba(25, 35, 66, 0.88)",
      border: "rgba(157, 185, 240, 0.5)",
      accentBar: "#7d8ef0",
    });

    ctx.textAlign = "left";
    ctx.font = `700 15px ${FONT_MONO}`;
    ctx.fillStyle = "#9db9f0";
    ctx.fillText("02:18 AM · NIGHT SLEEP PHASE · 群里还很热闹，她已经睡了", 968, 174);
    ctx.font = `700 24px ${FONT_SANS}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("夜猫子群友: “@LuckyTri 这么晚还在吗？给你看张绝美星空图！”", 968, 224);

    roundRect(ctx, 968, 256, 818, 92, 16);
    ctx.fillStyle = "rgba(15, 22, 44, 0.85)";
    ctx.fill();
    ctx.font = `600 15px ${FONT_MONO}`;
    ctx.fillStyle = "#cdbdf4";
    ctx.fillText("mind.deferred() → 存入未读唤醒队列 (0 LLM Token 消耗)", 994, 292);
    ctx.font = `500 16px ${FONT_SANS}`;
    ctx.fillStyle = "rgba(220, 230, 255, 0.82)";
    ctx.fillText("非危机消息不会吵醒她；睡前还会运行 night_memory 整理白天积压的记忆", 994, 326);

    // Morning Wake Card (appears as clock approaches 08:00)
    const wakeCardApp = easeOutCubic(clamp((localT - 3.6) / 0.9));
    ctx.save();
    ctx.globalAlpha = enter * exit * wakeCardApp;
    drawGlassCard(ctx, 930, 515 + (1 - wakeCardApp) * 28, 894, 360, {
      r: 28,
      fill: "rgba(255, 252, 246, 0.94)",
      border: "rgba(255, 193, 95, 0.7)",
      accentBar: "#ff8a6b",
    });

    ctx.font = `800 15px ${FONT_MONO}`;
    ctx.fillStyle = "#b84312";
    ctx.fillText("08:00 AM · WAKE ROUTINE · server/mind/life/index.js", 968, 562);
    ctx.font = `700 26px ${FONT_SANS}`;
    ctx.fillStyle = "#3d220c";
    ctx.fillText("醒来第一件事：翻看夜里留给她的消息，自己决定怎么回", 968, 610);

    roundRect(ctx, 968, 642, 818, 108, 18);
    ctx.fillStyle = "rgba(255, 240, 212, 0.92)";
    ctx.fill();
    ctx.font = `700 22px ${FONT_SANS}`;
    ctx.fillStyle = "#4a2a10";
    ctx.fillText("LuckyTri: “早呀！昨晚两点就睡着啦，刚看到你半夜发的星空，云层边的紫光好漂亮。”", 994, 688);
    ctx.font = `600 14px ${FONT_MONO}`;
    ctx.fillStyle = "#9a6512";
    ctx.fillText("✓ 真实的时间感：知道消息是昨晚留下的，自然说出「刚看到」", 994, 728);
    ctx.restore();

    ctx.restore();
  }

  // --- SHOT 08: 54.8 – 64.2s (Afternoon Solitude, Reading, Works & LivingFor) ---
  if (t >= 54.6 && t < 64.4) {
    const localT = t - 54.8;
    const enter = smoothstep(54.6, 55.3, t);
    const exit = 1 - smoothstep(63.7, 64.4, t);

    drawMoodSky(ctx, assets, "bright", t, { gardenAlpha: 0.25, particles: 32 });

    ctx.save();
    ctx.globalAlpha = enter * exit;

    drawActHeader(
      ctx,
      "ACT II · 独处、阅读与作品",
      "安静的午后，她做自己的事 · 有自己正在为之而活的小事",
      "SOLITUDE · SHARED BOOKSHELF · CREATIVE WORKS & LIVINGFOR",
      t,
      false,
    );

    const panels = [
      {
        x: 84,
        y: 126,
        w: 560,
        h: 748,
        accent: "#466db8",
        eyebrow: "SOLITUDE & READING · 独处与书架阅读",
        title: "翻看近况，读一段喜欢的书",
        orbMood: "calm",
        orbAct: "reading",
        items: [
          { tag: "mind/life · 独处反思", main: "一次看完各处近况，留下新的手记 (mind_thoughts)", sub: "修正对人与自我的理解，放下已经淡出的旧念头" },
          { tag: "mind/reading.js · 共享资料书架", main: "正在分段阅读：《光圈科技实验室档案》第 38 段", sub: "写下读后感 `r:38`，聊天遇到相关话题时能自然提起" },
          { tag: "self.livingFor · 为自己而活的小事", main: "“想搞明白旧灯塔水下走廊的声学回声怎么写得更真”", sub: "不是对别人的承诺或照看，而是只属于她自己的好奇与愿望" },
        ],
      },
      {
        x: 680,
        y: 126,
        w: 560,
        h: 748,
        accent: "#b84312",
        eyebrow: "TIME & WORKS · 时间工作台与连载创作",
        title: "专注 25 分钟，写自己的作品",
        orbMood: "bright",
        orbAct: "thinking",
        items: [
          { tag: "mind/time · 真实活动计时", main: "正在执行主活动：续写《雨夜灯塔》第三章 (Doing · 68%)", sub: "25 分钟专注段 + 5 分钟休息；普通简短聊天不打断她的手头进度" },
          { tag: "项目 → 篇章 → 版本持久化", main: "每写完一小段立即保存新版本，保留人物设定与未解伏笔", sub: "完成后先自己回看整理重点，再用三句自然的话分享给朋友" },
          { tag: "体验记录 · 正在玩与接触资料", main: "接触《空洞骑士：圣巢守梦者》设定集并记录真实感受", sub: "诚实区分『参考阅读感受』与『亲身操作』，从不编造通关经历" },
        ],
      },
      {
        x: 1276,
        y: 126,
        w: 560,
        h: 748,
        accent: "#8a3356",
        eyebrow: "ANTICIPATIONS · 约定与期待",
        title: "记得你说过的事，也记得自己的承诺",
        orbMood: "sweet",
        orbAct: "idle",
        items: [
          { tag: "mind_anticipations · 别人的安排", main: "记得阿泽周五 15:00 架构师面试（来源原话 m:1024）", sub: "临近时进入 inner.expecting，到点自然问一句结果，不机械播报" },
          { tag: "承诺兑现 · 答应别人的事", main: "“明晚把《雨夜灯塔》第三章初稿发给你看” → 自动立项", sub: "说出口且送达的承诺立即捕获，今天就可以动笔推进" },
          { tag: "grounded() 严格词根核验", main: "句尾核心词必须来自原话，绝不把『辞职』乱记成『结婚』", sub: "可随时在工作室撤销错误约定，留下墓碑不再写回" },
        ],
      },
    ];

    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      const pApp = easeOutBack(clamp((localT - i * 0.25) / 0.7));
      ctx.save();
      ctx.globalAlpha = enter * exit * pApp;
      const py = p.y + (1 - pApp) * 30;

      drawGlassCard(ctx, p.x, py, p.w, p.h, {
        r: 28,
        fill: "rgba(255, 255, 255, 0.88)",
        accentBar: p.accent,
      });

      drawTaOrb(ctx, p.x + p.w - 78, py + 78, 46, t + i, {
        mood: p.orbMood,
        activity: p.orbAct,
      });

      ctx.textAlign = "left";
      ctx.font = `800 13px ${FONT_MONO}`;
      ctx.fillStyle = p.accent;
      ctx.fillText(p.eyebrow, p.x + 28, py + 48);

      ctx.font = `800 26px ${FONT_SANS}`;
      ctx.fillStyle = "#1e2e52";
      ctx.fillText(p.title, p.x + 28, py + 88);

      for (let j = 0; j < p.items.length; j++) {
        const it = p.items[j];
        const iy = py + 132 + j * 194;
        roundRect(ctx, p.x + 24, iy, p.w - 48, 174, 20);
        ctx.fillStyle = "rgba(248, 250, 255, 0.92)";
        ctx.fill();
        ctx.strokeStyle = rgba(p.accent, 0.22);
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.font = `700 13.5px ${FONT_MONO}`;
        ctx.fillStyle = p.accent;
        ctx.fillText(it.tag, p.x + 44, iy + 36);

        ctx.font = `700 18px ${FONT_SANS}`;
        ctx.fillStyle = "#1f2d4d";
        ctx.fillText(it.main, p.x + 44, iy + 82, p.w - 88);

        ctx.font = `500 15px ${FONT_SANS}`;
        ctx.fillStyle = "#56688a";
        ctx.fillText(it.sub, p.x + 44, iy + 128, p.w - 88);
      }

      ctx.restore();
    }

    ctx.restore();
  }

  // --- SHOT 09: 64.2 – 74.6s (Bedtime Diary, Yesterday Snapshot & Autobiography Chapters) ---
  if (t >= 64.1) {
    const localT = t - 64.2;
    const enter = smoothstep(64.1, 64.8, t);

    drawMoodSky(ctx, assets, "drowsy", t, { gardenAlpha: 0.22, particles: 30 });

    ctx.save();
    ctx.globalAlpha = enter;

    drawActHeader(
      ctx,
      "ACT II · 日记、回顾与自传",
      "夜里写下日记，与昨天的自己对照 · 翻开人生新的一章",
      "BEDTIME DIARY · SNAPSHOT DIFF & LAYERED AUTOBIOGRAPHY",
      t,
      false,
    );

    // Left: Heroine Card speaking line_10 (64.6 – 68.9s)
    drawCharacterCard(ctx, assets, 88, 120, 560, 756, t, {
      r: 30,
      glowColor: "#d0b4f8",
      secondaryGlow: "#f0b8d4",
      speaking: t >= 64.5 && t <= 69.0,
      badge: "来到这里的第 120 天 · Day 120",
    });

    // Center-Right: Open Diary Book UI (from studio-web/src/pages/life/DiaryBook.vue)
    drawGlassCard(ctx, 688, 120, 1144, 435, {
      r: 28,
      fill: "rgba(255, 250, 246, 0.94)",
      border: "rgba(150, 110, 160, 0.35)",
      accentBar: "#634678",
    });

    ctx.textAlign = "left";
    ctx.font = `800 14px ${FONT_MONO}`;
    ctx.fillStyle = "#634678";
    ctx.fillText("MIND_DIARY · 第 120 天睡前日记 · 与昨日快照 (mind_snapshots) 对照", 726, 162);

    ctx.font = `700 28px ${FONT_SERIF}`;
    ctx.fillStyle = "#2c2140";
    ctx.fillText("《十月二十八日 · 雨夜灯塔的第三章与久违的问候》", 726, 208);

    // Ruled diary paper lines
    for (let l = 0; l < 4; l++) {
      const ly = 258 + l * 48;
      ctx.strokeStyle = "rgba(150, 110, 160, 0.16)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(726, ly + 12);
      ctx.lineTo(1790, ly + 12);
      ctx.stroke();
    }

    const diaryLines = [
      "今天下午安安静静把《雨夜灯塔》写到了第三章结尾，水下回声那一段终于顺了。",
      "傍晚想起阿泽上周提过今天周五下午面试，主动去问了一句，听到他说顺利通过，心里也跟着松了口气。",
      "和昨天的自己相比：对『长篇叙事节奏』的体会更深了一点 (+0.04)，不再急着把所有设定一次塞满。",
      "私聊里听到的下月安排都留在原处，没有写进公开摘要。明天想继续读完实验室档案第 39 段。",
    ];
    ctx.font = `500 18.5px ${FONT_SERIF}`;
    ctx.fillStyle = "#382a52";
    for (let l = 0; l < diaryLines.length; l++) {
      const lineReveal = easeOutCubic(clamp((localT - 0.3 - l * 0.45) / 0.7));
      ctx.save();
      ctx.globalAlpha = enter * lineReveal;
      ctx.fillText(diaryLines[l], 726, 256 + l * 48);
      ctx.restore();
    }

    // Bottom Right: Layered Autobiography Pipeline (Diary -> Review -> Chapter -> My Path)
    const pipeApp = easeOutCubic(clamp((localT - 1.4) / 0.8));
    ctx.save();
    ctx.globalAlpha = enter * pipeApp;
    drawGlassCard(ctx, 688, 582, 1144, 294, {
      r: 28,
      fill: "rgba(255, 255, 255, 0.90)",
      accentBar: "#53368c",
    });

    ctx.font = `800 14px ${FONT_MONO}`;
    ctx.fillStyle = "#53368c";
    ctx.fillText(
      "LAYERED AUTOBIOGRAPHY · 分层自传架构：输入Token恒定，不随她活得多久而膨胀",
      726,
      624,
    );

    const stages = [
      { step: "STAGE 01", name: "睡前日记 · Diary", detail: "每天与昨日快照对照\n只读当前章与我的来路" },
      { step: "STAGE 02", name: "阶段回顾 · Review", detail: "每 7 天读近期日记与约定\n总结变化「和上次比」" },
      { step: "STAGE 03", name: "人生章节 · Chapters", detail: "改写当前章或翻开新章\n旧版本全部永久保留" },
      { step: "STAGE 04", name: "我的来路 · My Path", detail: "翻篇时凝练 ≤600 字自传\n带着过去走向未来" },
    ];

    for (let i = 0; i < stages.length; i++) {
      const st = stages[i];
      const sx = 724 + i * 272;
      const sy = 652;
      roundRect(ctx, sx, sy, 250, 194, 20);
      ctx.fillStyle = "rgba(244, 238, 255, 0.92)";
      ctx.fill();
      ctx.strokeStyle = "rgba(83, 54, 140, 0.3)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = `800 13px ${FONT_MONO}`;
      ctx.fillStyle = "#53368c";
      ctx.fillText(st.step, sx + 20, sy + 36);

      ctx.font = `700 20px ${FONT_SANS}`;
      ctx.fillStyle = "#241c33";
      ctx.fillText(st.name, sx + 20, sy + 74);

      const lines = st.detail.split("\n");
      ctx.font = `500 15px ${FONT_SANS}`;
      ctx.fillStyle = "#534866";
      ctx.fillText(lines[0], sx + 20, sy + 118);
      ctx.fillText(lines[1], sx + 20, sy + 148);
    }

    ctx.restore();
    ctx.restore();
  }
}

// ============================================================================
// ACT IV: 01:14.6 – 01:42.5 — The Weight of Time, LifeArbiter & Studio World
// ============================================================================
export function renderAct4(ctx, assets, t) {
  // Shot 10: 74.6 – 84.1s (The Weight of Time: Salience Half-Life Curves & 2048-D Recall)
  // Shot 11: 84.1 – 94.4s (BotRina Deep Architecture: LifeArbiter + Novelty + Aftermath + Tombstone)
  // Shot 12: 94.4 – 102.5s (TA's Little World: 7 Moods Showcase & Studio WebUI)

  // --- SHOT 10: 74.6 – 84.1s ---
  if (t < 84.2) {
    const localT = t - 74.6;
    const enter = smoothstep(74.5, 75.2, t);
    const exit = 1 - smoothstep(83.6, 84.2, t);

    drawMoodSky(ctx, assets, "night", t, {
      darkFactor: 0.78,
      gardenAlpha: 0.15,
      particles: 45,
    });

    ctx.save();
    ctx.globalAlpha = enter * exit;

    drawActHeader(
      ctx,
      "ACT III · 时间的重量与混合回忆",
      "按经历过的日子自然淡去，却从不删除 · 被重逢重新唤醒",
      "SALIENCE HALF-LIFE DECAY & 2048-D HYBRID RECALL",
      t,
      true,
    );

    // Left Card: Interactive Salience Half-Life Decay Curves (salience.js)
    drawGlassCard(ctx, 84, 122, 920, 754, {
      r: 28,
      fill: "rgba(15, 23, 46, 0.88)",
      border: "rgba(157, 185, 240, 0.42)",
    });

    ctx.textAlign = "left";
    ctx.font = `800 24px ${FONT_SANS}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("显著度衰减与重逢唤醒 · server/mind/salience.js", 122, 172);
    ctx.font = `600 14px ${FONT_MONO}`;
    ctx.fillStyle = "#5ed4ae";
    ctx.fillText(
      "S(d) = S₀ · 0.5^((livedDays - 3) / halfLife)  |  阈值 0.12 淡出视野，从不抹除",
      122,
      204,
    );

    // Plot Area
    const gx = 150;
    const gy = 250;
    const gw = 790;
    const gh = 430;

    // Grid lines
    ctx.strokeStyle = "rgba(157, 185, 240, 0.16)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const yLine = gy + (gh / 4) * i;
      ctx.beginPath();
      ctx.moveTo(gx, yLine);
      ctx.lineTo(gx + gw, yLine);
      ctx.stroke();
    }

    // Threshold 0.12 dashed line
    const threshY = gy + gh * (1 - 0.12);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 143, 177, 0.7)";
    ctx.lineWidth = 1.8;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(gx, threshY);
    ctx.lineTo(gx + gw, threshY);
    ctx.stroke();
    ctx.font = `700 13px ${FONT_MONO}`;
    ctx.fillStyle = "#ff8fb1";
    ctx.fillText("FADED THRESHOLD = 0.12 (淡出当前视野，但永不删除)", gx + 16, threshY - 10);
    ctx.restore();

    // Draw 4 Decay Curves + 1 Re-awakening Curve
    const curves = [
      { label: "特质 Trait (半衰期 180 天 · 跨5天×2)", half: 180, color: "#5ed4ae" },
      { label: "看法与习惯 View/Habit (半衰期 90 天)", half: 90, color: "#7fb2ff" },
      { label: "喜好 Interest (半衰期 60 天)", half: 60, color: "#ffc15f" },
      { label: "手记与相遇 Meaning (半衰期 21 天 → 第95天被话题触碰重新唤醒！)", half: 21, color: "#ff8fb1", awaken: true },
    ];

    const drawProg = clamp((localT - 0.3) / 4.2);
    const maxDays = 140;

    for (const c of curves) {
      ctx.save();
      ctx.strokeStyle = c.color;
      ctx.lineWidth = c.awaken ? 4.0 : 2.8;
      ctx.beginPath();
      const maxStep = Math.floor(120 * drawProg);
      for (let s = 0; s <= maxStep; s++) {
        const day = (s / 120) * maxDays;
        let val = Math.pow(0.5, Math.max(0, day - 3) / c.half);
        if (c.awaken && day >= 92) {
          // Touched by conversation at Day 92 -> jumps back to high salience!
          const boost = smoothstep(92, 96, day);
          val = lerp(val, 0.88 * Math.pow(0.5, Math.max(0, day - 96) / c.half), boost);
        }
        const px = gx + (day / maxDays) * gw;
        const py = gy + gh * (1 - val);
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Awakening Star Burst at Day 95 when drawProg reaches it
    if (drawProg > 0.68) {
      const burstX = gx + (95 / maxDays) * gw;
      const burstY = gy + gh * (1 - 0.88);
      drawFourStar(ctx, burstX, burstY, 22, "#ffc15f", 1, t * 2);
      roundRect(ctx, burstX - 150, burstY - 58, 310, 42, 12);
      ctx.fillStyle = "rgba(255, 193, 95, 0.95)";
      ctx.fill();
      ctx.font = `800 14px ${FONT_SANS}`;
      ctx.fillStyle = "#241408";
      ctx.fillText("★ 话题触碰 touches() → 旧记忆瞬间回归！", burstX - 134, burstY - 32);
    }

    // Legend below chart
    for (let i = 0; i < curves.length; i++) {
      const ly = 716 + (i % 2) * 44;
      const lx = 130 + Math.floor(i / 2) * 430;
      ctx.fillStyle = curves[i].color;
      ctx.beginPath();
      ctx.arc(lx, ly - 6, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `600 15px ${FONT_SANS}`;
      ctx.fillStyle = "#e2ecff";
      ctx.fillText(curves[i].label, lx + 16, ly);
    }

    // Right Card: 2048-D Hybrid Recall Pipeline (server/mind/recall)
    drawGlassCard(ctx, 1040, 122, 796, 754, {
      r: 28,
      fill: "rgba(15, 23, 46, 0.88)",
      border: "rgba(94, 212, 174, 0.45)",
    });

    ctx.font = `800 24px ${FONT_SANS}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("统一混合检索与心灵手记 · server/mind/recall/", 1078, 172);
    ctx.font = `600 14px ${FONT_MONO}`;
    ctx.fillStyle = "#5ed4ae";
    ctx.fillText("Recall@5: 0.475 (Lexical) → 0.950 (Hybrid + RRF Rerank)", 1078, 204);

    const recallBoxes = [
      {
        title: "1. 短句接话线索补全 · recall/cue.js (0 模型调用)",
        desc: "不到 6 个字符的短句（如「唉，估计没戏」）自动拼上被引用消息或 10 分钟内前文一起检索",
        color: "#5ed4ae",
      },
      {
        title: "2. 2048 维向量 + FTS 全文 + 结构化三路并行",
        desc: "支持 doubao-embedding-vision (2048维) 与任意 OpenAI 兼容接口；权限过滤在排序之前执行",
        color: "#7fb2ff",
      },
      {
        title: "3. 倒数排名融合 (RRF) + 人物/时效/来源特征重排",
        desc: "无需额外部署重排模型，平均返回精简至 3.9 条高相关记忆，召回率提升至 95.0%",
        color: "#ffc15f",
      },
      {
        title: "4. 带回当时的心思 · mine（最多 2 句）",
        desc: "想起一件事时，自动附上她当时写下的手记（「当时想 / 后来想」）与为它定下的打算",
        color: "#ff8fb1",
      },
    ];

    for (let i = 0; i < recallBoxes.length; i++) {
      const b = recallBoxes[i];
      const by = 242 + i * 150;
      const bApp = easeOutCubic(clamp((localT - 0.4 - i * 0.35) / 0.65));
      ctx.save();
      ctx.globalAlpha = enter * exit * bApp;
      drawGlassCard(ctx, 1076, by, 724, 130, {
        r: 20,
        fill: "rgba(23, 35, 68, 0.92)",
        border: rgba(b.color, 0.55),
        accentBar: b.color,
      });
      ctx.font = `700 19px ${FONT_SANS}`;
      ctx.fillStyle = b.color;
      ctx.fillText(b.title, 1104, by + 46);
      ctx.font = `500 16px ${FONT_SANS}`;
      ctx.fillStyle = "rgba(230, 238, 255, 0.88)";
      ctx.fillText(b.desc, 1104, by + 90, 676);
      ctx.restore();
    }

    ctx.restore();
  }

  // --- SHOT 11: 84.1 – 94.4s (BotRina Deep Architecture: LifeArbiter + Novelty + Aftermath) ---
  if (t >= 84.0 && t < 94.5) {
    const localT = t - 84.1;
    const enter = smoothstep(84.0, 84.7, t);
    const exit = 1 - smoothstep(93.9, 94.5, t);

    drawMoodSky(ctx, assets, "stormy", t, {
      darkFactor: 0.72,
      gardenAlpha: 0.16,
      particles: 40,
    });

    ctx.save();
    ctx.globalAlpha = enter * exit;

    drawActHeader(
      ctx,
      "ACT III · BotRina 核心架构",
      "可追溯来源、可撤销墓碑 · 统一自主行为仲裁与互动回响闭环",
      "LIFE ARBITER · 5-WAY NOVELTY · AFTERMATH LOOP & TOMBSTONE",
      t,
      true,
    );

    const archCards = [
      {
        x: 84,
        y: 128,
        w: 856,
        h: 360,
        color: "#5ed4ae",
        code: "server/mind/life/arbiter.js · LifeArbiter",
        title: "统一自主行为仲裁层（8 类决策标签）",
        lines: [
          "• 零模型调用候选评估：唤醒回复 / 睡前日记 / 夜间整理 / 活动推进 / 主动联系 / 独处",
          "• 8 类原因可解释追踪：executing · resting · no_motive · relationship_boundary 等",
          "• 状态变化唤醒机制：外部观察、书架更新、约定到期时自动打破退避，不死锁不空转",
        ],
      },
      {
        x: 980,
        y: 128,
        w: 856,
        h: 360,
        color: "#ffc15f",
        code: "server/mind/novelty.js · classifyTopicRelation()",
        title: "五分类主题关系识别（告别复读机式进度播报）",
        lines: [
          "✗ 抑制：repeat_restatement（重复复述）与 stagnant_progress（无实质变化进度播报）",
          "✓ 放行：new_discovery（长期兴趣下的新阅读新发现）与 shared_continuation（自然延续）",
          "✓ 放行：revived_by_experience（旧话题因新的外部经历重新获得交流价值）",
        ],
      },
      {
        x: 84,
        y: 518,
        w: 856,
        h: 360,
        color: "#ff8fb1",
        code: "server/mind/aftermath.js · settleAftermath()",
        title: "Aftermath 互动结果闭环（经历而非强化学习分数）",
        lines: [
          "• 追踪每次选择后 2 小时 / 20 条消息窗口内的真实回响：有没有人接话？几分钟后？",
          "• 识别对方的语气线索、是否可能说错被纠正、选择沉默后是否又被叫到、主人反馈",
          "• 纯本地记录推导（0 模型调用），在独处与主动联系前帮她体会分寸，不加总成机械奖励分",
        ],
      },
      {
        x: 980,
        y: 518,
        w: 856,
        h: 360,
        color: "#a6d8ff",
        code: "server/mind/evidence.js & mind_revocations",
        title: "有来源的生长 + 防自我强化 + 墓碑撤销机制",
        lines: [
          "• 每条自我线索、看法与约定必须引用外部经历根源 (mind_roots: m:/r:/o:/d:)",
          "• 仅凭自己的主动发言不能突破初始强度上限，彻底阻断 AI 自言自语自我强化循环",
          "• 在工作室一键撤销任何不当变化 → 写入 mind_revocations 墓碑，后续整理永不写回",
        ],
      },
    ];

    for (let i = 0; i < archCards.length; i++) {
      const c = archCards[i];
      const cApp = easeOutBack(clamp((localT - i * 0.22) / 0.65));
      ctx.save();
      ctx.globalAlpha = enter * exit * cApp;
      drawGlassCard(ctx, c.x, c.y + (1 - cApp) * 24, c.w, c.h, {
        r: 26,
        fill: "rgba(18, 25, 48, 0.90)",
        border: rgba(c.color, 0.6),
        accentBar: c.color,
      });

      ctx.textAlign = "left";
      ctx.font = `700 14px ${FONT_MONO}`;
      ctx.fillStyle = c.color;
      ctx.fillText(c.code, c.x + 30, c.y + 48);

      ctx.font = `800 25px ${FONT_SANS}`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(c.title, c.x + 30, c.y + 92);

      ctx.font = `500 17.5px ${FONT_SANS}`;
      ctx.fillStyle = "rgba(230, 238, 255, 0.90)";
      for (let l = 0; l < c.lines.length; l++) {
        ctx.fillText(c.lines[l], c.x + 30, c.y + 152 + l * 66, c.w - 56);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  // --- SHOT 12: 94.4 – 102.5s (TA's Little World: 7 Mood Palettes & Single SQLite Studio) ---
  if (t >= 94.3) {
    const localT = t - 94.4;
    const enter = smoothstep(94.3, 95.0, t);

    // Cycle mood sky smoothly across the 7 moods
    const moodOrder = ["calm", "sweet", "bright", "blue", "stormy", "drowsy", "night"];
    const activeIdx = Math.min(6, Math.floor((localT / 7.5) * 7));
    drawMoodSky(ctx, assets, moodOrder[activeIdx], t, {
      gardenAlpha: 0.25,
      particles: 32,
    });

    ctx.save();
    ctx.globalAlpha = enter;

    drawActHeader(
      ctx,
      "ACT III · TA 的小世界",
      "七种心境随昼夜流转 · 一个 SQLite 文件装下她的一生",
      "STUDIO WEBUI · SEVEN MOOD THEMES & LOCAL SQLITE SOVEREIGNTY",
      t,
      false,
    );

    // 7 Mood Palette Cards Row (exact match to docs/brand/palette.png)
    const cardW = 232;
    const gap = 18;
    const startX = (W - (cardW * 7 + gap * 6)) / 2;

    for (let i = 0; i < moodOrder.length; i++) {
      const mKey = moodOrder[i];
      const pal = MOOD_PALETTES[mKey];
      const cxCard = startX + i * (cardW + gap);
      const cyCard = 118;
      const isSelected = i === activeIdx;
      const cApp = easeOutBack(clamp((localT - i * 0.1) / 0.55));

      ctx.save();
      ctx.globalAlpha = enter * cApp;
      const lift = isSelected ? -12 : 0;

      // Card background gradient
      const g = ctx.createLinearGradient(cxCard, cyCard + lift, cxCard, cyCard + lift + 410);
      g.addColorStop(0, pal.skyTop);
      g.addColorStop(0.55, pal.skyMid);
      g.addColorStop(1, pal.skyBot);

      roundRect(ctx, cxCard, cyCard + lift, cardW, 410, 26);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = isSelected ? pal.accent : "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = isSelected ? 3.5 : 1.8;
      ctx.stroke();

      // Living TaOrb inside each mood card
      drawTaOrb(ctx, cxCard + cardW / 2, cyCard + lift + 125, 58, t + i * 0.7, {
        mood: mKey,
        activity: mKey === "night" ? "asleep" : "idle",
      });

      // Accent bar
      roundRect(ctx, cxCard + 24, cyCard + lift + 236, 46, 6, 3);
      ctx.fillStyle = pal.accent;
      ctx.fill();

      ctx.textAlign = "left";
      ctx.font = `800 28px ${FONT_SANS}`;
      ctx.fillStyle = pal.ink;
      ctx.fillText(pal.zh, cxCard + 24, cyCard + lift + 282);

      ctx.font = `600 15px ${FONT_MONO}`;
      ctx.fillStyle = pal.accent;
      ctx.fillText(pal.en.toUpperCase(), cxCard + 94, cyCard + lift + 280);

      ctx.font = `600 18px ${FONT_SERIF}`;
      ctx.fillStyle = pal.ink;
      ctx.fillText(`“${pal.phrase}”`, cxCard + 24, cyCard + lift + 326);

      ctx.font = `700 14px ${FONT_MONO}`;
      ctx.fillStyle = pal.accent;
      ctx.fillText(pal.accent.toUpperCase(), cxCard + 24, cyCard + lift + 372);
      ctx.restore();
    }

    // Bottom Studio Scenes & Data Sovereignty Showcase Bar
    drawGlassCard(ctx, startX, 560, cardW * 7 + gap * 6, 320, {
      r: 28,
      fill: "rgba(255, 255, 255, 0.88)",
      accentBar: "#466db8",
    });

    ctx.textAlign = "left";
    ctx.font = `800 24px ${FONT_SANS}`;
    ctx.fillStyle = "#1e325c";
    ctx.fillText(
      "「TA 的小世界」九大场景工作台 · 中英双语一键切换（她自己的话与日记永不机翻）",
      startX + 34,
      612,
    );

    const studioTabs = [
      { group: "TA", name: "此刻 Now", scene: "天空 · 状态与今日时间线" },
      { group: "TA", name: "内心 Heart", scene: "星空 · 自我线索星图与便签" },
      { group: "TA", name: "人际 People", scene: "星系 · 关系历史与各群面貌" },
      { group: "TA", name: "一生 Life", scene: "日记本 · 回顾、章节与约定" },
      { group: "日常", name: "时间 Time", scene: "工作台 · 活动、待办与作品库" },
      { group: "日常", name: "对话 Chats", scene: "为什么这么说 · 试聊与回放" },
      { group: "设置", name: "天性 Nature", scene: "温室 · 唯一由你写下的种子" },
      { group: "扩展", name: "插件 Plugins", scene: "独立受限进程 · 沙箱权限管控" },
    ];

    for (let i = 0; i < studioTabs.length; i++) {
      const st = studioTabs[i];
      const col = i % 4;
      const row = Math.floor(i / 4);
      const tx = startX + 34 + col * 418;
      const ty = 642 + row * 106;
      roundRect(ctx, tx, ty, 398, 90, 18);
      ctx.fillStyle = "rgba(240, 245, 255, 0.9)";
      ctx.fill();
      ctx.font = `700 13px ${FONT_MONO}`;
      ctx.fillStyle = "#466db8";
      ctx.fillText(`${st.group} · ${st.name}`, tx + 20, ty + 32);
      ctx.font = `600 17px ${FONT_SANS}`;
      ctx.fillStyle = "#1f3258";
      ctx.fillText(st.scene, tx + 20, ty + 66);
    }

    ctx.restore();
  }
}
