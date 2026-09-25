import type { ParticleKind } from "../../mood/themes";

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  phase: number;
  spin: number;
  alt: boolean;
}

interface Colors {
  particle: string;
  accent: string;
  cheek: string;
}

const BASE: Record<ParticleKind, number> = {
  mote: 16,
  sparkle: 12,
  bubble: 10,
  rain: 28,
  fluff: 8,
  dust: 18,
  star: 24,
};
const MAX = 36;

export class ParticleField {
  private ctx: CanvasRenderingContext2D;
  private parts: Mote[] = [];
  private kind: ParticleKind = "mote";
  private intensity = 0.5;
  private colors: Colors = {
    particle: "#ffffff",
    accent: "#2c8465",
    cheek: "#ff9db1",
  };
  private w = 0;
  private h = 0;
  private raf = 0;
  private last = 0;
  private running = false;
  private shooting: { x: number; y: number; life: number } | null = null;
  private nextShot = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!ctx) throw Error("canvas unavailable");
    this.ctx = ctx;
  }

  configure(kind: ParticleKind, intensity: number) {
    const reseed =
      kind !== this.kind ||
      Math.abs(intensity - this.intensity) > 0.15 ||
      !this.parts.length;
    this.kind = kind;
    this.intensity = intensity;
    this.readColors();
    if (reseed) this.seed();
  }

  readColors() {
    const style = getComputedStyle(document.documentElement);
    const pick = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    this.colors = {
      particle: pick("--particle", "#ffffff"),
      accent: pick("--accent", "#2c8465"),
      cheek: pick("--cheek", "#ff9db1"),
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = 1;
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.seed();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const elapsed = now - this.last;
      if (elapsed < 50) return;
      this.last = now;
      this.step(Math.min(0.05, elapsed / 1000), now / 1000);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  private count() {
    const area = Math.min(
      1.25,
      Math.max(0.4, (this.w * this.h) / (1440 * 900)),
    );
    return Math.min(
      MAX,
      Math.round(BASE[this.kind] * area * (0.55 + this.intensity * 0.9)),
    );
  }

  private seed() {
    this.parts = Array.from({ length: this.count() }, () => this.spawn(true));
  }

  private spawn(anywhere: boolean): Mote {
    const r = Math.random;
    const m: Mote = {
      x: r() * this.w,
      y: r() * this.h,
      vx: 0,
      vy: 0,
      r: 2,
      a: 1,
      phase: r() * Math.PI * 2,
      spin: (r() - 0.5) * 0.6,
      alt: false,
    };
    switch (this.kind) {
      case "mote":
        Object.assign(m, {
          r: 2 + r() * 4,
          vx: (r() - 0.5) * 8,
          vy: -4 - r() * 8,
          a: 0.25 + r() * 0.45,
        });
        if (!anywhere) m.y = this.h + 10;
        break;
      case "sparkle":
        Object.assign(m, {
          r: 2.5 + r() * 4.5,
          vx: (r() - 0.5) * 14,
          vy: -6 - r() * 14,
          a: 0.5 + r() * 0.5,
          alt: r() < 0.35,
        });
        if (!anywhere) m.y = this.h + 10;
        break;
      case "bubble":
        Object.assign(m, {
          r: 3 + r() * 8,
          vx: (r() - 0.5) * 10,
          vy: -10 - r() * 18,
          a: 0.35 + r() * 0.4,
          alt: r() < 0.3,
        });
        if (!anywhere) m.y = this.h + 14;
        break;
      case "rain":
        Object.assign(m, {
          x: r() * (this.w + 120),
          r: 10 + r() * 14,
          vx: -40,
          vy: 380 + r() * 180,
          a: 0.12 + r() * 0.2,
        });
        if (!anywhere) m.y = -24;
        break;
      case "fluff":
        Object.assign(m, {
          r: 14 + r() * 26,
          vx: (r() - 0.5) * 30,
          vy: (r() - 0.5) * 18,
          a: 0.06 + r() * 0.08,
        });
        break;
      case "dust":
        Object.assign(m, {
          r: 0.8 + r() * 1.8,
          vx: (r() - 0.5) * 6,
          vy: (r() - 0.5) * 6,
          a: 0.3 + r() * 0.5,
        });
        break;
      case "star":
        Object.assign(m, {
          r: 0.6 + r() * 1.6,
          a: 0.4 + r() * 0.6,
          y: r() * this.h * 0.8,
        });
        break;
    }
    return m;
  }

  private step(dt: number, t: number) {
    const { ctx, w, h, colors } = this;
    ctx.clearRect(0, 0, w, h);
    const pace = 0.6 + this.intensity * 0.8;
    for (let i = 0; i < this.parts.length; i++) {
      const m = this.parts[i];
      m.phase += dt;
      m.x += m.vx * dt * pace;
      m.y += m.vy * dt * pace;
      switch (this.kind) {
        case "mote":
        case "sparkle":
        case "bubble":
          m.x += Math.sin(t * 0.6 + m.phase) * 0.25;
          if (m.y < -24) this.parts[i] = this.spawn(false);
          break;
        case "rain":
          if (m.y > h + 24) this.parts[i] = this.spawn(false);
          break;
        default:
          if (this.kind === "fluff") {
            m.vx += Math.sin(t * 0.7 + m.phase * 3) * 12 * dt;
            m.vy += Math.cos(t * 0.5 + m.phase * 2) * 8 * dt;
            m.vx = Math.max(-24, Math.min(24, m.vx));
            m.vy = Math.max(-16, Math.min(16, m.vy));
          }
          if (m.x < -40) m.x = w + 40;
          if (m.x > w + 40) m.x = -40;
          if (m.y < -40) m.y = h + 40;
          if (m.y > h + 40) m.y = -40;
      }
      this.draw(this.parts[i], t, colors);
    }
    if (this.kind === "star") this.shoot(dt, t);
    ctx.globalAlpha = 1;
  }

  private draw(m: Mote, t: number, colors: Colors) {
    const ctx = this.ctx;
    switch (this.kind) {
      case "mote": {
        const alpha = m.a * (0.7 + 0.3 * Math.sin(m.phase * 1.3));
        ctx.fillStyle = colors.particle;
        ctx.globalAlpha = alpha * 0.25;
        this.circle(m.x, m.y, m.r * 2.4);
        ctx.globalAlpha = alpha;
        this.circle(m.x, m.y, m.r);
        break;
      }
      case "sparkle": {
        ctx.fillStyle = m.alt ? colors.accent : colors.particle;
        ctx.globalAlpha =
          m.a * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(m.phase * 2.2)));
        this.star(m.x, m.y, m.r, t * m.spin);
        break;
      }
      case "bubble": {
        ctx.globalAlpha = m.a;
        if (m.alt) {
          ctx.fillStyle = colors.cheek;
          this.heart(m.x, m.y, m.r * 0.8);
        } else {
          ctx.strokeStyle = colors.particle;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = m.a * 0.8;
          ctx.beginPath();
          ctx.arc(
            m.x - m.r * 0.35,
            m.y - m.r * 0.35,
            m.r * 0.25,
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = colors.particle;
          ctx.fill();
        }
        break;
      }
      case "rain": {
        ctx.strokeStyle = colors.particle;
        ctx.globalAlpha = m.a;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - m.r * 0.1, m.y + m.r);
        ctx.stroke();
        break;
      }
      case "fluff": {
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
        g.addColorStop(0, colors.particle);
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.globalAlpha = m.a;
        this.circle(m.x, m.y, m.r);
        break;
      }
      case "dust": {
        ctx.fillStyle = colors.particle;
        ctx.globalAlpha = m.a * (0.75 + 0.25 * Math.sin(m.phase * 0.9));
        this.circle(m.x, m.y, m.r);
        break;
      }
      case "star": {
        ctx.fillStyle = colors.particle;
        ctx.globalAlpha =
          m.a * (0.55 + 0.45 * Math.sin(t * (0.6 + m.spin) + m.phase));
        this.circle(m.x, m.y, m.r);
        if (m.r > 1.8) {
          ctx.globalAlpha *= 0.35;
          this.star(m.x, m.y, m.r * 3.2, 0);
        }
        break;
      }
    }
  }

  // A slow streak now and then; never a flash.
  private shoot(dt: number, t: number) {
    if (!this.shooting && t > this.nextShot) {
      this.nextShot = t + 9 + Math.random() * 10;
      this.shooting = {
        x: this.w * (0.3 + Math.random() * 0.6),
        y: this.h * Math.random() * 0.3,
        life: 0,
      };
    }
    const s = this.shooting;
    if (!s) return;
    s.life += dt;
    const p = s.life / 1.4;
    if (p >= 1) {
      this.shooting = null;
      return;
    }
    const x = s.x - p * 220;
    const y = s.y + p * 110;
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(x, y, x + 60, y - 30);
    g.addColorStop(0, this.colors.particle);
    g.addColorStop(1, "transparent");
    ctx.strokeStyle = g;
    ctx.globalAlpha = Math.sin(p * Math.PI) * 0.7;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 60, y - 30);
    ctx.stroke();
  }

  private circle(x: number, y: number, r: number) {
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private star(x: number, y: number, r: number, angle: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.quadraticCurveTo(0, 0, 0, r);
    ctx.quadraticCurveTo(0, 0, -r, 0);
    ctx.quadraticCurveTo(0, 0, 0, -r);
    ctx.fill();
    ctx.restore();
  }

  private heart(x: number, y: number, s: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(
      x - s * 1.6,
      y - s * 0.2,
      x - s * 0.6,
      y - s * 1.3,
      x,
      y - s * 0.45,
    );
    ctx.bezierCurveTo(
      x + s * 0.6,
      y - s * 1.3,
      x + s * 1.6,
      y - s * 0.2,
      x,
      y + s * 0.9,
    );
    ctx.fill();
  }
}
