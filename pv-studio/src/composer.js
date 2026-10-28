// ============================================================================
// LuckyTri Official PV — Master Timeline Composer & Scene Router
// ============================================================================
import {
  W,
  H,
  FPS,
  TOTAL_DURATION,
  TOTAL_FRAMES,
  clamp,
  smoothstep,
  rgba,
  FONT_MONO,
  drawSubtitleOverlay,
} from "./engine.js";
import { renderAct1, renderAct2 } from "./scenes_act1_2.js";
import { renderAct3, renderAct4 } from "./scenes_act3_4.js";
import { renderAct5, renderBrandPosterLayout } from "./scenes_act5_poster.js";

export { W, H, FPS, TOTAL_DURATION, TOTAL_FRAMES, renderBrandPosterLayout };

/**
 * Renders a single 1920x1080 frame at exact timestamp `t` (in seconds).
 */
export function renderMasterFrame(ctx, assets, timeline, t, opts = {}) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);

  // Route to the active Act renderer with smooth cross-act transitions
  if (t < 20.0) {
    renderAct1(ctx, assets, t);
  } else if (t < 46.0) {
    renderAct2(ctx, assets, t);
  } else if (t < 74.6) {
    renderAct3(ctx, assets, t);
  } else if (t < 102.5) {
    renderAct4(ctx, assets, t);
  } else {
    renderAct5(ctx, assets, t);
  }

  // Subtle light-flash transitions at major Act boundaries
  const actBoundaries = [20.0, 46.0, 74.6, 102.5];
  for (const b of actBoundaries) {
    const dist = Math.abs(t - b);
    if (dist < 0.35) {
      const flash = Math.pow(1 - dist / 0.35, 2) * 0.42;
      ctx.fillStyle = rgba("#ffffff", flash);
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Subtle top-right timecode / lived-day watermark
  if (t < 118.2) {
    ctx.save();
    ctx.textAlign = "right";
    ctx.font = `600 13px ${FONT_MONO}`;
    const isDark = (t < 10.5) || (t >= 46.0 && t < 51.0) || (t >= 74.6 && t < 94.4);
    ctx.fillStyle = isDark ? "rgba(210, 228, 255, 0.48)" : "rgba(38, 62, 105, 0.45)";
    ctx.fillText("LuckyTri · github.com/TodayYueC/LuckyTri", W - 76, 58);
    ctx.restore();
  }

  // Subtitles overlay (unless explicitly disabled)
  if (opts.subtitles !== false) {
    drawSubtitleOverlay(ctx, timeline, t);
  }

  // Opening fade-in from black (0.0 -> 0.8s)
  if (t < 0.8) {
    const fade = 1 - smoothstep(0.0, 0.8, t);
    ctx.fillStyle = rgba("#070c18", fade);
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();
}
