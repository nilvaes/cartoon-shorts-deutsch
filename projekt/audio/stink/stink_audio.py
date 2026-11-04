# Sound for "The Great Stink" (73.0 s): an original light comic score (F major, 108 bpm: tuba oom-pah, horn
# after-beats, glockenspiel / pizzicato melody, field snare in the heroic part) whose sections follow the picture,
# a cue list of synthesized effects timed to the frames of src/videos/stink/story.ts + cast.ts, and the standard mix
# (voice unchanged, music ducked under the words and set ~10 LU under the voice, events 6 dB under their naive level),
# mastered to -15 LUFS / -1.2 dBTP. Reuses the template synths in audio/ (dsp, instruments, sfx_gen).
# usage: python audio/stink/stink_audio.py  ->  audio/stink/mix.wav, stem_*.wav, cues.md
import json, os, sys
import numpy as np
from scipy import ndimage, signal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))
from dsp import (SR, ns, tt, rng, dbg, lp, hp, bp, pan, st, place, fades, make_ir, convolve_st, integrated, momentary_max,
                 true_peak, read_wav, write_wav, colored, smooth_noise, phase)
import instruments as I
import sfx_gen as G

FPS, TOTAL = 30, 2190
DUR = TOTAL / FPS
N = ns(DUR)
fr = lambda f: f / FPS
VOICE = os.path.join(ROOT, "voice", "great-stink", "voice_final.wav")
WORDS = os.path.join(ROOT, "voice", "great-stink", "words.json")
TARGET_LUFS, CEIL_DBTP, DUCK_DB, SFX_DB = -15.0, -1.2, -6.0, -4.0  # deeper duck under the words; effects a touch up
F = I.m2f

# picture times (s): mirrored from story.ts / cast.ts
FLASH = fr(166)
BUMP, BURST = 18.0, 29.2
HITS3 = [55.55 - 0.35 + k * 0.12 + 0.35 for k in range(3)]  # money sacks land (cast.ts: t0 + 0.35 s fall)

# ================================================================ music
Q = 60 / 108          # quarter note
BAR = 4 * Q
# theme: (beat, length in beats, midi), 8 bars in F major; chords one per bar
THEME = [(0, 1, 77), (1, 1, 81), (2, 1, 84), (3, 1, 81), (4, 1, 82), (5, 1, 81), (6, 2, 79),
         (8, 1, 79), (9, 1, 82), (10, 1, 86), (11, 1, 82), (12, 1.5, 84), (13.5, .5, 82), (14, 1, 81), (15, 1, 79),
         (16, 1, 77), (17, 1, 81), (18, 1, 84), (19, 1, 89), (20, 1, 87), (21, 1, 86), (22, 1, 84), (23, 1, 82),
         (24, 1, 81), (25, 1, 79), (26, 1, 76), (27, 1, 79), (28, 3, 77)]
CHORDS = ["F", "Bb", "Gm", "C7", "F", "Bb", "C7", "F"]
CH = {"F": (41, [65, 69, 72]), "Bb": (46, [65, 70, 74]), "Gm": (43, [67, 70, 74]), "C7": (36, [64, 67, 70]),
      "Dm": (38, [65, 69, 74]), "A7": (45, [64, 67, 73]), "Gm7": (43, [65, 70, 74]), "Ebo": (39, [63, 66, 69])}
MINOR = ["Dm", "Gm", "A7", "Dm", "Dm", "Gm", "A7", "Dm"]

# sections: (name, start, end, kind); end of each = where the next begins (gaps are silence)
SECTIONS = [
    ("hook", 0.0, FLASH, "full"), ("setting", FLASH + 0.12, 10.85, "light"), ("june", 10.9, 15.7, "lazy"),
    ("queen", 15.7, 17.55, "fanfare"), ("back", 17.55, 19.1, "slide"), ("curtains", 19.1, 27.8, "sneaky"),
    ("roll", 27.85, BURST, "roll"), ("run", BURST, 32.4, "gallop"), ("lucky", 32.85, 37.05, "calm"),
    ("unlucky", 37.1, 40.6, "sour"), ("miasma", 40.7, 44.05, "minor"), ("germs", 45.15, 50.95, "minor_pizz"),
    ("moving", 51.05, 53.55, "build"), ("baz", 53.6, 62.3, "heroic"), ("quote", 62.3, 64.95, "hold"),
    ("resolve", 64.95, 68.25, "resolve"), ("today", 68.25, DUR, "warm"),
]
MUSIC_TARGET = {  # LU vs the voice in each section (after ducking): kept well under the narration (user: music was masking the voice)
    "hook": -14.5, "setting": -16.0, "june": -16.5, "queen": -15.0, "back": -15.5, "curtains": -16.0, "roll": -15.5,
    "run": -15.0, "lucky": -17.0, "unlucky": -15.5, "miasma": -16.0, "germs": -16.0, "moving": -15.0, "baz": -15.0,
    "quote": -17.5, "resolve": -14.5, "today": -15.5}


def put(buf, x, t, g=1.0, p=0.0):
    x = np.asarray(x, float)
    place(buf, pan(x, p) if x.ndim == 1 else x, t, g)


def roll(out, t0, t1, v0, v1, r, g=0.6):
    """buzz roll rendered from the template's stroke list"""
    for t, v in I.snare_roll(t0, t1, v0, v1, r):
        put(out, I.snare(v, r, 0.18, buzz=True), max(0.0, t), g)


def theme_notes(minor=False):
    out = []
    for b, l, m in THEME:
        if minor:  # F major -> D minor colour: lower the 3rd and 6th of the melody by a semitone after a minor third down
            m -= 3
            if m % 12 in (6, 11):
                m -= 1
        out.append((b, l, m))
    return out


def render_section(name, a, b, kind, r):
    """one section rendered dry into a stereo buffer starting at time 0 (placed at `a` by the caller)"""
    n = ns(b - a + 3.0)
    out = np.zeros((2, n))
    dur = b - a
    beats = int(dur / Q + 1e-6)
    chords = MINOR if "minor" in kind else CHORDS
    mel = theme_notes("minor" in kind)

    def bass_comp(vol=0.8, horns=True, oct_=0):
        for k in range(beats):
            t = k * Q
            ch = chords[(k // 4) % 8]
            root, tri = CH[ch]
            if k % 2 == 0:
                fifth = root + (7 if (k // 2) % 2 else 0)
                put(out, I.brass(F(fifth + oct_), Q * 0.8, vol, r, "tuba"), t, 0.9, -0.1)
            elif horns:
                for j, m in enumerate(tri):
                    put(out, I.brass(F(m - 12), Q * 0.45, 0.45 * vol, r, "horn"), t, 0.22, -0.3 + 0.3 * j)

    def melody(inst, vol=0.7, octave=0, swing=0.0, start_beat=0):
        for bt, l, m in mel:
            bt2 = bt - start_beat
            while bt2 < 0:
                bt2 += 32
            t = bt2 * Q + (swing * Q if bt2 % 1 > 0 else 0)
            if t >= dur - 0.05:
                continue
            f = F(m + octave)
            if inst == "glock":
                put(out, I.glock(f, vol, r, 1.2), t, 0.55, 0.25)
            elif inst == "pluck":
                put(out, I.pluck(f, vol, r, 0.6), t, 0.8, 0.2)
            elif inst == "horn":
                put(out, I.brass(f, l * Q * 0.9, vol, r, "horn"), t, 0.6, 0.1)
            elif inst == "vibes":
                put(out, I.vibes(f, vol, r, 1.6), t, 0.55, 0.2)
            elif inst == "fife":
                put(out, I.fife(f, l * Q * 0.85, vol, r), t, 0.35, 0.15)

    if kind == "full":
        bass_comp(0.85); melody("glock", 0.75); melody("pluck", 0.5, -12)
        put(out, I.cymbal(0.5, r, 1.6), max(0.0, dur - 0.02), 0.5)           # crash into the flash
        put(out, I.brass(F(41), 0.4, 0.95, r, "stab"), dur - 0.02, 0.8)
    elif kind == "light":
        bass_comp(0.6, horns=False); melody("pluck", 0.65, 0, start_beat=8)
    elif kind == "lazy":  # hot June: tuba wilts, a sleepy vibes line
        for k in range(0, beats, 2):
            root = CH[CHORDS[(k // 4) % 8]][0]
            put(out, I.brass(F(root), Q * 1.6, 0.6, r, "soft", fall=-3.0), k * Q, 0.8)
        melody("vibes", 0.45, 0, start_beat=16)
    elif kind == "fanfare":  # the Queen: a little regal flourish
        for i, (bt, m) in enumerate([(0, 72), (0.5, 72), (1, 77), (2, 81), (2.5, 84)]):
            put(out, I.brass(F(m), 0.35 if i < 4 else 1.0, 0.85, r, "horn"), bt * Q, 0.7, 0.1)
        put(out, I.snare(0.6, r), 0.0, 0.4); put(out, I.snare(0.5, r), 0.5 * Q, 0.35)
        put(out, I.timpani(F(41), 0.6, r, 1.5), 2 * Q, 0.6)
    elif kind == "slide":  # ...and back in minutes: a sad tuba slide down
        put(out, I.brass(F(53), 1.1, 0.8, r, "tuba", fall=-7.0), 0.15, 0.9)
    elif kind == "sneaky":
        bass_comp(0.55, horns=False); melody("pluck", 0.55, 0, start_beat=0)
        for k in range(1, beats, 2):
            put(out, I.brush(0.35, r), k * Q, 0.4)
    elif kind == "roll":
        roll(out, 0.0, dur, 0.15, 0.85, r, 0.7)
    elif kind == "gallop":  # Disraeli runs: quick pizzicato gallop, a crash on the burst
        put(out, I.cymbal(0.8, r, 2.0), 0.0, 0.7); put(out, I.brass(F(53), 0.35, 1.0, r, "stab"), 0.0, 0.9)
        for k in range(int(dur / (Q / 2))):
            m = [65, 69, 72, 69][k % 4] + (2 if (k // 8) % 2 else 0)
            put(out, I.pluck(F(m), 0.7, r, 0.3), k * Q / 2, 0.7, 0.2 if k % 2 else -0.2)
    elif kind == "calm":
        for k in range(0, beats, 4):
            put(out, I.pad([F(m) for m in CH[CHORDS[(k // 4) % 8]][1]], BAR, 0.4, r), k * Q, 0.6)
        melody("glock", 0.45, 0, start_beat=0)
    elif kind == "sour":  # "Unluckily": a sour stab and a wobbling descent
        put(out, I.brass(F(42), 0.6, 0.95, r, "stab"), 0.0, 0.8)
        for j, m in enumerate([60, 63, 66]):
            put(out, I.brass(F(m), 0.6, 0.6, r, "stab"), 0.0, 0.35, -0.3 + 0.3 * j)
        for k, m in enumerate([53, 52, 51, 50]):
            put(out, I.brass(F(m - 12), 0.55, 0.65, r, "tuba", fall=-1.0), 0.8 + k * 0.6, 0.8)
    elif kind in ("minor", "minor_pizz"):
        bass_comp(0.55, horns=False)
        melody("pluck", 0.6, -12 if kind == "minor" else 0, start_beat=0 if kind == "minor" else 16)
    elif kind == "build":  # Parliament gets moving: rising brass over a snare crescendo
        roll(out, 0.0, dur - 0.2, 0.2, 0.9, r, 0.5)
        for k, m in enumerate([60, 62, 64, 65, 67, 69, 70, 72]):
            put(out, I.brass(F(m), dur / 8 * 0.95, 0.5 + 0.06 * k, r, "horn"), k * dur / 8, 0.6)
    elif kind == "heroic":  # Bazalgette: the theme as a march, snare on the off-beats, horns on the tune
        bass_comp(0.8); melody("horn", 0.7); melody("glock", 0.4, 12)
        for k in range(beats):
            put(out, I.snare(0.45 if k % 2 else 0.3, r), k * Q, 0.35)
            if k % 2:
                put(out, I.snare(0.25, r), k * Q + Q / 2, 0.25)
        for t0 in HITS3:  # timpani under the money sacks
            put(out, I.timpani(F(41), 0.8, r, 1.2), t0 - a, 0.5)
        tg = 60.06 - a  # "doubled": the horns climb an octave
        put(out, I.brass(F(65), 1.2, 0.8, r, "horn", scoop=-12.0), tg, 0.5); put(out, I.brass(F(77), 0.9, 0.85, r, "horn"), tg + 0.75, 0.5)
    elif kind == "hold":  # the quote sits on a held chord; a stab on "he said"
        put(out, I.pad([F(m) for m in [65, 69, 72, 77]], dur - 0.4, 0.5, r, att=0.3), 0.0, 0.6)
        put(out, I.brass(F(41), 0.5, 0.9, r, "stab"), 64.04 - a, 0.7)
    elif kind == "resolve":  # big F major on "It stopped cholera"
        bass_comp(0.75)
        t1 = 66.94 - a
        put(out, I.cymbal(0.7, r, 2.4), t1, 0.6)
        for j, m in enumerate([53, 65, 69, 72, 77]):
            put(out, I.brass(F(m), 1.2, 0.85, r, "horn"), t1, 0.45, -0.4 + 0.2 * j)
        put(out, I.glock(F(89), 0.7, r, 1.6), t1, 0.5)
    elif kind == "warm":  # today: warm pads, the theme on vibes and glock, a final chord
        for k in range(0, beats - 4, 4):
            put(out, I.pad([F(m) for m in CH[CHORDS[(k // 4) % 8]][1]], BAR, 0.45, r), k * Q, 0.6)
            put(out, I.brass(F(CH[CHORDS[(k // 4) % 8]][0]), Q * 1.5, 0.5, r, "soft"), k * Q, 0.6)
        melody("vibes", 0.55, 0, start_beat=16)
        melody("glock", 0.35, 12, start_beat=16)
        tend = dur - 1.9
        put(out, I.pad([F(m) for m in [53, 65, 69, 72, 77]], 1.6, 0.55, r, att=0.05), tend, 0.75)
        put(out, I.glock(F(84), 0.6, r, 2.0), tend, 0.45); put(out, I.triangle(0.4, r), tend, 0.3)
    k_end = ns(dur + (2.5 if kind in ("warm", "resolve", "gallop", "full") else 0.6))
    out[:, k_end:] = 0
    return out


def music():
    secs = {}
    r = rng(1858)
    hall = make_ir(1.4, 7, pre=0.015, hf=1.2)
    for name, a, b, kind in SECTIONS:
        x = render_section(name, a, b, kind, rng(int(r.integers(1 << 30))))
        x = x + 0.25 * convolve_st(x.mean(0), hall)[:, : x.shape[1]]
        buf = np.zeros((2, N))
        place(buf, x, a)
        # sections end where the next begins (except the long ring-outs); 30 ms fade at the boundary
        nxt = [s[1] for s in SECTIONS if s[1] > a + 1e-6]
        if nxt and kind not in ("full", "gallop", "resolve", "warm", "slide"):
            e = ns(min(nxt))
            buf[:, e:] = 0
            buf[:, max(0, e - ns(0.03)): e] *= np.linspace(1, 0, min(e, ns(0.03)))[None, :]
        secs[name] = buf
    return secs


# ================================================================ effects
def fly_buzz(dur, r, n_flies=3):
    """little cloud of flies: buzzing saw-ish tones with wandering pitch and loudness (stink beds)"""
    n = ns(dur)
    out = np.zeros((2, n))
    t = np.arange(n) / SR
    for k in range(n_flies):
        f0 = r.uniform(170, 240)
        f = f0 * (1 + 0.08 * smooth_noise(n, r, 3.0) + 0.02 * np.sin(2 * np.pi * r.uniform(9, 14) * t))
        ph = phase(f)
        x = np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph) + 0.12 * np.sin(5 * ph)
        amp = np.clip(0.5 + 0.6 * smooth_noise(n, r, 0.8), 0, 1) ** 2
        out += pan(bp(x * amp, 150, 3000, 1), r.uniform(-0.7, 0.7))
    return fades(out, 0.3, 0.4)


def gloop(r):
    """a thick sewage 'blub': low bubble that pops"""
    d = 0.45
    t = tt(d)
    f = 110 * (1 + 2.2 * (t / d) ** 1.5)
    x = np.sin(phase(f)) * np.exp(-t / 0.12) * (t < 0.3)
    pop = bp(r.standard_normal(len(t)), 600, 3000, 1) * np.exp(-np.maximum(0, t - 0.28) / 0.01) * (t >= 0.28) * 0.6
    return fades(x + pop, 0.004, 0.05)


def pour(dur, r, thick=1.0):
    """sewage pouring from the outfall onto the river: heavy low splatter noise"""
    n = ns(dur)
    nz = colored(n, r, 1.0) * (0.7 + 0.3 * smooth_noise(n, r, 6.0))
    x = lp(nz, 900 * thick, 2) + 0.3 * bp(nz, 1200, 4000, 1)
    return fades(st(x), 0.25, 0.4)


def zip_up(dur, r, f0=500, f1=2400):
    """thermometer climbing: a bright rising whistle-slide"""
    t = tt(dur)
    f = f0 * (f1 / f0) ** (t / dur)
    return fades(np.sin(phase(f)) * (0.4 + 0.6 * t / dur), 0.02, 0.06)


def oar(r, big=1.0):
    d = 0.5
    t = tt(d)
    sw = bp(r.standard_normal(len(t)), 300, 2500, 1) * np.exp(-t / 0.09) * big
    plunk = np.sin(phase(r.uniform(180, 260) * (1 + 0.5 * np.exp(-t / 0.02)))) * np.exp(-t / 0.05) * 0.5
    return fades(sw + plunk, 0.003, 0.08)


def drip(r):
    d = 0.18
    t = tt(d)
    f = r.uniform(900, 1500) * (1 + 1.2 * t / d)
    return fades(np.sin(phase(f)) * np.exp(-t / 0.035), 0.001, 0.03)


def sack_pour(dur, r):
    """powder hissing out of a sack: bright noise with grit"""
    n = ns(dur)
    nz = r.standard_normal(n)
    grit = (r.random(n) < 0.004) * r.standard_normal(n) * 3
    return fades(st(bp(nz, 1800, 9000, 1) * 0.6 + hp(grit, 2000, 1)), 0.15, 0.3)


def poof(r):
    d = 0.6
    t = tt(d)
    return fades(lp(r.standard_normal(len(t)), 700, 2) * np.exp(-t / 0.12) * (1 - np.exp(-t / 0.01)), 0.005, 0.1)


def alarm_beeps(dur, r, period=0.42, on=0.21, f=3100.0):
    t = tt(dur)
    gate = ((t % period) < on).astype(float)
    gate = ndimage.uniform_filter1d(gate, 48)
    sq = signal.square(2 * np.pi * f * t) * 0.5 + np.sin(2 * np.pi * f * t) * 0.5
    return lp(sq * gate, 6000, 2)


def crackle(dur, r):
    n = ns(dur)
    pops = (r.random(n) < 0.0015) * r.standard_normal(n)
    hiss = bp(r.standard_normal(n), 1500, 7000, 1) * 0.08
    return fades(st(hp(pops, 800, 1) + hiss), 0.1, 0.2)


def scribble(dur, r):
    """pencil on paper: filtered scratch strokes"""
    n = ns(dur)
    t = np.arange(n) / SR
    strokes = np.clip(np.sin(2 * np.pi * 3.2 * t + 2 * smooth_noise(n, r, 1.0)), 0, 1) ** 0.5
    return fades(bp(r.standard_normal(n), 2500, 8000, 1) * strokes, 0.01, 0.05)


def thud(r, weight=1.0):
    d = 0.4
    t = tt(d)
    body = np.sin(phase(70 * (1 + 0.6 * np.exp(-t / 0.015)))) * np.exp(-t / 0.07)
    cloth = bp(r.standard_normal(len(t)), 300, 2000, 1) * np.exp(-t / 0.03) * 0.5
    return fades((body + cloth) * weight, 0.002, 0.08)


def growl(dur, r):
    """the miasma cloud's grumble: a low buzzy voice with a slow wobble"""
    t = tt(dur)
    f = 68 * (1 + 0.06 * np.sin(2 * np.pi * 5.5 * t)) * (1 - 0.1 * t / dur)
    x = signal.sawtooth(phase(f))
    x = bp(x, 120, 900, 2) * (1 + 0.4 * np.sin(2 * np.pi * 9 * t))
    return fades(x, 0.06, 0.25)


def innocent_whistle(r):
    t0, x = I.whistle([(0.0, 0.22, 84, 0.8), (0.24, 0.3, 79, 0.7)], r)
    return x


def cues():
    """(time, label, generator -> mono/stereo array, naive LU vs voice, kind, pan, extra send)"""
    R = rng(2026)
    rr = lambda: rng(int(R.integers(1 << 30)))
    C = []
    add = lambda t, label, gen, naive, kind="event", p=0.0, send=0.12: C.append((t, label, gen, naive, kind, p, send))
    # stink beds: flies around the stinky shots, the river lapping
    for a, b, lvl in [(0.0, fr(170), -21), (fr(170), fr(326), -24), (fr(326), fr(471), -22), (fr(528), fr(573), -24),
                      (fr(984 + 128), fr(1220), -19), (fr(1531), fr(1607), -24)]:
        add(a, "flies", lambda a=a, b=b: fly_buzz(b - a, rr()), lvl, "bed")
    for a, b in [(fr(170), fr(326)), (fr(426), fr(573)), (fr(984), fr(1112))]:
        add(a, "river", lambda a=a, b=b: fades(G.water_bed(b - a, rr(), 0.6), 0.3, 0.3), -22, "bed")
    add(fr(170), "outfall pour", lambda: pour(fr(326) - fr(170), rr()), -16, "bed")
    for t in [6.3, 7.4, 8.1, 9.6, 10.2]:
        add(t, "gloop", lambda: gloop(rr()), -9)
    for t in np.arange(14.3, 15.6, 0.32):
        add(float(t), "gloop", lambda: gloop(rr()), -8, p=float(rr().uniform(-0.5, 0.5)))
    add(FLASH - 0.25, "flash whoosh", lambda: G.whoosh(0.5, rr(), peak=0.5), -6)
    # hot June
    add(12.15, "thermometer zip", lambda: zip_up(1.25, rr()), -8, p=-0.2)
    for t in np.arange(12.3, 14.2, 0.37):
        add(float(t), "fan flap", lambda: G.whoosh(0.18, rr(), peak=0.3, f_lo=600, f_hi=3000), -16, p=0.2)
    # the Queen's barge: gentle oars, then frantic oars and the bump
    for t in np.arange(15.8, 17.5, 1.1):
        add(float(t), "oar", lambda: oar(rr()), -12)
    for t in np.arange(17.62, 18.0, 0.19):
        add(float(t), "oar fast", lambda: oar(rr(), 1.2), -10)
    add(BUMP, "barge bump", lambda: thud(rr(), 1.3), -3)
    add(BUMP + 0.08, "queen oof", lambda: G.oof(rr(), "oh", base=230, scale=1.25), -9)
    # curtains: drips, the stink sneaking in, a gag
    for t in np.arange(19.3, 23.0, 0.47):
        add(float(t), "drip", lambda: drip(rr()), -14, p=float(rr().uniform(-0.3, 0.3)))
    add(fr(644) - 0.6, "stink swish", lambda: G.whoosh(1.4, rr(), peak=0.5, f_lo=200, f_hi=900), -12, p=0.4)
    add(fr(653), "gag", lambda: G.oof(rr(), "ugh", base=140), -10)
    # lime: sacks hissing, puffs
    add(fr(694), "sack pour", lambda: sack_pour(fr(836) - fr(694), rr()), -15, "bed")
    for t in [23.4, 24.3, 25.6, 26.4, 27.0]:
        add(t, "poof", lambda: poof(rr()), -12, p=float(rr().uniform(-0.5, 0.5)))
    # Disraeli: door bursts, running steps, papers
    add(BURST, "door burst", lambda: G.wood_crack(rr()), -2)
    add(BURST, "door slam", lambda: G.hammer_hit(rr(), 1.2), -4)
    add(BURST + 0.05, "papers", lambda: fades(G.flag_flutter(1.4, rr()), 0.02, 0.4), -12)
    for k, t in enumerate(np.arange(BURST + 0.18, 32.3, 0.29)):
        add(float(t), "run step", lambda: G.stroll_step(rr(), 0.3), -11, p=0.1 if k % 2 else -0.1)
    # Unluckily: gagging lawmakers
    for k, t in enumerate([37.25, 37.7, 38.3, 38.9, 39.5]):
        add(t, "gag", lambda k=k: G.oof(rr(), ["ugh", "oh", "oof"][k % 3], base=float(rr().uniform(110, 160))), -11, p=-0.5 + 0.25 * k)
    # miasma: the cloud's growl, then the innocent whistle on "They didn't"
    add(40.75, "cloud growl", lambda: growl(1.1, rr()), -12)
    add(44.18, "innocent whistle", lambda: innocent_whistle(rr()), -8)
    # pump: squeaks with the handle, water splash, germs giggle (tiny bubbles)
    for t in np.arange(45.3, 47.5, 0.84):
        add(float(t), "pump squeak", lambda: G.swing_squeak(rr(), 0.8), -13)
        add(float(t) + 0.3, "pump gush", lambda: lp(G.bubbles(0.4, rr(), 30), 3000, 1), -15)
    # kitchen: alarm, towel whooshes, fire crackle
    add(fr(1425), "alarm", lambda: alarm_beeps(fr(1531) - fr(1425), rr()), -18, "bed", p=0.2)
    add(fr(1425), "fire", lambda: crackle(fr(1531) - fr(1425), rr()), -20, "bed", p=-0.3)
    for t in np.arange(47.7, 50.8, 0.63):
        add(float(t), "towel swish", lambda: G.whoosh(0.25, rr(), peak=0.4, f_lo=500, f_hi=2600), -12)
    # Parliament moving: cheers
    add(51.15, "cheer", lambda: G.applause(2.4, rr(), 20), -16, "bed")
    for k, t in enumerate([51.2, 51.5, 51.9, 52.3]):
        add(t, "hurrah", lambda: G.hurrah(rr(), float(rr().uniform(120, 170)), 1.0), -12, p=-0.4 + 0.27 * k)
    # office: money sacks land, coins
    for k, t in enumerate(HITS3):
        add(t, "sack thud", lambda: thud(rr(), 1.1), -6, p=-0.2 + 0.2 * k)
        add(t + 0.04, "coins", lambda: np.concatenate([G.clink(rr(), float(rr().uniform(2400, 4200))) for _ in range(3)]), -12, p=-0.2 + 0.2 * k)
    # tunnel: trowels and bricks echoing, the flow later
    for t in np.arange(56.8, 60.0, 0.55):
        add(float(t), "trowel tap", lambda: G.clink(rr(), float(rr().uniform(1600, 2600)), 0.15), -14, p=float(rr().uniform(-0.6, 0.6)), send=0.5)
    add(fr(1948), "sewer flow", lambda: fades(G.water_bed(fr(2006) - fr(1948), rr(), 0.8, 1.2), 0.2, 0.3), -18, "bed", send=0.5)
    # the plan: pencil scribble, the cross-out scratches
    add(60.1, "pencil", lambda: scribble(0.7, rr()), -14)
    add(60.9, "scratch", lambda: scribble(0.35, rr()), -12)
    add(61.25, "scratch", lambda: scribble(0.3, rr()), -12)
    add(61.5, "pencil big", lambda: scribble(0.9, rr()), -13)
    # clean pump: happy kid
    add(67.2, "kid hooray", lambda: G.hurrah(rr(), 260, 1.3, kid=True), -12)
    # today: birds, breeze, a light crowd, the river
    add(68.2, "birds", lambda: G.bird_chirps(DUR - 68.2, rr(), 0.6), -22, "bed")
    add(68.2, "breeze", lambda: fades(G.breeze(DUR - 68.2, rr(), 0.8), 0.6, 0.6), -24, "bed")
    add(68.2, "river today", lambda: fades(G.water_bed(DUR - 68.2, rr(), 0.4), 0.6, 0.6), -24, "bed")
    add(68.2, "crowd", lambda: fades(st(G.babble(DUR - 68.2, rr(), 150, 1.0)), 0.6, 0.6), -26, "bed")
    return C


def sfx(v_ref):
    out = np.zeros((2, N))
    send = np.zeros(N)
    rows = []
    for t, label, gen, naive, kind, p, snd in cues():
        x = np.asarray(gen(), float)
        x = pan(x, p) if x.ndim == 1 else x
        applied = naive + (SFX_DB if kind == "event" else 0.0)
        cur = momentary_max(x) if kind == "event" else integrated(x)
        if np.isfinite(cur):
            x = x * dbg(v_ref + applied - cur)
        place(out, x, t)
        G._place_mono(send, snd * x.mean(0), t)
        rows.append((t, label, kind, applied))
    room = make_ir(0.9, 31, pre=0.01, hf=1.4)
    out += 0.5 * convolve_st(send, room)[:, :N]
    out = hp(out, 30, 2)
    return out, rows


# ================================================================ mix
def load_voice():
    x, sr = read_wav(VOICE)
    assert sr == SR, sr
    v = x[0] if x.shape[0] == 1 else x.mean(0)
    out = np.zeros(N)
    out[: min(N, len(v))] = v[:N]
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
        e += (va[i] - e) * (ka if va[i] > e else kr)
        env[i] = e
    return np.interp(np.arange(N) / SR, np.arange(nc) / ctrl, depth * env)


def limiter(x, ceil_db=CEIL_DBTP, look=0.003, rel=0.08):
    c = dbg(ceil_db)
    up = np.abs(signal.resample_poly(x, 4, 1, axis=-1)).max(0)
    pk = up.reshape(-1, 4).max(1)[: x.shape[1]]
    need = np.minimum(1.0, c / np.maximum(pk, 1e-9))
    need = ndimage.minimum_filter1d(need, ns(look) * 2 + 1)
    g, a = np.ones_like(need), np.exp(-1 / (rel * SR))
    cur = 1.0
    for i in range(len(need)):
        cur = need[i] if need[i] < cur else need[i] + (cur - need[i]) * a
        g[i] = cur
    g = ndimage.uniform_filter1d(g, ns(look))
    return x * g[None, :], g


def main():
    words = json.load(open(WORDS, encoding="utf-8"))
    v = load_voice()
    v_ref = integrated(v)
    print(f"voice {v_ref:.2f} LUFS")
    secs = music()
    duck = dbg(duck_curve(words))[None, :]
    m = np.zeros((2, N))
    levels = []
    for name, a, b, kind in SECTIONS:
        x = secs[name] * duck
        seg = slice(ns(a), ns(min(b, DUR)))
        Lm, Lv = integrated(x[:, seg]), integrated(v[:, seg])
        if not np.isfinite(Lv):
            Lv = v_ref
        g = (Lv + MUSIC_TARGET[name] - Lm) if np.isfinite(Lm) else 0.0
        m += x * dbg(g)
        levels.append((name, a, b, g))
    end = ns(DUR - 0.05)
    m[:, end:] *= np.linspace(1, 0, N - end)[None, :]
    s, rows = sfx(v_ref)
    mix0 = v + m + s
    Gm = TARGET_LUFS - integrated(mix0)
    for it in range(6):
        y, gl = limiter(mix0 * dbg(Gm))
        L = integrated(y)
        if abs(L - TARGET_LUFS) < 0.02:
            break
        Gm += TARGET_LUFS - L
    y = fades(y, 0.0, 0.03)
    print(f"master {integrated(y):.2f} LUFS, TP {true_peak(y):.2f} dBTP, gain {Gm:+.2f} dB")
    write_wav(os.path.join(HERE, "mix.wav"), y)
    for nm, x in [("voice", v), ("music", m), ("sfx", s)]:
        write_wav(os.path.join(HERE, f"stem_{nm}.wav"), x * dbg(Gm))
    with open(os.path.join(HERE, "cues.md"), "w", encoding="utf-8") as f:
        f.write("# The Great Stink: sound cues\n\n")
        f.write(f"Master {integrated(y):.2f} LUFS, true peak {true_peak(y):.2f} dBTP, {DUR:.3f} s, 48 kHz.\n\n")
        f.write("## Music sections (gain applied, dB)\n\n| Section | Start | End | Gain |\n|---|---|---|---|\n")
        for nm, a, b, g in levels:
            f.write(f"| {nm} | {a:.2f} | {b:.2f} | {g:+.1f} |\n")
        f.write("\n## Effects (level vs voice, LU)\n\n| Time | Cue | Kind | Level |\n|---|---|---|---|\n")
        for t, label, kind, applied in sorted(rows):
            f.write(f"| {t:.2f} | {label} | {kind} | {applied:+.1f} |\n")
    print("wrote mix.wav, stems, cues.md")


if __name__ == "__main__":
    main()
