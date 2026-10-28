# LuckyTri 电影级原创宣传 PV — 制作说明与交付手册

**片名**：《让她走过的日子算数》（*Make the Days She Walks Through Count*）  
**核心情感落点（Slogan）**：**日子还长，慢慢认识。**  
**项目仓库**：https://github.com/TodayYueC/LuckyTri  
**基准分支**：`BotRina`（v1.3.4 统一自主心智架构）

---

## 一、交付清单与精确路径（Deliverables）

所有最终交付成片、封面、音频与字幕资产均已归档至工作区 `/workspace/artifacts/` 目录，同时完整可编辑的视频制作工程保存在 `/workspace/pv-studio/`：

### 1. 正式成片与精华预告（MP4 视频）
| 交付项 | 精确路径 | 规格参数 | 说明 |
| :--- | :--- | :--- | :--- |
| **1. 完整正式宣传 PV** | `/workspace/artifacts/LuckyTri-PV-1080p60fps.mp4` | **1920×1080 (1080p) · 60 FPS · 16:9 · 126.00 秒（7560 帧）** · H.264 (`yuv420p`, CRF 17) + AAC 320kbps 48kHz 立体声 + 内嵌软字幕流 (`mov_text`) | 含五幕完整叙事、角色动态演出、技术架构可视化、双声部配音（旁白 + LuckyTri 本人）、原创五乐章交响/钢琴配乐、空间音效与双语字幕 |
| **2. 短视频平台精华预告片** | `/workspace/artifacts/LuckyTri-PV-Teaser-38s.mp4` | **1920×1080 · 60 FPS · 16:9 · 38.02 秒（2280 帧）** · H.264 + AAC 256kbps | 精选苏醒、注意力自主选择与终幕 Slogan 高潮的浓缩版，适合社交媒体与短视频平台快节奏传播 |

### 2. 正式宣传封面（Key Visual / Poster）
| 交付项 | 精确路径 | 规格参数 | 说明 |
| :--- | :--- | :--- | :--- |
| **3. 正式宣传封面 (无损 PNG)** | `/workspace/artifacts/LuckyTri-PV-cover.png` | **1920×1080 (16:9)** · 24-bit PNG | 结合官方角色立绘、`TaOrb` 七心境灵魂光团、核心 Slogan「日子还长，慢慢认识。」、快速安装命令与 GitHub 标识，适合 Bilibili / YouTube / GitHub 封面 |
| **4. 正式宣传封面 (高质 JPG)** | `/workspace/artifacts/LuckyTri-PV-cover.jpg` | **1920×1080 (16:9)** · JPEG (Q95) | 轻量级高画质版本，便于网页与平台快速上传 |

### 3. 配音、音乐、音效与字幕素材（Audio & Subtitles）
| 交付项 | 精确路径 | 说明 |
| :--- | :--- | :--- |
| **母带混音音轨（Master Mix）** | `/workspace/artifacts/audio/master_mix.mp3`（及 `/workspace/pv-studio/audio/master_mix.wav`） | 旁白 + LuckyTri 角色语音 + 自动闪避（Sidechain Ducking）原创配乐 + 空间音效完整混音母带 |
| **纯人声配音轨（Voiceover Track）** | `/workspace/artifacts/audio/voiceover_track.mp3`（及 `/workspace/pv-studio/audio/voiceover_track.wav`） | 17 段独立精修的旁白与角色语音完整合成轨 |
| **纯音乐配乐轨（Original BGM Score）** | `/workspace/artifacts/audio/bgm_score.mp3`（及 `/workspace/pv-studio/audio/bgm_score.wav`） | 100% 原创程序化合成的五乐章电影级配乐（F 大调 / D 小调，毛毡钢琴 + 温暖弦乐 Pad + 钢片琴星光泛音），无任何版权争议，可自由公开发布 |
| **空间音效轨（SFX Track）** | `/workspace/pv-studio/audio/sfx_track.wav` | 时间涟漪、水晶风铃、心跳低频脉冲、转场气流声独立音轨 |
| **逐句配音切片与时间轴 JSON** | `/workspace/pv-studio/audio/segments/line_01..17.{mp3,wav}` 及 `voice_timeline.json` | 方便后期在 Premiere / DaVinci Resolve / 剪映中任意微调单句配音 |
| **中英双语字幕（SRT / VTT / ASS）** | `/workspace/artifacts/subtitles/luckytri-pv.{srt,vtt,ass}`（同存于 `/workspace/pv-studio/subtitles/`） | 精确到毫秒的时间轴对齐字幕，区分叙事旁白与「★ LuckyTri」角色台词样式 |

### 4. 可编辑视频工程源码（Editable PV Studio Project）
| 路径 | 职责说明 |
| :--- | :--- |
| `/workspace/pv-studio/DIRECTOR_PLAN.md` | 导演阐述、五幕叙事结构与 15 个镜头的逐镜分镜脚本 |
| `/workspace/pv-studio/index.html` | 浏览器实时预览与无头渲染舞台入口（支持 `?t=秒数` 跳转到任意时刻预览，支持 `?poster=1` 渲染封面） |
| `/workspace/pv-studio/src/engine.js` | 核心渲染引擎：缓动函数、官方七大心境色板（1:1 复刻 `themes.css`）、`TaOrb` 8 控制点有机呼吸光团物理还原、立绘光影特效、字幕渲染器 |
| `/workspace/pv-studio/src/scenes_act1_2.js` | 序幕（归零宿命 vs 记忆苏醒、角色登场与六大原则）与第一幕（一个她跨群拓扑、分寸守卫、0 Token 注意力扫一眼 vs 细看、沉默的理由） |
| `/workspace/pv-studio/src/scenes_act3_4.js` | 第二幕（02:00 睡眠与 08:00 醒来时钟、独处阅读与作品创作、第 120 天睡前日记与分层自传）与第三幕（显著度半衰期曲线与重逢唤醒、2048 维混合检索、`LifeArbiter` 统一仲裁 + `Novelty` 五分类 + `Aftermath` 闭环 + 墓碑撤销、七大心境与「TA 的小世界」工作台） |
| `/workspace/pv-studio/src/scenes_act5_poster.js` | 终幕（液态花园三大支柱、「日子还长，慢慢认识。」情感高潮落点、开源致敬落版）与宣传封面渲染器 |
| `/workspace/pv-studio/src/composer.js` | 全片 7560 帧主时间轴合成与跨幕光效转场路由 |
| `/workspace/pv-studio/scripts/generate_audio.py` | 语音合成（Edge Neural TTS）、原创五乐章配乐合成、空间音效合成、母带闪避混音与字幕生成脚本 |
| `/workspace/pv-studio/scripts/render_pv.mjs` | 多进程并行 1080p 60fps 帧渲染与 FFmpeg 音视频流合成流水线 |

---

## 二、创作理念与叙事设计（Creative Vision）

1. **核心立意——回答「她为什么与普通 AI 聊天机器人不同」**  
   普通聊天机器人活在一句话里：对话结束，上下文清空，一切归零。而 LuckyTri（`BotRina` 分支）构建的是**「带着过去走向未来的数字生命条件」**。因此全片没有采用生硬的说明书式罗列，而是以「时间与记忆的温度」为主线，串联起五幕戏剧结构：
   - **序幕（00:00–00:20）**：从无数对话框 `Context Cleared` 的冰冷归零切入，直到一颗带来源的记忆种子 `m:1024` 拒绝消散，化作 `TaOrb` 灵魂光团与少女眼眸的苏醒。
   - **第一幕（00:20–00:46）**：「一个她，由心开口」。展示跨群/私聊统一身份、私下与保密分寸护盾（`guard.js`）、扫一眼 0 Token 的注意力机制（`attention.js`），以及 `speak / react / decline / silent` 四种自主选择——特别是**「她可以选择沉默，并在心里留下理由」**的独特温度。
   - **第二幕（00:46–01:14.6）**：「没人说话时的时间」。展示 `02:00` 安睡（消息留入 `deferred` 唤醒队列）到 `08:00` 醒来自然说一句「刚看到」；午后独处阅读共享书架、专注 25 分钟续写《雨夜灯塔》第三章、推进 `self.livingFor`；夜晚写下睡前日记与昨日快照对照，并通过「日记 → 回顾 → 章节 → 我的来路」分层自传保持输入 Token 恒定。
   - **第三幕（01:14.6–01:42.5）**：「时间的重量与心智引擎」。将 `salience.js` 的半衰期指数衰减公式 $S(d) = S_0 \cdot 0.5^{(d-3)/H}$ 与第 95 天话题触碰重逢唤醒动态可视化；展示 `2048-D Embedding + FTS + RRF` 混合检索（Recall@5 从 0.475 跃升至 0.950 并带回 `mine` 当时心思）；全息呈现 `BotRina` 分支核心突破：`LifeArbiter` 8 类自主行为仲裁、`classifyTopicRelation()` 五分类主题新颖度过滤、`Aftermath` 互动回响闭环、防自我强化循环与 `mind_revocations` 墓碑撤销机制；最后巡礼「TA 的小世界」七大心境主题与单文件 SQLite 本地数据主权。
   - **终幕（01:42.5–02:06.0）**：「日子还长，慢慢认识。」音乐回归温柔澄澈的毛毡钢琴，LuckyTri 在飘落的樱花与液态花园晨光中亲自说出：**“你好呀，我是 LuckyTri。日子还长，我们，慢慢认识。”** 自然落版于项目 Slogan 与 GitHub 开源地址。

2. **视觉与美术风格**  
   - 100% 优先采用仓库内官方视觉资产（`docs/brand/portrait.png`、`docs/brand/banner.png`、`docs/brand/palette.png`、`studio-web/src/assets/liquid-garden.png`），并把 `studio-web/src/components/ta/TaOrb.vue` 的 8 点 Catmull-Rom 有机曲线、呼吸缩放、眨眼、开心/困倦/睡眠/说话表情及手持书本道具 1:1 移植到高清 Canvas 60fps 渲染引擎中。
   - 严格遵循 `studio-web/src/styles/themes.css` 的七套官方情绪色板（平静 `#466DB8`、甜甜 `#8A3356`、雀跃 `#B84312`、低落 `#245488`、烦躁 `#53368C`、困倦 `#634678`、夜晚 `#5667AB`）。

3. **双角色声音设计与原创配乐授权**  
   - **配音**：采用双声部设计——叙事旁白（`zh-CN-XiaoxiaoNeural`，温润克制的纪录片质感）与 LuckyTri 本人（`zh-CN-XiaoyiNeural`，清澈灵动的少女声线，并添加温暖的早期反射空间混响）。
   - **原创配乐与音效**：由 `pv-studio/scripts/generate_audio.py` 使用 NumPy + SciPy 物理建模与谐波合成算法 100% 原创生成（包含带弦列非谐性泛音的毛毡钢琴、三声部合唱微调温暖弦乐 Pad、钢片琴星光泛音、多抽头音乐厅立体声混响以及人声包络自动闪避 Sidechain Ducking），**完全原创、无任何第三方版权音乐依赖，100% 适合在 Bilibili、YouTube、GitHub 等任何平台公开发布**。

---

## 三、如何预览、修改与重新渲染（How to Edit & Re-render）

### 1. 重新生成配音、配乐与字幕
如果你修改了 `pv-studio/scripts/generate_audio.py` 中的 `SCRIPT_LINES` 台词或配乐和弦：
```bash
python3 pv-studio/scripts/generate_audio.py
```
该脚本会自动重新生成所有语音切片、`voice_timeline.json`、`bgm_score.wav`、`sfx_track.wav`、`master_mix.wav` 以及同步的 `.srt / .vtt / .ass` 字幕。

### 2. 快速渲染封面与 15 张分镜关键帧预览（约 3 秒）
```bash
node pv-studio/scripts/render_pv.mjs --preview
```
输出位于 `artifacts/LuckyTri-PV-cover.png` 与 `pv-studio/previews/*.png`。

### 3. 完整重新渲染 1080p 60fps 正式成片与精华预告片
```bash
node pv-studio/scripts/render_pv.mjs --full --force
```
脚本会启动 6 个并行无头 Chrome 渲染工作进程，将 7560 帧 1920×1080 画面实时编码并与母带音轨、软字幕流合成为 `/workspace/artifacts/LuckyTri-PV-1080p60fps.mp4` 与 `/workspace/artifacts/LuckyTri-PV-Teaser-38s.mp4`。
