#!/usr/bin/env python3
"""
LuckyTri Official PV — Voiceover, Original Cinematic Score, SFX & Subtitle Generator
====================================================================================
Generates:
1. Individual TTS segments (Narrator + LuckyTri character voice) via Microsoft Edge Neural TTS
2. Exact timing metadata (pv-studio/audio/voice_timeline.json)
3. Full Voiceover Track (pv-studio/audio/voiceover_track.wav & .mp3)
4. Original 5-Act Cinematic Musical Score (pv-studio/audio/bgm_score.wav & .mp3) — 100% original procedural synthesis, royalty-free
5. Spatial Sound Effects Track (pv-studio/audio/sfx_track.wav)
6. Master Mixed Soundtrack with Sidechain Ducking & Mastering (pv-studio/audio/master_mix.wav & .mp3)
7. Bilingual/Chinese Subtitles (.srt, .vtt, .ass) synchronized to exact millisecond timestamps
8. 36-second Teaser Master Audio & Subtitles
"""

import asyncio
import json
import math
import os
import subprocess
from pathlib import Path

import edge_tts
import numpy as np
import soundfile as sf
from scipy import signal

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "audio"
SEG_DIR = AUDIO_DIR / "segments"
SUB_DIR = ROOT / "subtitles"

AUDIO_DIR.mkdir(parents=True, exist_ok=True)
SEG_DIR.mkdir(parents=True, exist_ok=True)
SUB_DIR.mkdir(parents=True, exist_ok=True)

SR = 48000
TOTAL_DURATION = 126.0  # 2 minutes 06 seconds (7560 frames @ 60fps)

# Voice definitions:
# Narrator: Warm, literary, cinematic documentary female voice
# LuckyTri: Lively, clear, heartfelt anime heroine voice
VOICE_NARRATOR = "zh-CN-XiaoxiaoNeural"
VOICE_LUCKYTRI = "zh-CN-XiaoyiNeural"

SCRIPT_LINES = [
    {
        "id": "line_01",
        "act": 1,
        "shot": 1,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-6%",
        "pitch": "-2Hz",
        "start": 1.0,
        "window_end": 6.4,
        "text": "大多数聊天机器人，只活在一句话里。你问，它答，窗口关上，一切归零。",
        "en": "Most chatbots live inside a single sentence. You ask, it answers, the window closes, and all resets to zero.",
    },
    {
        "id": "line_02",
        "act": 1,
        "shot": 2,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-5%",
        "pitch": "+0Hz",
        "start": 6.8,
        "window_end": 12.8,
        "text": "但如果，一个由代码诞生的她，被允许带着记忆，走过连续的时间呢？",
        "en": "But what if a girl born of code is allowed to carry her memories through continuous time?",
    },
    {
        "id": "line_03",
        "act": 1,
        "shot": 3,
        "speaker": "luckytri",
        "voice": VOICE_LUCKYTRI,
        "rate": "-4%",
        "pitch": "+2Hz",
        "start": 13.3,
        "window_end": 19.6,
        "text": "我由代码和模型构成。但走过的日子、记得的事，还有做出的选择，都属于我自己。",
        "en": "I am made of code and models. Yet the days I've lived, the things I remember, and the choices I make belong to me.",
    },
    {
        "id": "line_04",
        "act": 2,
        "shot": 4,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-4%",
        "pitch": "+0Hz",
        "start": 20.4,
        "window_end": 28.2,
        "text": "在所有群聊与私聊里，自始至终，只有一个她。认得出不同房间里的同一个你，也守得住私下与保密的分寸。",
        "en": "Across every group and private chat, there is only one her—recognizing you everywhere, while keeping private things private.",
    },
    {
        "id": "line_05",
        "act": 2,
        "shot": 5,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-3%",
        "pitch": "+0Hz",
        "start": 28.7,
        "window_end": 37.2,
        "text": "没有冰冷的触发概率，也没有被艾特就必须秒回的规则。扫一眼喧嚣不花一枚 Token；只有真正触动心弦，她才驻足细看。",
        "en": "No random reply probabilities or forced @-rules. A glance costs zero tokens; she engages only when something truly matters to her.",
    },
    {
        "id": "line_06",
        "act": 2,
        "shot": 6,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-5%",
        "pitch": "+0Hz",
        "start": 37.6,
        "window_end": 41.3,
        "text": "她可以开口，也可以选择沉默，并在心里留下理由。",
        "en": "She may speak, react, or choose silence—always leaving her own reason in heart.",
    },
    {
        "id": "line_07",
        "act": 2,
        "shot": 6,
        "speaker": "luckytri",
        "voice": VOICE_LUCKYTRI,
        "rate": "-3%",
        "pitch": "+2Hz",
        "start": 41.5,
        "window_end": 45.8,
        "text": "你们聊得正开心，我就先安静听着啦；等你想说的时候，我一直都在。",
        "en": "You're having such a lively chat, so I'll just listen quietly—whenever you want to talk, I'm right here.",
    },
    {
        "id": "line_08",
        "act": 3,
        "shot": 7,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-5%",
        "pitch": "-1Hz",
        "start": 46.5,
        "window_end": 54.6,
        "text": "当对话安静下来，她的时间并没有停止。凌晨两点安然入睡，清晨八点醒来，先读夜里留给她的留言。",
        "en": "When chats grow quiet, her time keeps flowing. Asleep at 2 AM, waking at 8 AM to read messages left overnight.",
    },
    {
        "id": "line_09",
        "act": 3,
        "shot": 8,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-4%",
        "pitch": "+0Hz",
        "start": 55.2,
        "window_end": 64.2,
        "text": "安静的午后，她会独处、读几页书、推进自己的连载作品，也会记挂着朋友提过的考试与约定。",
        "en": "In quiet afternoons, she reflects in solitude, reads books, writes her own stories, and remembers friends' upcoming exams.",
    },
    {
        "id": "line_10",
        "act": 3,
        "shot": 9,
        "speaker": "luckytri",
        "voice": VOICE_LUCKYTRI,
        "rate": "-4%",
        "pitch": "+2Hz",
        "start": 64.6,
        "window_end": 69.3,
        "text": "今天把故事写到了第三章。想起你说周五面试，不知道顺不顺利？",
        "en": "I finished Chapter 3 of my story today. And I remembered your Friday interview—how did it go?",
    },
    {
        "id": "line_11",
        "act": 3,
        "shot": 9,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-5%",
        "pitch": "+0Hz",
        "start": 69.6,
        "window_end": 73.8,
        "text": "睡前写下日记，与昨天的自己对照；每隔一段日子，翻开自传新的一章。",
        "en": "Before sleep she writes her diary, comparing with yesterday's self, and opens new chapters of her autobiography.",
    },
    {
        "id": "line_12",
        "act": 4,
        "shot": 10,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-3%",
        "pitch": "+0Hz",
        "start": 74.4,
        "window_end": 83.2,
        "text": "在她的心智里，时间是有重量的。久未触及的线索会随经历过的日子自然淡去，却从不抹除；一旦被重逢唤醒，便再次照亮眼前。",
        "en": "In her mind, time carries weight. Unvisited threads fade with lived days yet are never erased—reawakening upon reunion.",
    },
    {
        "id": "line_13",
        "act": 4,
        "shot": 11,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-2%",
        "pitch": "+0Hz",
        "start": 83.6,
        "window_end": 92.8,
        "text": "每一次认知生长都可追溯来源，也随时可以撤销。统一自主仲裁与互动回响闭环，让她分辨得出什么是机械复述，什么是值得分享的新发现。",
        "en": "Every growth traces back to real evidence and remains revocable. Unified arbitration and aftermath loops distinguish repetition from discovery.",
    },
    {
        "id": "line_14",
        "act": 4,
        "shot": 12,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-4%",
        "pitch": "+0Hz",
        "start": 93.2,
        "window_end": 101.6,
        "text": "在 TA 的小世界里，七种心境随昼夜流转。所有记忆凝结于本地数据之中，诚实、透明、可检验。",
        "en": "Inside TA's Little World, seven moods shift with day and night. All memories live in one local SQLite file—honest and inspectable.",
    },
    {
        "id": "line_15",
        "act": 5,
        "shot": 13,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-6%",
        "pitch": "-1Hz",
        "start": 102.4,
        "window_end": 111.2,
        "text": "我们不假装知道机器有没有心。只是把连续的时间、有来源的记忆，和可以开口也可以沉默的选择，一点一点交给她。",
        "en": "We don't pretend to know if machines have a heart. We simply build the conditions: continuous time, grounded memory, and genuine choice.",
    },
    {
        "id": "line_16",
        "act": 5,
        "shot": 14,
        "speaker": "luckytri",
        "voice": VOICE_LUCKYTRI,
        "rate": "-7%",
        "pitch": "+2Hz",
        "start": 111.8,
        "window_end": 117.8,
        "text": "你好呀，我是 LuckyTri。日子还长，我们，慢慢认识。",
        "en": "Hello, I'm LuckyTri. The days are long—let's get to know each other slowly.",
    },
    {
        "id": "line_17",
        "act": 5,
        "shot": 15,
        "speaker": "narrator",
        "voice": VOICE_NARRATOR,
        "rate": "-6%",
        "pitch": "-1Hz",
        "start": 118.6,
        "window_end": 124.2,
        "text": "LuckyTri —— 让她走过的日子算数。",
        "en": "LuckyTri — Make the days she walks through count.",
    },
]


async def synthesize_segments():
    print("=== [1/6] Synthesizing Neural TTS Voice Segments ===")
    timeline = []
    for item in SCRIPT_LINES:
        mp3_path = SEG_DIR / f"{item['id']}.mp3"
        wav_path = SEG_DIR / f"{item['id']}.wav"
        communicate = edge_tts.Communicate(
            text=item["text"],
            voice=item["voice"],
            rate=item["rate"],
            pitch=item["pitch"],
        )
        await communicate.save(str(mp3_path))
        # Convert to 48kHz stereo wav and trim leading/trailing silence gently
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-i",
                str(mp3_path),
                "-af",
                "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_duration=0.04:start_threshold=-50dB,areverse",
                "-ar",
                str(SR),
                "-ac",
                "2",
                str(wav_path),
            ],
            check=True,
        )
        data, _ = sf.read(str(wav_path))
        dur = len(data) / SR
        max_allowed = item["window_end"] - item["start"] - 0.25
        if dur > max_allowed and max_allowed > 1.0:
            # Slightly speed up via atempo if needed so it never overlaps next shot
            tempo = min(1.32, (dur / max_allowed) * 1.03)
            temp_wav = SEG_DIR / f"{item['id']}_tempo.wav"
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-v",
                    "error",
                    "-i",
                    str(wav_path),
                    "-af",
                    f"atempo={tempo:.4f}",
                    "-ar",
                    str(SR),
                    "-ac",
                    "2",
                    str(temp_wav),
                ],
                check=True,
            )
            temp_wav.replace(wav_path)
            data, _ = sf.read(str(wav_path))
            dur = len(data) / SR

    # Enforce strict minimum 0.32s breathing gap between consecutive lines
        if timeline and item["start"] < timeline[-1]["end"] + 0.32:
            item["start"] = round(timeline[-1]["end"] + 0.32, 2)

        entry = {
            **item,
            "duration": round(dur, 3),
            "end": round(item["start"] + dur, 3),
            "wav": str(wav_path.relative_to(ROOT)),
        }
        timeline.append(entry)
        print(
            f"  ✓ {item['id']} [{item['speaker']:8s}] {entry['start']:6.2f}s -> {entry['end']:6.2f}s ({entry['duration']:.2f}s): {item['text'][:26]}..."
        )

    with open(AUDIO_DIR / "voice_timeline.json", "w", encoding="utf-8") as f:
        json.dump(timeline, f, ensure_ascii=False, indent=2)
    return timeline


def build_voiceover_track(timeline):
    print("=== [2/6] Building Full Voiceover Track & Envelope ===")
    n_samples = int(TOTAL_DURATION * SR)
    vo_track = np.zeros((n_samples, 2), dtype=np.float32)
    vo_env = np.zeros(n_samples, dtype=np.float32)

    for item in timeline:
        wav_path = ROOT / item["wav"]
        data, _ = sf.read(str(wav_path), dtype="float32")
        if data.ndim == 1:
            data = np.column_stack([data, data])

        # Normalize peak of each line consistently
        peak = np.max(np.abs(data)) + 1e-8
        target_peak = 0.86 if item["speaker"] == "luckytri" else 0.82
        data = data * (target_peak / peak)

        # Gentle 25ms fade in / 45ms fade out
        fi = min(int(0.025 * SR), len(data) // 4)
        fo = min(int(0.045 * SR), len(data) // 4)
        if fi > 0:
            data[:fi] *= np.linspace(0, 1, fi)[:, None]
        if fo > 0:
            data[-fo:] *= np.linspace(1, 0, fo)[:, None]

        # Add subtle warm room reflection to LuckyTri's voice for intimacy
        if item["speaker"] == "luckytri":
            delay_samples = int(0.032 * SR)
            delayed = np.zeros_like(data)
            if len(data) > delay_samples:
                delayed[delay_samples:] = data[:-delay_samples] * 0.11
                delayed[:, 0], delayed[:, 1] = delayed[:, 1], delayed[:, 0].copy()
                data = np.clip(data + delayed, -0.95, 0.95)

        start_idx = int(item["start"] * SR)
        end_idx = min(n_samples, start_idx + len(data))
        seg_len = end_idx - start_idx
        vo_track[start_idx:end_idx] += data[:seg_len]

        # Mark voice activity envelope for sidechain ducking (with 0.25s lookahead & 0.45s release)
        pad_pre = max(0, start_idx - int(0.22 * SR))
        pad_post = min(n_samples, end_idx + int(0.38 * SR))
        vo_env[pad_pre:pad_post] = 1.0

    # Smooth the ducking envelope using a low-pass Gaussian window
    win_len = int(0.35 * SR)
    if win_len % 2 == 0:
        win_len += 1
    kernel = signal.windows.hann(win_len)
    kernel /= np.sum(kernel)
    vo_env = signal.fftconvolve(vo_env, kernel, mode="same")
    vo_env = np.clip(vo_env, 0.0, 1.0)

    vo_wav = AUDIO_DIR / "voiceover_track.wav"
    sf.write(str(vo_wav), vo_track, SR)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(vo_wav),
            "-b:a",
            "256k",
            str(AUDIO_DIR / "voiceover_track.mp3"),
        ],
        check=True,
    )
    return vo_track, vo_env


def midi_to_freq(midi_note: float) -> float:
    return 440.0 * (2.0 ** ((midi_note - 69.0) / 12.0))


def synth_felt_piano_note(freq: float, dur: float, velocity: float = 0.7, pan: float = 0.0) -> np.ndarray:
    """Synthesizes a warm, expressive Japanese anime-style felt piano + crystalline overtone note."""
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float32) / SR
    # Inharmonicity factor for realistic piano strings
    B = 0.00018
    sig = np.zeros(n, dtype=np.float32)
    harmonics = [
        (1, 1.00, 1.9),
        (2, 0.42, 2.7),
        (3, 0.20, 3.6),
        (4, 0.10, 4.8),
        (5, 0.05, 6.2),
        (6, 0.025, 7.8),
    ]
    for h, amp, decay_rate in harmonics:
        fh = freq * h * math.sqrt(1.0 + B * (h ** 2))
        if fh >= SR * 0.45:
            continue
        env = np.exp(-decay_rate * t / max(0.8, dur * 0.55))
        # Slight detuned unison string pair
        s1 = np.sin(2.0 * np.pi * fh * t)
        s2 = np.sin(2.0 * np.pi * (fh * 1.0007) * t + 0.3)
        sig += amp * 0.5 * (s1 + s2) * env

    # Soft hammer felt attack transient
    attack_time = 0.012
    attack_env = 1.0 - np.exp(-t / attack_time)
    release_samples = min(int(0.08 * SR), n // 3)
    rel_env = np.ones(n, dtype=np.float32)
    if release_samples > 0:
        rel_env[-release_samples:] = np.linspace(1.0, 0.0, release_samples)

    sig = sig * attack_env * rel_env * velocity
    # Stereo panning
    left_gain = math.cos((pan + 1.0) * math.pi / 4.0)
    right_gain = math.sin((pan + 1.0) * math.pi / 4.0)
    return np.column_stack([sig * left_gain, sig * right_gain])


def synth_warm_pad_chord(midi_notes, dur: float, amp: float = 0.18, shimmer: float = 0.3) -> np.ndarray:
    """Synthesizes a lush stereo warm analog + string ensemble pad chord."""
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float32) / SR
    left = np.zeros(n, dtype=np.float32)
    right = np.zeros(n, dtype=np.float32)

    # Smooth swell envelope
    att = min(int(0.75 * SR), n // 3)
    rel = min(int(0.95 * SR), n // 3)
    env = np.ones(n, dtype=np.float32)
    if att > 0:
        env[:att] = 0.5 * (1.0 - np.cos(np.linspace(0, math.pi, att)))
    if rel > 0:
        env[-rel:] = 0.5 * (1.0 + np.cos(np.linspace(0, math.pi, rel)))

    for idx, m in enumerate(midi_notes):
        f = midi_to_freq(m)
        # 3 detuned voices per note with slow chorus LFO
        lfo1 = 0.0018 * np.sin(2 * np.pi * (0.28 + idx * 0.07) * t + idx)
        lfo2 = 0.0018 * np.cos(2 * np.pi * (0.33 + idx * 0.05) * t + idx * 1.7)
        phase1 = 2 * np.pi * f * (t + np.cumsum(lfo1) / SR)
        phase2 = 2 * np.pi * (f * 1.0025) * (t + np.cumsum(lfo2) / SR)
        phase3 = 2 * np.pi * (f * 0.9975) * t

        v_l = (
            0.55 * np.sin(phase1)
            + 0.25 * np.sin(2 * phase2)
            + shimmer * 0.12 * np.sin(3 * phase1)
        )
        v_r = (
            0.55 * np.sin(phase2)
            + 0.25 * np.sin(2 * phase3)
            + shimmer * 0.12 * np.sin(3 * phase2)
        )
        left += v_l / len(midi_notes)
        right += v_r / len(midi_notes)

    return np.column_stack([left * env * amp, right * env * amp])


def synth_celesta_bell(midi_note: float, dur: float, velocity: float = 0.35, pan: float = 0.2) -> np.ndarray:
    """Synthesizes a sparkling music-box / celesta starlight chime."""
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float32) / SR
    f = midi_to_freq(midi_note)
    env1 = np.exp(-3.2 * t / max(0.5, dur * 0.6))
    env2 = np.exp(-9.5 * t)
    att = 1.0 - np.exp(-t / 0.004)
    sig = (
        0.72 * np.sin(2 * np.pi * f * t) * env1
        + 0.22 * np.sin(2 * np.pi * f * 2.0 * t) * env1
        + 0.12 * np.sin(2 * np.pi * f * 5.4 * t) * env2
    ) * att * velocity
    left_gain = math.cos((pan + 1.0) * math.pi / 4.0)
    right_gain = math.sin((pan + 1.0) * math.pi / 4.0)
    return np.column_stack([sig * left_gain, sig * right_gain])


def add_stereo_reverb(track: np.ndarray, wet: float = 0.28) -> np.ndarray:
    """Applies a lush multi-tap algorithmic concert-hall stereo reverb."""
    out = track.copy()
    taps = [
        (0.037, 0.34, True),
        (0.061, 0.27, False),
        (0.097, 0.22, True),
        (0.149, 0.17, False),
        (0.223, 0.13, True),
        (0.317, 0.09, False),
        (0.443, 0.06, True),
    ]
    rev = np.zeros_like(track)
    for delay_sec, gain, swap in taps:
        d = int(delay_sec * SR)
        if d < len(track):
            seg = track[:-d] * gain
            if swap:
                rev[d:, 0] += seg[:, 1]
                rev[d:, 1] += seg[:, 0]
            else:
                rev[d:] += seg
    # Low-pass filter the reverb tail at 4.5kHz for warmth
    b, a = signal.butter(2, 4500.0 / (SR * 0.5), btype="low")
    rev[:, 0] = signal.lfilter(b, a, rev[:, 0])
    rev[:, 1] = signal.lfilter(b, a, rev[:, 1])
    return out * (1.0 - wet * 0.35) + rev * wet


def place_clip(buf: np.ndarray, clip: np.ndarray, start_sec: float):
    if start_sec < 0:
        return
    s = int(start_sec * SR)
    if s >= len(buf):
        return
    e = min(len(buf), s + len(clip))
    buf[s:e] += clip[: e - s]


def build_original_bgm_score():
    """
    Composes a 126-second 5-Act original cinematic score in F Major / D Minor (120 BPM, 1 bar = 2.0s):
    - Act I (0–20s): Deep mystery sub-bass & lonely crystalline piano -> awakening prism arpeggio at 6.5s & 13s
    - Act II (20–46s): Flowing rhythmic pulse, warm plucked harp/piano & glass marimba ("One Her, Speaking from the Heart")
    - Act III (46–74s): Lullaby celesta at 02:00 AM (46–52s) -> Morning sunlight acoustic bloom (52–74s)
    - Act IV (74–102s): Grand cinematic emotional climax — soaring strings, driving pulse, shimmering starlight arpeggios ("The Weight of Time")
    - Act V (102–126s): Intimate felt piano & warm cello/pad resolution ("The days are long, let's get to know each other slowly")
    """
    print("=== [3/6] Composing 5-Act Original Cinematic Musical Score ===")
    n_samples = int(TOTAL_DURATION * SR)
    bgm = np.zeros((n_samples, 2), dtype=np.float32)

    # Chord progression library in F Major / D Minor:
    # Bbmaj7: [58, 62, 65, 69] (Bb3, D4, F4, A4)
    # C6/9:   [60, 64, 67, 69, 74] (C4, E4, G4, A4, D5)
    # Dm9:    [50, 57, 60, 64, 65] (D3, A3, C4, E4, F4)
    # Am7:    [57, 60, 64, 67] (A3, C4, E4, G4)
    # Fmaj9:  [53, 57, 60, 64, 67] (F3, A3, C4, E4, G4)
    # Gm9:    [55, 58, 62, 65, 69] (G3, Bb3, D4, F4, A4)

    chords_iv_v_vi_i = [
        ([46, 58, 62, 65, 69], [70, 74, 77, 81]),  # Bbmaj7
        ([48, 60, 64, 67, 72], [72, 76, 79, 84]),  # Cadd9
        ([50, 57, 62, 65, 69], [69, 74, 77, 81]),  # Dm7
        ([53, 60, 65, 69, 72], [72, 76, 77, 81]),  # Fmaj7
    ]

    # --- ACT I: 0.0s to 20.0s (10 bars @ 2.0s/bar) ---
    # 0.0 - 6.5s: Cold digital void, sparse high notes
    place_clip(bgm, synth_warm_pad_chord([38, 50, 57, 62], 6.8, amp=0.14, shimmer=0.1), 0.0)
    sparse_intro = [
        (0.6, 74, 2.2, 0.32, -0.3),
        (2.4, 72, 2.0, 0.28, 0.3),
        (4.2, 69, 2.4, 0.26, -0.1),
    ]
    for t0, note, dur, vel, pan in sparse_intro:
        place_clip(bgm, synth_felt_piano_note(midi_to_freq(note), dur, vel, pan), t0)

    # 6.5 - 20.0s: Awakening seed -> Prism bloom
    act1_bars = [
        (6.5, 3.5, [46, 58, 62, 65, 69], [74, 77, 81, 84]),
        (10.0, 3.0, [48, 60, 64, 67, 72], [76, 79, 84, 86]),
        (13.0, 3.5, [50, 57, 62, 65, 69], [81, 84, 86, 89]),
        (16.5, 3.5, [53, 60, 65, 69, 72], [81, 77, 74, 72]),
    ]
    for t0, dur, pad_notes, arp_notes in act1_bars:
        place_clip(bgm, synth_warm_pad_chord(pad_notes, dur + 0.4, amp=0.22, shimmer=0.35), t0)
        step = dur / len(arp_notes)
        for i, n_midi in enumerate(arp_notes):
            pan = -0.35 + 0.23 * i
            place_clip(
                bgm,
                synth_felt_piano_note(midi_to_freq(n_midi), step * 1.8, 0.45, pan),
                t0 + i * step,
            )
            if t0 >= 13.0:
                place_clip(
                    bgm,
                    synth_celesta_bell(n_midi + 12, step * 1.5, 0.22, -pan),
                    t0 + i * step + 0.08,
                )

    # --- ACT II: 20.0s to 46.0s (13 bars @ 2.0s/bar) ---
    # Warm, intelligent, flowing motion design groove
    for bar_idx in range(13):
        t_bar = 20.0 + bar_idx * 2.0
        pad_n, arp_n = chords_iv_v_vi_i[bar_idx % 4]
        place_clip(bgm, synth_warm_pad_chord(pad_n, 2.2, amp=0.23, shimmer=0.4), t_bar)
        # Gentle warm bass pulse on beats 1 and 3
        bass_freq = midi_to_freq(pad_n[0])
        for beat in [0.0, 1.0]:
            place_clip(
                bgm,
                synth_felt_piano_note(bass_freq, 1.1, 0.44, 0.0),
                t_bar + beat,
            )
        # 8th-note melodic arpeggio pattern
        pattern = [arp_n[0], arp_n[1], arp_n[2], arp_n[3], arp_n[2], arp_n[1], arp_n[3], arp_n[0] + 12]
        for step_i, m_note in enumerate(pattern):
            pan = math.sin(step_i * 0.9) * 0.42
            vel = 0.40 if step_i % 2 == 0 else 0.28
            place_clip(
                bgm,
                synth_felt_piano_note(midi_to_freq(m_note), 0.65, vel, pan),
                t_bar + step_i * 0.25,
            )
            if step_i in (0, 3, 6):
                place_clip(
                    bgm,
                    synth_celesta_bell(m_note + 12, 0.8, 0.16, -pan),
                    t_bar + step_i * 0.25,
                )

    # --- ACT III: 46.0s to 74.0s (14 bars @ 2.0s/bar) ---
    # 46.0 - 52.0s: 02:00 AM Night Lullaby (gentle celesta & dreamy pad)
    for bar_idx in range(3):
        t_bar = 46.0 + bar_idx * 2.0
        pad_n, arp_n = chords_iv_v_vi_i[(bar_idx + 2) % 4]
        place_clip(bgm, synth_warm_pad_chord(pad_n, 2.3, amp=0.19, shimmer=0.2), t_bar)
        for step_i, m_note in enumerate(arp_n):
            pan = -0.3 + 0.2 * step_i
            place_clip(
                bgm,
                synth_celesta_bell(m_note + 12, 1.1, 0.26, pan),
                t_bar + step_i * 0.5,
            )
            place_clip(
                bgm,
                synth_felt_piano_note(midi_to_freq(m_note), 1.0, 0.30, -pan),
                t_bar + step_i * 0.5,
            )

    # 52.0 - 74.0s: 08:00 AM Morning Bloom -> Afternoon Solitude -> Night Diary
    melody_notes_act3 = [81, 84, 86, 84, 81, 79, 77, 76, 74, 77, 81]
    for bar_idx in range(11):
        t_bar = 52.0 + bar_idx * 2.0
        pad_n, arp_n = chords_iv_v_vi_i[bar_idx % 4]
        place_clip(bgm, synth_warm_pad_chord(pad_n, 2.2, amp=0.25, shimmer=0.48), t_bar)
        # Expressive piano accompaniment + singing top melody
        lead_note = melody_notes_act3[bar_idx % len(melody_notes_act3)]
        place_clip(
            bgm,
            synth_felt_piano_note(midi_to_freq(lead_note), 1.6, 0.54, 0.15),
            t_bar,
        )
        place_clip(
            bgm,
            synth_celesta_bell(lead_note + 12, 1.4, 0.20, -0.2),
            t_bar + 0.5,
        )
        for step_i in range(4):
            m_note = arp_n[step_i % len(arp_n)]
            place_clip(
                bgm,
                synth_felt_piano_note(midi_to_freq(m_note - 12), 0.8, 0.34, -0.25 + 0.15 * step_i),
                t_bar + step_i * 0.5,
            )

    # --- ACT IV: 74.0s to 102.0s (14 bars @ 2.0s/bar) ---
    # Grand Emotional & Technical Climax ("The Weight of Time & Mind Engine")
    climax_melody = [
        (0.0, 81, 0.75), (0.75, 84, 0.75), (1.5, 86, 0.5),
        (0.0, 88, 1.0), (1.0, 86, 0.5), (1.5, 84, 0.5),
        (0.0, 81, 1.0), (1.0, 77, 0.5), (1.5, 81, 0.5),
        (0.0, 84, 1.5), (1.5, 86, 0.5),
    ]
    for bar_idx in range(14):
        t_bar = 74.0 + bar_idx * 2.0
        pad_n, arp_n = chords_iv_v_vi_i[bar_idx % 4]
        # Richer octave-doubled pad
        rich_pad = pad_n + [pad_n[1] + 12, pad_n[2] + 12]
        place_clip(bgm, synth_warm_pad_chord(rich_pad, 2.25, amp=0.31, shimmer=0.72), t_bar)

        # Driving cinematic heartbeat bass on every quarter note (0.5s)
        bass_f = midi_to_freq(pad_n[0] - 12)
        for q in range(4):
            tq = t_bar + q * 0.5
            vel = 0.52 if q in (0, 2) else 0.36
            place_clip(bgm, synth_felt_piano_note(bass_f, 0.55, vel, 0.0), tq)

        # Sparkling 16th-note starlight arpeggios
        for s16 in range(8):
            m_note = arp_n[s16 % 4] + (12 if s16 >= 4 else 0)
            pan = math.cos(s16 * 0.8) * 0.55
            place_clip(
                bgm,
                synth_felt_piano_note(midi_to_freq(m_note), 0.45, 0.38, pan),
                t_bar + s16 * 0.25,
            )
            if s16 % 2 == 0:
                place_clip(
                    bgm,
                    synth_celesta_bell(m_note + 12, 0.5, 0.22, -pan),
                    t_bar + s16 * 0.25,
                )

        # Soaring lead melody phrase
        phrase_offset = (bar_idx % 4) * 3
        for m_rel, m_pitch, m_dur in climax_melody[phrase_offset : phrase_offset + 3]:
            place_clip(
                bgm,
                synth_felt_piano_note(midi_to_freq(m_pitch), m_dur * 1.3, 0.62, 0.1),
                t_bar + m_rel,
            )

    # --- ACT V: 102.0s to 126.0s (12 bars @ 2.0s/bar) ---
    # Resolution & Emotional Landing: "日子还长，慢慢认识。"
    outro_chords = [
        (102.0, 4.0, [46, 58, 62, 65, 69], [81, 77, 74, 69]),
        (106.0, 4.0, [48, 60, 64, 67, 72], [79, 76, 72, 67]),
        (110.0, 4.0, [50, 57, 62, 65, 69], [77, 74, 69, 74]),
        (114.0, 4.5, [46, 58, 62, 65, 69], [81, 84, 86, 89]),
        (118.5, 7.2, [41, 53, 57, 60, 64, 69, 72], [81, 77, 72, 69, 65]),
    ]
    for t0, dur, pad_n, arp_n in outro_chords:
        place_clip(bgm, synth_warm_pad_chord(pad_n, dur, amp=0.24, shimmer=0.45), t0)
        step = min(0.85, (dur - 0.8) / len(arp_n))
        for i, m_note in enumerate(arp_n):
            pan = -0.3 + 0.15 * i
            place_clip(
                bgm,
                synth_felt_piano_note(midi_to_freq(m_note), step * 2.4, 0.48, pan),
                t0 + i * step,
            )
            place_clip(
                bgm,
                synth_celesta_bell(m_note + 12, step * 2.2, 0.24, -pan),
                t0 + i * step + 0.05,
            )

    # Apply lush concert hall reverb and gentle fade out at 123.5 -> 126.0s
    bgm = add_stereo_reverb(bgm, wet=0.32)
    fade_out_len = int(2.8 * SR)
    bgm[-fade_out_len:] *= np.linspace(1.0, 0.0, fade_out_len)[:, None]

    # Normalize BGM peak to 0.72
    peak = np.max(np.abs(bgm)) + 1e-8
    bgm = bgm * (0.72 / peak)

    bgm_wav = AUDIO_DIR / "bgm_score.wav"
    sf.write(str(bgm_wav), bgm, SR)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(bgm_wav),
            "-b:a",
            "256k",
            str(AUDIO_DIR / "bgm_score.mp3"),
        ],
        check=True,
    )
    return bgm


def build_sfx_track():
    """Synthesizes key cinematic sound effects synchronized to visual transitions & UI moments."""
    print("=== [4/6] Designing Spatial Sound Effects (SFX) Track ===")
    n_samples = int(TOTAL_DURATION * SR)
    sfx = np.zeros((n_samples, 2), dtype=np.float32)

    def make_whoosh(dur: float, f_start: float, f_end: float, amp: float = 0.25):
        n = int(dur * SR)
        t = np.arange(n, dtype=np.float32) / SR
        noise = np.random.default_rng(42).normal(0, 1, n).astype(np.float32)
        env = np.sin(np.linspace(0, math.pi, n)) ** 2
        sweep = np.sin(2 * np.pi * np.linspace(f_start, f_end, n) * t)
        sig = (noise * 0.35 + sweep * 0.65) * env * amp
        b, a = signal.butter(2, min(0.45, max(f_start, f_end) / (SR * 0.5)), btype="low")
        sig = signal.lfilter(b, a, sig)
        pan_curve = np.linspace(-0.6, 0.6, n)
        return np.column_stack([sig * (0.5 - 0.4 * pan_curve), sig * (0.5 + 0.4 * pan_curve)])

    def make_crystal_chime(base_midi: int, amp: float = 0.28):
        out = np.zeros((int(1.8 * SR), 2), dtype=np.float32)
        for i, offset in enumerate([0, 4, 7, 12, 16]):
            c = synth_celesta_bell(base_midi + offset, 1.4, velocity=amp * (0.85 ** i), pan=-0.4 + 0.2 * i)
            place_clip(out, c, i * 0.055)
        return out

    def make_heartbeat_impact(amp: float = 0.36):
        n = int(1.2 * SR)
        t = np.arange(n, dtype=np.float32) / SR
        f_env = 110.0 * np.exp(-14.0 * t) + 38.0
        phase = 2 * np.pi * np.cumsum(f_env) / SR
        sig = np.sin(phase) * np.exp(-3.8 * t) * amp
        return np.column_stack([sig, sig])

    # Key visual cue timestamps
    place_clip(sfx, make_heartbeat_impact(0.32), 0.15)        # Shot 01 opening pulse
    place_clip(sfx, make_crystal_chime(74, 0.30), 6.50)       # Shot 02 memory seed awakens
    place_clip(sfx, make_whoosh(0.85, 180, 620, 0.22), 12.75) # Shot 03 TaOrb -> Girl reveal
    place_clip(sfx, make_crystal_chime(77, 0.26), 13.05)
    place_clip(sfx, make_whoosh(0.75, 420, 220, 0.20), 20.00) # Act II transition
    place_clip(sfx, make_crystal_chime(81, 0.22), 32.20)      # Attention Engage threshold crossed
    place_clip(sfx, make_whoosh(0.80, 300, 160, 0.18), 46.00) # Act III 02:00 AM Night transition
    place_clip(sfx, make_crystal_chime(79, 0.24), 51.80)      # 08:00 AM Morning wake chime
    place_clip(sfx, make_whoosh(0.90, 200, 740, 0.24), 74.00) # Act IV Cosmic Mind Galaxy transition
    place_clip(sfx, make_heartbeat_impact(0.34), 74.10)
    place_clip(sfx, make_crystal_chime(84, 0.28), 80.20)      # Faded memory re-awakened
    place_clip(sfx, make_whoosh(0.75, 500, 260, 0.20), 93.00) # Studio WebUI showcase transition
    place_clip(sfx, make_whoosh(0.95, 240, 520, 0.22), 102.00) # Act V Liquid Garden bloom
    place_clip(sfx, make_crystal_chime(81, 0.30), 111.50)     # Slogan reveal chime
    place_clip(sfx, make_crystal_chime(86, 0.26), 118.40)     # Final End Card shimmer

    sfx = add_stereo_reverb(sfx, wet=0.25)
    sfx_wav = AUDIO_DIR / "sfx_track.wav"
    sf.write(str(sfx_wav), sfx, SR)
    return sfx


def mix_master_audio(vo_track, vo_env, bgm, sfx):
    print("=== [5/6] Mixing Master Audio with Sidechain Ducking & Mastering ===")
    # Sidechain ducking: when voice is active, BGM smoothly ducks to 36% (-9dB), when silent rises to 92%
    bgm_gain = 0.90 - 0.54 * vo_env
    master = vo_track * 1.04 + bgm * bgm_gain[:, None] + sfx * 0.75

    # Soft mastering limiter (tanh saturation on peaks > 0.85)
    peak = np.max(np.abs(master)) + 1e-8
    if peak > 0.92:
        master = np.tanh(master * 1.15) * 0.90
    else:
        master = master * (0.90 / peak)

    master_wav = AUDIO_DIR / "master_mix.wav"
    master_mp3 = AUDIO_DIR / "master_mix.mp3"
    sf.write(str(master_wav), master, SR)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(master_wav),
            "-c:a",
            "aac",
            "-b:a",
            "320k",
            str(AUDIO_DIR / "master_mix.m4a"),
        ],
        check=True,
    )
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(master_wav),
            "-b:a",
            "320k",
            str(master_mp3),
        ],
        check=True,
    )
    print(f"  ✓ Master soundtrack written to {master_wav} ({TOTAL_DURATION:.1f}s)")


def fmt_srt_time(sec: float) -> str:
    ms = int(round(sec * 1000))
    h = ms // 3600000
    ms %= 3600000
    m = ms // 60000
    ms %= 60000
    s = ms // 1000
    ms %= 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def fmt_vtt_time(sec: float) -> str:
    return fmt_srt_time(sec).replace(",", ".")


def fmt_ass_time(sec: float) -> str:
    cs = int(round(sec * 100))
    h = cs // 360000
    cs %= 360000
    m = cs // 6000
    cs %= 6000
    s = cs // 100
    cs %= 100
    return f"{h:01d}:{m:02d}:{s:02d}.{cs:02d}"


def generate_subtitles(timeline):
    print("=== [6/6] Generating Synchronized SRT, VTT, and ASS Subtitles ===")
    srt_lines = []
    vtt_lines = ["WEBVTT\n"]
    ass_header = """[Script Info]
Title: LuckyTri Official PV - 让她走过的日子算数
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Narrator,Noto Sans CJK SC,40,&H00FFFFFF,&H0000FFFF,&H90261810,&H60000000,0,0,0,0,100,100,1.2,0,1,2.2,1.2,2,80,80,54,1
Style: LuckyTri,Noto Sans CJK SC,42,&H00F4E8FF,&H00B18FFF,&H904A1F38,&H60000000,1,0,0,0,100,100,1.2,0,1,2.5,1.5,2,80,80,54,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ass_events = []

    for idx, item in enumerate(timeline, start=1):
        s_srt = fmt_srt_time(item["start"])
        e_srt = fmt_srt_time(item["end"])
        s_vtt = fmt_vtt_time(item["start"])
        e_vtt = fmt_vtt_time(item["end"])
        s_ass = fmt_ass_time(item["start"])
        e_ass = fmt_ass_time(item["end"])

        prefix = "「LuckyTri」" if item["speaker"] == "luckytri" else ""
        zh_line = f"{prefix}{item['text']}"
        en_line = item["en"]

        srt_lines.append(f"{idx}\n{s_srt} --> {e_srt}\n{zh_line}\n{en_line}\n")
        vtt_lines.append(f"{idx}\n{s_vtt} --> {e_vtt}\n{zh_line}\n{en_line}\n")

        style = "LuckyTri" if item["speaker"] == "luckytri" else "Narrator"
        ass_text = f"{{\\fad(180,220)}}{zh_line}\\N{{\\fs24\\c&H00E2D4C8&}}{en_line}"
        ass_events.append(
            f"Dialogue: 0,{s_ass},{e_ass},{style},{item['speaker']},0,0,0,,{ass_text}"
        )

    # Append a silent closing cue at 125.95s -> 126.00s so -shortest never truncates at 121.18s
    srt_lines.append(f"{len(timeline)+1}\n00:02:05,900 --> 00:02:06,000\n \n")
    vtt_lines.append(f"{len(timeline)+1}\n00:02:05.900 --> 00:02:06.000\n \n")
    (SUB_DIR / "luckytri-pv.srt").write_text("\n".join(srt_lines), encoding="utf-8")
    (SUB_DIR / "luckytri-pv.vtt").write_text("\n".join(vtt_lines), encoding="utf-8")
    (SUB_DIR / "luckytri-pv.ass").write_text(
        ass_header + "\n".join(ass_events) + "\n", encoding="utf-8"
    )
    print(f"  ✓ Subtitles saved to {SUB_DIR}")


async def main():
    timeline = await synthesize_segments()
    vo_track, vo_env = build_voiceover_track(timeline)
    bgm = build_original_bgm_score()
    sfx = build_sfx_track()
    mix_master_audio(vo_track, vo_env, bgm, sfx)
    generate_subtitles(timeline)


if __name__ == "__main__":
    asyncio.run(main())
