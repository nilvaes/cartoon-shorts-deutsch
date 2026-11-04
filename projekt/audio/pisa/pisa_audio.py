# Sound for "The Leaning Tower That War Saved" (82.5 s), v2 (user feedback: "the music and effects change so fast it's
# distracting"): ONE theme (the shared F-major tune on a plucked mandolin), four broad moods (building, the wars,
# rebuilding and fixing, 1944 at sunset) crossfading over 2 s, and only the story's key effects. QUIET mix: music
# ~-22 LU under the voice while it speaks (duck -8 dB), effects 10 dB under their naive level. -15 LUFS / -1.2 dBTP.
# usage: python audio/pisa/pisa_audio.py  ->  audio/pisa/mix.wav, stem_*.wav, cues.md (ED=de: the German edition, *_de.*)
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "stink"))
from dsp import (SR, ns, tt, rng, dbg, lp, hp, bp, pan, st, place, fades, make_ir, convolve_st, integrated, momentary_max,
                 true_peak, read_wav, write_wav, colored, smooth_noise, phase, modal)
import instruments as I
import sfx_gen as G
import stink_audio as SA  # shared helpers: put, roll, theme, chords, limiter, ducking, small synths

FPS, TOTAL = 30, 2475
fr = lambda f: f / FPS
VOICE = os.path.join(ROOT, "voice", "leaning-tower", "voice_final.wav")
WORDS = os.path.join(ROOT, "voice", "leaning-tower", "words.json")
OUT = ""
# ED=de: the German edition. Cue times stay in English story frames and go through story.ts WARP_DE (the same time
# map the picture uses), so music sections and effects land on the German words.
if os.environ.get("ED") == "de":
    import re
    _src = open(os.path.join(ROOT, "src", "videos", "pisa", "story.ts"), encoding="utf-8").read()
    _blk = _src[_src.index("= [", _src.index("const WARP_DE")):]
    _blk = _blk[: _blk.index("];")]
    _total_de = int(re.search(r"export const TOTAL_DE = (\d+)", _src).group(1))
    _pairs = [(float(TOTAL) if a == "TOTAL" else float(a), float(_total_de) if b == "TOTAL_DE" else float(b))
              for a, b in re.findall(r"\[(\w+), (\w+)\]", _blk)]
    _en, _de = zip(*_pairs)
    fr = lambda f: float(np.interp(f, _en, _de)) / FPS
    TOTAL = _total_de
    VOICE = os.path.join(ROOT, "voice", "leaning-tower-de", "voice_final.wav")
    WORDS = os.path.join(ROOT, "voice", "leaning-tower-de", "words.json")
    OUT = "_de"
DUR = TOTAL / FPS
N = ns(DUR)
TARGET_LUFS, CEIL_DBTP, DUCK_DB, SFX_DB = -15.0, -1.2, -8.0, -10.0
F, Q = I.m2f, SA.Q
BAR = 4 * Q
put = SA.put

TIP, LURCH, EASE, BANANA, SIT, BURST_MARCH = fr(362), fr(1585), fr(1944), fr(1373), fr(1020), fr(558)  # boots burst at 18.6 s (story frame 558)

SECTIONS = [  # (name, start, end, mood): one theme, four moods
    ("build", 0.0, fr(560), "build"), ("wars", fr(560), fr(1112), "wars"), ("fix", fr(1112), fr(2005), "fix"), ("1944", fr(2005), DUR, "warm"),
]
MUSIC_TARGET = {"build": -21, "wars": -22, "fix": -21, "1944": -21}
XF = 2.0  # crossfade between moods (s)


def mandolin(out, f, t, dur, vel, r, p=0.2):
    """tremolo-picked string: fast repeated plucks over the note's length"""
    k, step = 0, 1 / 16.0
    while k * step < max(step, dur * 0.9):
        put(out, I.pluck(f, vel * (0.85 + 0.15 * (k % 2)), r, 0.25, bright=0.65), t + k * step, 0.55, p)
        k += 1


def render_section(name, a, b, kind, r):
    n = ns(b - a + 3.0)
    out = np.zeros((2, n))
    dur = b - a
    beats = int(dur / Q + 1e-6)
    chords = SA.MINOR if kind in ("minor", "stern", "under") else SA.CHORDS
    mel = SA.theme_notes(kind in ("minor", "stern"))

    def bass(vol=0.7, horns=True):
        for k in range(beats):
            root, tri = SA.CH[chords[(k // 4) % 8]]
            if k % 2 == 0:
                put(out, I.brass(F(root + (7 if (k // 2) % 2 else 0)), Q * 0.8, vol, r, "tuba"), k * Q, 0.9, -0.1)
            elif horns:
                for j, m in enumerate(tri):
                    put(out, I.brass(F(m - 12), Q * 0.45, 0.4 * vol, r, "horn"), k * Q, 0.2, -0.3 + 0.3 * j)

    def lead(inst="mand", vol=0.6, octave=0, start=0):
        for bt, l, m in mel:
            b2 = bt - start
            while b2 < 0:
                b2 += 32
            t = b2 * Q
            if t >= dur - 0.05:
                continue
            if inst == "mand":
                mandolin(out, F(m + octave), t, l * Q, vol, r)
            elif inst == "glock":
                put(out, I.glock(F(m + octave), vol, r, 1.2), t, 0.5, 0.25)
            elif inst == "vibes":
                put(out, I.vibes(F(m + octave), vol, r, 1.6), t, 0.5, 0.2)
            elif inst == "horn":
                put(out, I.brass(F(m + octave), l * Q * 0.9, vol, r, "horn"), t, 0.55, 0.1)

    if kind == "build":  # the tune on mandolin over a light brush pulse
        lead("mand", 0.55); lead("glock", 0.3, 12, 16)
        for k in range(1, beats, 2):
            put(out, I.brush(0.25, r), k * Q, 0.3)
    elif kind == "wars":  # the same tune, a soft snare march underneath
        lead("mand", 0.5); bass(0.5, horns=False)
        for k in range(beats):
            put(out, I.snare(0.28 if k % 2 == 0 else 0.18, r), k * Q, 0.25)
    elif kind == "fix":  # the same tune with bass and horns, steady
        lead("mand", 0.5); bass(0.6)
        for k in range(1, beats, 2):
            put(out, I.brush(0.24, r), k * Q, 0.3)
    elif kind == "light":
        lead("glock", 0.6); lead("mand", 0.45, -12)
        put(out, I.cymbal(0.4, r, 1.6), dur - 0.02, 0.4)
    elif kind == "busy":
        bass(0.55, horns=False); lead("mand", 0.55, 0, 8)
        for k in range(1, beats, 2):
            put(out, I.brush(0.3, r), k * Q, 0.35)
    elif kind == "sting":  # the tip: a sour stab and a sliding tuba
        put(out, I.brass(F(42), 0.5, 0.9, r, "stab"), 0.0, 0.7)
        put(out, I.brass(F(53), 1.2, 0.7, r, "tuba", fall=-6.0), 0.35, 0.8)
    elif kind == "under":  # underground: low drone + slow minor pizz
        put(out, I.pad([F(38), F(45), F(50)], dur, 0.35, r, att=1.0, warm=500), 0.0, 0.6)
        for k in range(0, beats, 2):
            put(out, I.pluck(F(SA.CH[chords[(k // 4) % 8]][0] + 12), 0.5, r, 0.6), k * Q, 0.6)
    elif kind == "march":  # the wars: snare march, theme on horn, marching again and again
        bass(0.75); lead("horn", 0.6)
        for k in range(beats):
            put(out, I.snare(0.5 if k % 2 == 0 else 0.35, r), k * Q, 0.4)
            put(out, I.snare(0.22, r), k * Q + Q / 2, 0.25)
    elif kind == "minor":
        put(out, I.pad([F(50), F(57), F(62)], dur, 0.35, r, att=0.8), 0.0, 0.5)
        lead("mand", 0.4, -12, 16)
    elif kind == "soft":
        for k in range(0, beats, 4):
            put(out, I.pad([F(m) for m in SA.CH[chords[(k // 4) % 8]][1]], BAR, 0.4, r), k * Q, 0.5)
        lead("glock", 0.4, 0, 24)
    elif kind == "heroic":  # 1272: floors stack up
        bass(0.75); lead("horn", 0.6); lead("mand", 0.4, 12)
        for k in range(beats):
            put(out, I.snare(0.3, r), k * Q, 0.25)
        put(out, I.cymbal(0.5, r, 1.6), BANANA - a, 0.4)
    elif kind == "stern":  # 1934: heavy minor march
        bass(0.85); lead("horn", 0.55, -12)
        for k in range(0, beats, 2):
            put(out, I.timpani(F(38), 0.55, r, 0.8), k * Q, 0.4)
    elif kind == "sting2":  # the lurch
        put(out, I.cymbal(0.7, r, 2.0), 0.0, 0.5)
        for j, m in enumerate([42, 54, 57, 60]):
            put(out, I.brass(F(m), 0.6, 0.85, r, "stab"), 0.0, 0.35, -0.3 + 0.2 * j)
    elif kind == "busy2":
        bass(0.55, horns=False); lead("mand", 0.5, 0, 16)
        for k in range(beats):
            put(out, I.brush(0.28, r), k * Q, 0.3)
    elif kind == "triumph":
        bass(0.75); lead("horn", 0.65, 0, 0)
        for j, m in enumerate([53, 65, 69, 72]):
            put(out, I.brass(F(m), 1.0, 0.7, r, "horn"), 0.0, 0.35, -0.3 + 0.2 * j)
        put(out, I.glock(F(84), 0.6, r, 1.6), 0.0, 0.4)
    elif kind == "warm":  # 1944: golden pads, the theme on vibes; a final chord at the end
        for k in range(0, beats - 4, 4):
            put(out, I.pad([F(m) for m in SA.CH[chords[(k // 4) % 8]][1]], BAR, 0.45, r), k * Q, 0.55)
        lead("vibes", 0.5, 0, 16); lead("mand", 0.3, 0, 16)
        tend = dur - 2.0
        put(out, I.pad([F(m) for m in [53, 65, 69, 72, 77]], 1.8, 0.55, r, att=0.05), tend, 0.7)
        put(out, I.glock(F(84), 0.6, r, 2.0), tend, 0.4)
    k_end = ns(dur + (2.5 if kind in ("warm", "sting", "sting2", "triumph", "light") else 0.6))
    out[:, k_end:] = 0
    return out


def music():
    secs, r = {}, rng(1173)
    hall = make_ir(1.4, 7, pre=0.015, hf=1.2)
    for k, (name, a, b, kind) in enumerate(SECTIONS):
        last = k == len(SECTIONS) - 1
        x = render_section(name, a, b + (0 if last else XF), kind, rng(int(r.integers(1 << 30))))
        x = x + 0.25 * convolve_st(x.mean(0), hall)[:, : x.shape[1]]
        n_x = ns(XF)
        if k:
            x[:, :n_x] *= np.linspace(0, 1, n_x)[None, :] ** 0.5
        if not last:
            e = ns(b - a + XF)
            x[:, e - n_x: e] *= np.linspace(1, 0, n_x)[None, :] ** 0.5
            x[:, e:] = 0
        buf = np.zeros((2, N)); place(buf, x, a)
        secs[name] = buf
    return secs


# ---------------- effects ----------------
def stone_groan(dur, r, low=1.0):
    """the tower complaining: a low grinding creak of stone on soil"""
    return G.creak(dur, r, 40 * low, 70 * low, G.TIMBER, [(0, 0), (0.2, 1), (0.8, 1), (1, 0)], rough=0.25, noise=0.15)


def rumble(dur, r, lvl=1.0):
    n = ns(dur)
    return fades(st(lp(colored(n, r, 1.6), 120, 2) * (0.6 + 0.4 * smooth_noise(n, r, 0.5)) * lvl), 0.4, 0.5)


def squelch(r):
    d = 0.6
    t = tt(d)
    f = 90 * (1 + 0.8 * np.sin(np.pi * t / d))
    x = np.sin(phase(f)) * np.exp(-t / 0.25) + 0.4 * lp(r.standard_normal(len(t)), 500, 2) * np.exp(-t / 0.15)
    return fades(x, 0.01, 0.1)


def fwump(r):
    d = 0.5
    t = tt(d)
    return fades(lp(r.standard_normal(len(t)), 300, 2) * np.exp(-t / 0.09) * 1.5 + np.sin(phase(60 * (1 + np.exp(-t / 0.02)))) * np.exp(-t / 0.12), 0.002, 0.1)


def boing(r):
    """cartoon spring for the banana pop"""
    d = 0.7
    t = tt(d)
    f = 180 * (1 + 1.2 * np.exp(-t / 0.15) * np.cos(2 * np.pi * 9 * t))
    return fades(np.sin(phase(f)) * np.exp(-t / 0.3), 0.003, 0.1)


def engine(dur, r, rate=7.0):
    t = tt(dur)
    chug = (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * rate * t))) * lp(r.standard_normal(len(t)), 400, 2)
    return fades(st(chug + 0.3 * np.sin(phase(np.full(len(t), 55.0)))), 0.3, 0.4)


def drill(dur, r):
    t = tt(dur)
    whine = np.sin(phase(np.full(len(t), 410.0) * (1 + 0.02 * np.sin(2 * np.pi * 3 * t))))
    grind = bp(r.standard_normal(len(t)), 800, 4000, 1) * (0.6 + 0.4 * np.sin(2 * np.pi * 11 * t) ** 2)
    return fades(st(0.4 * whine + grind), 0.3, 0.4)


def cues():
    R = rng(1990)
    rr = lambda: rng(int(R.integers(1 << 30)))
    C = []
    add = lambda t, label, gen, naive, kind="event", p=0.0, send=0.12: C.append((t, label, gen, naive, kind, p, send))
    # one quiet ambience at each end
    add(0.0, "tourists", lambda: fades(st(G.babble(fr(130), rr(), 160, 1.0)), 0.3, 0.3), -32, "bed")
    add(fr(2005), "evening birds", lambda: G.bird_chirps(DUR - fr(2005), rr(), 0.3, "blackbird"), -32, "bed")
    # the story's key moments only
    add(fr(130) - 0.25, "flash whoosh", lambda: G.whoosh(0.5, rr(), peak=0.5), -12)
    add(TIP - 0.4, "stone groan", lambda: stone_groan(1.4, rr()), -12)
    add(TIP, "tip thud", lambda: SA.thud(rr(), 1.4), -6)
    for k, t in enumerate(np.arange(BURST_MARCH, BURST_MARCH + 2.0, 0.5)):
        add(float(t), "boots", lambda: G.boot(rr(), 0.9), -18, p=0.25 if k % 2 else -0.25)
    add(SIT, "fwump", lambda: fwump(rr()), -10)
    add(BANANA, "boing", lambda: boing(rr()), -10)
    add(LURCH - 0.3, "stone groan", lambda: stone_groan(1.0, rr(), 0.8), -12)
    add(LURCH, "lurch thud", lambda: SA.thud(rr(), 1.6), -6)
    add(EASE - 0.3, "ease creak", lambda: stone_groan(1.6, rr(), 1.2), -16)
    add(EASE + 0.6, "cheer", lambda: G.applause(2.0, rr(), 14), -22, "bed")
    add(fr(2163) - 0.1, "binoculars", lambda: G.clink(rr(), 2200, 0.08), -16)
    return C


def sfx(v_ref):
    out, send, rows = np.zeros((2, N)), np.zeros(N), []
    for t, label, gen, naive, kind, p, snd in cues():
        x = np.asarray(gen(), float)
        x = pan(x, p) if x.ndim == 1 else x
        applied = naive + (SFX_DB if kind == "event" else 0.0)
        cur = momentary_max(x) if kind == "event" else integrated(x)
        if np.isfinite(cur):
            x = x * dbg(v_ref + applied - cur)
        place(out, x, t); G._place_mono(send, snd * x.mean(0), t); rows.append((t, label, kind, applied))
    out += 0.5 * convolve_st(send, make_ir(0.9, 31, pre=0.01, hf=1.4))[:, :N]
    return hp(out, 30, 2), rows


def load_voice():
    x, sr = read_wav(VOICE)
    assert sr == SR, sr
    v = x[0] if x.shape[0] == 1 else x.mean(0)
    out = np.zeros(N); out[: min(N, len(v))] = v[:N]
    return st(out)


def duck_curve(words, depth=DUCK_DB, pre=0.08, post=0.12, att=0.07, rel=0.45):
    ctrl = 1000
    nc = int(DUR * ctrl) + 2
    va = np.zeros(nc)
    for w in words:
        va[max(0, int((w["s"] - pre) * ctrl)): int((w["e"] + post) * ctrl)] = 1.0
    ka, kr = 1 - np.exp(-1 / (att * ctrl)), 1 - np.exp(-1 / (rel * ctrl))
    env, e = np.zeros(nc), 0.0
    for i in range(nc):
        e += (va[i] - e) * (ka if va[i] > e else kr); env[i] = e
    return np.interp(np.arange(N) / SR, np.arange(nc) / ctrl, depth * env)


def main():
    words = json.load(open(WORDS, encoding="utf-8"))
    v = load_voice(); v_ref = integrated(v)
    print(f"voice {v_ref:.2f} LUFS")
    secs, duck = music(), dbg(duck_curve(words))[None, :]
    m, levels = np.zeros((2, N)), []
    for name, a, b, kind in SECTIONS:
        x = secs[name] * duck
        seg = slice(ns(a), ns(min(b, DUR)))
        Lm, Lv = integrated(x[:, seg]), integrated(v[:, seg])
        if not np.isfinite(Lv):
            Lv = v_ref
        g = (Lv + MUSIC_TARGET[name] - Lm) if np.isfinite(Lm) else 0.0
        m += x * dbg(g); levels.append((name, a, b, g))
    end = ns(DUR - 0.05); m[:, end:] *= np.linspace(1, 0, N - end)[None, :]
    s, rows = sfx(v_ref)
    mix0 = v + m + s
    Gm = TARGET_LUFS - integrated(mix0)
    for _ in range(6):
        y, _g = SA.limiter(mix0 * dbg(Gm))
        L = integrated(y)
        if abs(L - TARGET_LUFS) < 0.02:
            break
        Gm += TARGET_LUFS - L
    y = fades(y, 0.0, 0.03)
    print(f"master {integrated(y):.2f} LUFS, TP {true_peak(y):.2f} dBTP")
    write_wav(os.path.join(HERE, f"mix{OUT}.wav"), y)
    for nm, x in [("voice", v), ("music", m), ("sfx", s)]:
        write_wav(os.path.join(HERE, f"stem_{nm}{OUT}.wav"), x * dbg(Gm))
    with open(os.path.join(HERE, f"cues{OUT}.md"), "w", encoding="utf-8") as f:
        f.write(f"# The Leaning Tower: sound cues\n\nMaster {integrated(y):.2f} LUFS, TP {true_peak(y):.2f} dBTP, {DUR:.3f} s.\n\n| Section | Start | End | Gain |\n|---|---|---|---|\n")
        for nm, a, b, g in levels:
            f.write(f"| {nm} | {a:.2f} | {b:.2f} | {g:+.1f} |\n")
        f.write("\n| Time | Cue | Kind | Level vs voice |\n|---|---|---|---|\n")
        for t, label, kind, ap in sorted(rows):
            f.write(f"| {t:.2f} | {label} | {kind} | {ap:+.1f} |\n")
    print("wrote mix.wav, stems, cues.md")


if __name__ == "__main__":
    main()
