// ============================================================================
// LuckyTri Official PV — Core Math, Easing, Color Palettes & TaOrb Engine
// ============================================================================

export const W = 1920;
export const H = 1080;
export const FPS = 60;
export const TOTAL_DURATION = 126.0;
export const TOTAL_FRAMES = TOTAL_DURATION * FPS; // 7560

export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
export const remap = (v, in0, in1, out0 = 0, out1 = 1) =>
  lerp(out0, out1, (v - in0) / (in1 - in0 || 1e-6));

export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInCubic = (t) => Math.pow(clamp(t), 3);
export const easeInOutCubic = (t) => {
  const x = clamp(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOutQuint = (t) => 1 - Math.pow(1 - clamp(t), 5);
export const easeOutBack = (t, s = 1.45) => {
  const c = clamp(t);
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  const x = c - 1;
  return Math.max(0, 1 + (s + 1) * x * x * x + s * x * x);
};
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
};

// Hex to RGB / RGBA helpers
export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, alpha = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

export function lerpColor(hexA, hexB, t) {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const k = clamp(t);
  const r = Math.round(lerp(r1, r2, k));
  const g = Math.round(lerp(g1, g2, k));
  const b = Math.round(lerp(b1, b2, k));
  return `rgb(${r}, ${g}, ${b})`;
}

// Official 7 Mood Palettes from studio-web/src/styles/themes.css & docs/brand/palette.png
export const MOOD_PALETTES = {
  calm: {
    key: "calm",
    zh: "平静",
    en: "Calm",
    phrase: "像一杯温水",
    skyTop: "#d9e9ff",
    skyMid: "#f1f6ff",
    skyBot: "#fff5f2",
    glowA: "#a6d8ff",
    glowB: "#efd5fa",
    accent: "#466db8",
    ink: "#263e69",
    orbA: "#d8fff0",
    orbB: "#5ed4ae",
    orbC: "#3a9ec4",
    orbFace: "#143b34",
    cheek: "#ff9db1",
  },
  sweet: {
    key: "sweet",
    zh: "甜甜",
    en: "Sweet",
    phrase: "心里软软的",
    skyTop: "#f9e3f3",
    skyMid: "#fdf1f9",
    skyBot: "#eeeaff",
    glowA: "#f7badb",
    glowB: "#cbd2ff",
    accent: "#8a3356",
    ink: "#3a2430",
    orbA: "#ffe0f0",
    orbB: "#ff8fbf",
    orbC: "#c5a6ff",
    orbFace: "#4a1f38",
    cheek: "#ff6f9f",
  },
  bright: {
    key: "bright",
    zh: "雀跃",
    en: "Bright",
    phrase: "想蹦起来",
    skyTop: "#fff0ca",
    skyMid: "#fff8eb",
    skyBot: "#ffebdf",
    glowA: "#ffdc88",
    glowB: "#ffc8b8",
    accent: "#b84312",
    ink: "#3d220c",
    orbA: "#fff3ae",
    orbB: "#ffc15f",
    orbC: "#ff8a6b",
    orbFace: "#4a2a10",
    cheek: "#ff7b6b",
  },
  blue: {
    key: "blue",
    zh: "低落",
    en: "Blue",
    phrase: "有点灰灰的",
    skyTop: "#b7d0f2",
    skyMid: "#d5e4f6",
    skyBot: "#e7eef8",
    glowA: "#6aa4ee",
    glowB: "#b7c8ea",
    accent: "#245488",
    ink: "#172433",
    orbA: "#e4eefc",
    orbB: "#8aafdc",
    orbC: "#5d7eae",
    orbFace: "#1e2b3f",
    cheek: "#c8a0b5",
  },
  stormy: {
    key: "stormy",
    zh: "烦躁",
    en: "Stormy",
    phrase: "心里起风了",
    skyTop: "#e3def4",
    skyMid: "#eeebf7",
    skyBot: "#e8ecf6",
    glowA: "#c8b8ed",
    glowB: "#bcc9e5",
    accent: "#53368c",
    ink: "#241c33",
    orbA: "#ece4f8",
    orbB: "#a894d4",
    orbC: "#6e5f9e",
    orbFace: "#231a36",
    cheek: "#c99ab8",
  },
  drowsy: {
    key: "drowsy",
    zh: "困倦",
    en: "Drowsy",
    phrase: "眼皮在打架",
    skyTop: "#e8e0fa",
    skyMid: "#f5eef9",
    skyBot: "#fff1e9",
    glowA: "#d2c4f5",
    glowB: "#f5d3c9",
    accent: "#634678",
    ink: "#2c2140",
    orbA: "#f4e9ff",
    orbB: "#d0b4f8",
    orbC: "#f0b8d4",
    orbFace: "#30264a",
    cheek: "#f3a3c0",
  },
  night: {
    key: "night",
    zh: "夜晚",
    en: "Night",
    phrase: "睡着了",
    skyTop: "#cbdafa",
    skyMid: "#e5eafa",
    skyBot: "#f8edfa",
    glowA: "#9db9f0",
    glowB: "#cdbdf4",
    accent: "#5667ab",
    ink: "#29375e",
    orbA: "#d0d8ff",
    orbB: "#7d8ef0",
    orbC: "#4d5cc0",
    orbFace: "#0f1433",
    cheek: "#c9a0e0",
  },
};

export const FONT_SANS = '"Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif';
export const FONT_SERIF = '"Noto Serif CJK SC", "Noto Sans CJK SC", serif';
export const FONT_MONO = '"JetBrains Mono", "Cascadia Mono", "Noto Sans Mono CJK SC", monospace';

// Rounded rectangle path helper
export function roundRect(ctx, x, y, w, h, r = 16) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// Draw frosted glass card with subtle border & sheen
export function drawGlassCard(ctx, x, y, w, h, opts = {}) {
  const {
    r = 22,
    fill = "rgba(255, 255, 255, 0.78)",
    border = "rgba(255, 255, 255, 0.92)",
    shadowColor = "rgba(38, 62, 105, 0.16)",
    shadowBlur = 32,
    shadowY = 14,
    accentBar = null,
  } = opts;

  ctx.save();
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = shadowBlur;
  ctx.shadowOffsetY = shadowY;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = border;
  ctx.lineWidth = opts.lineWidth || 1.5;
  ctx.stroke();

  if (accentBar) {
    ctx.clip();
    ctx.fillStyle = accentBar;
    ctx.fillRect(x, y, 6, h);
  }
  ctx.restore();
}

// Draw 4-point star sparkle
export function drawFourStar(ctx, cx, cy, r, color = "#FFD86B", alpha = 1, rot = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.quadraticCurveTo(0, 0, 0, r);
  ctx.quadraticCurveTo(0, 0, -r, 0);
  ctx.quadraticCurveTo(0, 0, 0, -r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Draw cherry blossom petal
export function drawSakuraPetal(ctx, x, y, size, rot, color = "#FF9EBB", alpha = 0.75) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.bezierCurveTo(size * 0.85, -size * 0.6, size * 0.9, size * 0.5, 0, size);
  ctx.bezierCurveTo(-size * 0.9, size * 0.5, -size * 0.85, -size * 0.6, 0, -size);
  ctx.fill();
  ctx.restore();
}

// ============================================================================
// Exact Port of Studio WebUI's `TaOrb.vue` (The Living Soul Orb of LuckyTri)
// ============================================================================
export function drawTaOrb(ctx, cx, cy, rawRadius, t, opts = {}) {
  const radius = Math.max(4, rawRadius || 0);
  const moodKey = opts.mood || "calm";
  const pal = MOOD_PALETTES[moodKey] || MOOD_PALETTES.calm;
  const activity = opts.activity || "idle";
  const wobble = opts.wobble ?? (moodKey === "bright" ? 1.0 : moodKey === "night" ? 0.3 : 0.65);
  const speed = opts.speed ?? (moodKey === "bright" ? 1.4 : moodKey === "night" ? 0.4 : 0.85);
  const s = t * speed;
  const breath = Math.sin(s * 1.7) * 0.025;
  const hop =
    moodKey === "bright"
      ? Math.pow(Math.max(0, Math.sin(s * 2.6)), 1.5) * (radius * 0.11)
      : moodKey === "sweet"
        ? Math.pow(Math.max(0, Math.sin(s * 2.2)), 1.5) * (radius * 0.04)
        : 0;

  ctx.save();
  ctx.translate(cx, cy - hop);

  // Outer breathing aura
  const auraR = radius * (1.52 + Math.sin(s * 1.3) * 0.06);
  const auraGrad = ctx.createRadialGradient(0, 0, radius * 0.25, 0, 0, auraR);
  auraGrad.addColorStop(0, rgba(pal.orbB, 0.46));
  auraGrad.addColorStop(0.6, rgba(pal.orbC, 0.18));
  auraGrad.addColorStop(1, rgba(pal.orbC, 0.0));
  ctx.fillStyle = auraGrad;
  ctx.beginPath();
  ctx.arc(0, 0, auraR, 0, Math.PI * 2);
  ctx.fill();

  // Solitude dashed halo ring
  if (activity === "solitude" || opts.halo) {
    ctx.save();
    ctx.rotate(t * 0.25);
    ctx.strokeStyle = rgba(pal.orbB, 0.78);
    ctx.lineWidth = Math.max(2, radius * 0.032);
    ctx.setLineDash([radius * 0.06, radius * 0.14]);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Ground shadow
  ctx.fillStyle = rgba(pal.ink, 0.12);
  ctx.beginPath();
  ctx.ellipse(0, radius * 1.18 + hop * 0.7, radius * 0.72, radius * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();

  // 8-point Catmull-Rom organic blob path from TaOrb.vue
  const n = 8;
  const pts = [];
  const sx = 1 + breath;
  const sy = 1 - breath * 0.7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const noise = Math.sin(s * 1.3 + i * 1.7) * 0.6 + Math.sin(s * 0.7 + i * 2.9) * 0.4;
    const r = radius * (1 + noise * 0.055 * wobble);
    const squash = Math.sin(a) > 0 ? 0.93 : 1.02;
    pts.push([Math.cos(a) * r * sx, Math.sin(a) * r * sy * squash]);
  }

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    );
  }
  ctx.closePath();

  const bodyGrad = ctx.createRadialGradient(
    -radius * 0.24,
    -radius * 0.35,
    radius * 0.08,
    0,
    0,
    radius * 1.25,
  );
  bodyGrad.addColorStop(0, pal.orbA);
  bodyGrad.addColorStop(0.58, pal.orbB);
  bodyGrad.addColorStop(1, pal.orbC);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = Math.max(1.5, radius * 0.03);
  ctx.stroke();

  // Specular highlights
  ctx.save();
  ctx.translate(-radius * 0.36, -radius * 0.45);
  ctx.rotate(-0.48);
  ctx.fillStyle = "rgba(255, 255, 255, 0.52)";
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.26, radius * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
  ctx.beginPath();
  ctx.ellipse(-radius * 0.04, -radius * 0.62, radius * 0.065, radius * 0.048, 0, 0, Math.PI * 2);
  ctx.fill();

  // Facial expression
  const lookX = (opts.lookX || Math.sin(t * 0.8) * 0.15) * radius * 0.12;
  const lookY = (opts.lookY || Math.cos(t * 0.6) * 0.1) * radius * 0.1;
  ctx.save();
  ctx.translate(lookX, lookY);

  // Cheeks
  ctx.fillStyle = rgba(pal.cheek, moodKey === "sweet" || moodKey === "bright" ? 0.78 : 0.42);
  ctx.beginPath();
  ctx.ellipse(-radius * 0.46, radius * 0.1, radius * 0.14, radius * 0.08, 0, 0, Math.PI * 2);
  ctx.ellipse(radius * 0.46, radius * 0.1, radius * 0.14, radius * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes (with periodic natural blink)
  const blinkCycle = (t * 0.35) % 1;
  const isBlinking = blinkCycle > 0.94;
  const eyesClosed =
    activity === "asleep" || activity === "solitude" || moodKey === "night" || isBlinking;
  const eyesHappy = moodKey === "sweet" || moodKey === "bright";

  ctx.strokeStyle = pal.orbFace;
  ctx.fillStyle = pal.orbFace;
  ctx.lineWidth = Math.max(2.2, radius * 0.058);
  ctx.lineCap = "round";

  for (const ex of [-radius * 0.31, radius * 0.31]) {
    if (eyesClosed) {
      ctx.beginPath();
      ctx.moveTo(ex - radius * 0.11, -radius * 0.08);
      ctx.quadraticCurveTo(ex, radius * 0.01, ex + radius * 0.11, -radius * 0.08);
      ctx.stroke();
    } else if (eyesHappy) {
      ctx.beginPath();
      ctx.moveTo(ex - radius * 0.11, -radius * 0.04);
      ctx.quadraticCurveTo(ex, -radius * 0.2, ex + radius * 0.11, -radius * 0.04);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(ex, -radius * 0.08, radius * 0.085, radius * 0.115, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ex + radius * 0.028, -radius * 0.12, radius * 0.032, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.orbFace;
    }
  }

  // Mouth
  const my = radius * 0.2;
  if (activity === "asleep" || moodKey === "night") {
    ctx.beginPath();
    ctx.ellipse(0, my, radius * 0.042, radius * 0.048, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (activity === "speaking") {
    const openH = radius * (0.05 + 0.04 * Math.abs(Math.sin(t * 9.5)));
    ctx.beginPath();
    ctx.ellipse(0, my, radius * 0.075, openH, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (moodKey === "sweet") {
    ctx.beginPath();
    ctx.moveTo(-radius * 0.16, my - radius * 0.02);
    ctx.quadraticCurveTo(-radius * 0.08, my + radius * 0.08, 0, my - radius * 0.01);
    ctx.quadraticCurveTo(radius * 0.08, my + radius * 0.08, radius * 0.16, my - radius * 0.02);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-radius * 0.14, my - radius * 0.01);
    ctx.quadraticCurveTo(0, my + radius * 0.11, radius * 0.14, my - radius * 0.01);
    ctx.stroke();
  }
  ctx.restore();

  // Held props (book for reading, notebook & pen for diary, zZ for sleep)
  if (activity === "reading") {
    ctx.save();
    ctx.translate(0, radius * 0.65);
    ctx.fillStyle = "#fffdf6";
    ctx.strokeStyle = pal.orbFace;
    ctx.lineWidth = Math.max(1.8, radius * 0.03);
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.12);
    ctx.lineTo(-radius * 0.44, -radius * 0.24);
    ctx.lineTo(-radius * 0.44, radius * 0.16);
    ctx.lineTo(0, radius * 0.28);
    ctx.lineTo(radius * 0.44, radius * 0.16);
    ctx.lineTo(radius * 0.44, -radius * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.12);
    ctx.lineTo(0, radius * 0.28);
    ctx.stroke();
    ctx.restore();
  } else if (activity === "asleep" || moodKey === "night") {
    ctx.save();
    ctx.font = `700 ${Math.round(radius * 0.24)}px ${FONT_SANS}`;
    ctx.fillStyle = rgba(pal.ink, 0.72);
    const zOffset = (t * 0.6) % 1;
    ctx.fillText("z", radius * (0.75 + zOffset * 0.15), -radius * (0.55 + zOffset * 0.25));
    ctx.fillText("Z", radius * (0.98 + zOffset * 0.15), -radius * (0.85 + zOffset * 0.25));
    ctx.restore();
  }

  ctx.restore();
}

// ============================================================================
// High-Resolution Character Portrait Showcase with Living Hair/Light/Prism FX
// ============================================================================
export function drawCharacterCard(ctx, assets, x, y, w, h, t, opts = {}) {
  const {
    r = 28,
    glowColor = "#5ed4ae",
    secondaryGlow = "#ff8fb1",
    zoom = 1.0,
    panX = 0,
    panY = 0,
    speaking = false,
    badge = null,
  } = opts;

  ctx.save();
  // Outer prism glow
  ctx.shadowColor = rgba(glowColor, 0.42);
  ctx.shadowBlur = 42;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = "#162038";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();

  const img = opts.useBanner ? assets.banner : assets.portrait;
  if (img) {
    const breathScale = zoom * (1 + Math.sin(t * 1.8) * 0.016);
    const iw = img.width;
    const ih = img.height;
    const scale = Math.max(w / iw, h / ih) * breathScale;
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = x + (w - dw) * 0.5 + panX + Math.sin(t * 0.9) * 4;
    const dy = y + (h - dh) * 0.35 + panY + Math.cos(t * 1.1) * 3;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  // Animated sun-drenched prism light leak overlay
  const leakGrad = ctx.createRadialGradient(
    x + w * (0.78 + Math.sin(t * 0.7) * 0.08),
    y + h * 0.18,
    10,
    x + w * 0.75,
    y + h * 0.22,
    w * 0.85,
  );
  leakGrad.addColorStop(0, rgba("#fff6d6", 0.32 + Math.sin(t * 2.1) * 0.08));
  leakGrad.addColorStop(0.45, rgba(secondaryGlow, 0.14));
  leakGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = leakGrad;
  ctx.fillRect(x, y, w, h);

  // Floating sakura petals & star sparkles inside frame
  for (let i = 0; i < 6; i++) {
    const px = x + ((i * 137 + t * (28 + i * 5)) % (w + 40)) - 20;
    const py = y + ((i * 89 + t * (22 + i * 4)) % (h + 40)) - 20;
    drawSakuraPetal(ctx, px, py, 6 + (i % 3) * 2.5, t * 1.2 + i, "#ffb5cc", 0.55);
  }

  // Speaking audio wave indicator if LuckyTri is speaking
  if (speaking) {
    const barW = w * 0.56;
    const barH = 38;
    const bx = x + (w - barW) / 2;
    const by = y + h - barH - 18;
    roundRect(ctx, bx, by, barW, barH, 19);
    ctx.fillStyle = "rgba(20, 30, 56, 0.74)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 143, 177, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const nBars = 18;
    const startX = bx + 24;
    const stepX = (barW - 48) / (nBars - 1);
    for (let i = 0; i < nBars; i++) {
      const amp = 4 + 11 * Math.abs(Math.sin(t * 12 + i * 0.65));
      ctx.strokeStyle = i % 2 === 0 ? "#5ed4ae" : "#ff8fb1";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(startX + i * stepX, by + barH / 2 - amp);
      ctx.lineTo(startX + i * stepX, by + barH / 2 + amp);
      ctx.stroke();
    }
  }

  if (badge) {
    ctx.font = `700 15px ${FONT_SANS}`;
    const tw = ctx.measureText(badge).width + 28;
    roundRect(ctx, x + 18, y + 18, tw, 32, 16);
    ctx.fillStyle = "rgba(20, 32, 58, 0.76)";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(badge, x + 32, y + 34);
  }

  // Crisp inner border
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

// ============================================================================
// Ambient Sky & Liquid Garden Background Renderer
// ============================================================================
export function drawMoodSky(ctx, assets, moodKey, t, opts = {}) {
  const pal = MOOD_PALETTES[moodKey] || MOOD_PALETTES.calm;
  const darkFactor = opts.darkFactor || 0;

  // Sky base gradient
  const grad = ctx.createLinearGradient(0, 0, W * 0.35, H);
  grad.addColorStop(0, darkFactor > 0 ? lerpColor(pal.skyTop, "#0b1224", darkFactor) : pal.skyTop);
  grad.addColorStop(0.5, darkFactor > 0 ? lerpColor(pal.skyMid, "#121d38", darkFactor) : pal.skyMid);
  grad.addColorStop(1, darkFactor > 0 ? lerpColor(pal.skyBot, "#1a2442", darkFactor) : pal.skyBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Subtle liquid-garden artwork texture blend
  if (assets.garden && (opts.gardenAlpha ?? 0.22) > 0) {
    ctx.save();
    ctx.globalAlpha = opts.gardenAlpha ?? 0.22;
    const scale = Math.max(W / assets.garden.width, H / assets.garden.height) * 1.04;
    const gw = assets.garden.width * scale;
    const gh = assets.garden.height * scale;
    ctx.drawImage(
      assets.garden,
      (W - gw) * 0.5 + Math.sin(t * 0.25) * 14,
      (H - gh) * 0.5 + Math.cos(t * 0.2) * 10,
      gw,
      gh,
    );
    ctx.restore();
  }

  // Drifting radial glow orbs (from MoodSky.vue)
  const g1x = W * 0.18 + Math.sin(t * 0.3) * 60;
  const g1y = H * 0.22 + Math.cos(t * 0.25) * 40;
  const g1 = ctx.createRadialGradient(g1x, g1y, 10, g1x, g1y, W * 0.42);
  g1.addColorStop(0, rgba(pal.glowA, 0.48 * (1 - darkFactor * 0.5)));
  g1.addColorStop(1, rgba(pal.glowA, 0));
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);

  const g2x = W * 0.82 + Math.cos(t * 0.28) * 55;
  const g2y = H * 0.3 + Math.sin(t * 0.22) * 45;
  const g2 = ctx.createRadialGradient(g2x, g2y, 10, g2x, g2y, W * 0.38);
  g2.addColorStop(0, rgba(pal.glowB, 0.45 * (1 - darkFactor * 0.5)));
  g2.addColorStop(1, rgba(pal.glowB, 0));
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  // Floating particles
  const nParticles = opts.particles ?? 28;
  for (let i = 0; i < nParticles; i++) {
    const px = ((i * 197 + t * (16 + (i % 5) * 4)) % (W + 80)) - 40;
    const py = H - (((i * 131 + t * (14 + (i % 4) * 3)) % (H + 80)) - 40);
    const r = 2 + (i % 4) * 1.4;
    const alpha = 0.25 + 0.35 * Math.sin(t * 2 + i);
    if (i % 5 === 0) {
      drawFourStar(ctx, px, py, r * 2.4, pal.accent, alpha * 0.7, t * 0.5 + i);
    } else {
      ctx.fillStyle = darkFactor > 0.4 ? rgba("#ffffff", alpha) : rgba(pal.accent, alpha * 0.55);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ============================================================================
// Top Section Eyebrow & Act Header Badge
// ============================================================================
export function drawActHeader(ctx, actCode, titleZh, titleEn, t, dark = false) {
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const x = 76;
  const y = 44;

  // Pill tag
  ctx.font = `700 14px ${FONT_MONO}`;
  const tagW = ctx.measureText(actCode).width + 26;
  roundRect(ctx, x, y, tagW, 28, 14);
  ctx.fillStyle = dark ? "rgba(94, 212, 174, 0.18)" : "rgba(70, 109, 184, 0.14)";
  ctx.fill();
  ctx.strokeStyle = dark ? "rgba(94, 212, 174, 0.55)" : "rgba(70, 109, 184, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = dark ? "#5ed4ae" : "#3a5ca8";
  ctx.textBaseline = "middle";
  ctx.fillText(actCode, x + 13, y + 14.5);

  ctx.font = `700 19px ${FONT_SANS}`;
  ctx.fillStyle = dark ? "rgba(255, 255, 255, 0.90)" : "rgba(38, 62, 105, 0.88)";
  ctx.fillText(titleZh, x + tagW + 14, y + 14.5);

  const zhW = ctx.measureText(titleZh).width;
  ctx.font = `500 14px ${FONT_MONO}`;
  ctx.fillStyle = dark ? "rgba(255, 255, 255, 0.50)" : "rgba(38, 62, 105, 0.52)";
  ctx.fillText(`· ${titleEn}`, x + tagW + 24 + zhW, y + 15);
  ctx.restore();
}

// ============================================================================
// Cinematic Subtitle Bar (Bottom of 1080p frame)
// ============================================================================
export function drawSubtitleOverlay(ctx, timeline, t) {
  if (!timeline || !timeline.length) return;
  const active = timeline.find((item) => t >= item.start - 0.08 && t <= item.end + 0.18);
  if (!active) return;

  const fadeIn = smoothstep(active.start - 0.08, active.start + 0.16, t);
  const fadeOut = 1 - smoothstep(active.end - 0.12, active.end + 0.18, t);
  const alpha = clamp(fadeIn * fadeOut, 0, 1);
  if (alpha <= 0.01) return;

  const isHer = active.speaker === "luckytri";
  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.font = `700 30px ${FONT_SANS}`;
  const zhText = active.text;
  const zhW = ctx.measureText(zhText).width;

  ctx.font = `500 17px ${FONT_SANS}`;
  const enText = active.en;
  const enW = ctx.measureText(enText).width;

  const badgeW = isHer ? 118 : 0;
  const boxW = Math.min(1680, Math.max(zhW + badgeW, enW) + 76);
  const boxH = 88;
  const bx = (W - boxW) / 2;
  const by = H - 114 + (1 - alpha) * 10;

  // Translucent dark cinema pill
  roundRect(ctx, bx, by, boxW, boxH, 22);
  ctx.fillStyle = isHer ? "rgba(36, 18, 44, 0.80)" : "rgba(14, 22, 38, 0.78)";
  ctx.fill();
  ctx.strokeStyle = isHer ? "rgba(255, 143, 177, 0.65)" : "rgba(166, 216, 255, 0.42)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Speaker badge if LuckyTri
  let textCenterX = W / 2;
  if (isHer) {
    const tagX = bx + 22;
    const tagY = by + 16;
    roundRect(ctx, tagX, tagY, 98, 28, 14);
    const g = ctx.createLinearGradient(tagX, tagY, tagX + 98, tagY);
    g.addColorStop(0, "#ff8fb1");
    g.addColorStop(1, "#5ed4ae");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.font = `700 14px ${FONT_SANS}`;
    ctx.fillStyle = "#141e30";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("★ LuckyTri", tagX + 49, tagY + 14.5);
    textCenterX = bx + 120 + (boxW - 140) / 2;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 29px ${FONT_SANS}`;
  ctx.fillStyle = isHer ? "#ffeaf2" : "#ffffff";
  ctx.fillText(zhText, textCenterX, by + 31);

  ctx.font = `500 16px ${FONT_SANS}`;
  ctx.fillStyle = isHer ? "rgba(255, 210, 230, 0.85)" : "rgba(205, 224, 252, 0.82)";
  ctx.fillText(enText, W / 2, by + 65);

  ctx.restore();
}
