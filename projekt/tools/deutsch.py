"""Shorts auf Deutsch: German voice, word timings, captions and the final mix for any short.

    python deutsch.py stimme     roh.wav stimme.wav                   clean + level the narration
    python deutsch.py woerter    stimme.wav skript.md woerter.json    word timings matched to the script
    python deutsch.py pausen     stimme.wav woerter.json kurz.wav     shorten long pauses (writes kurz.json too)
    python deutsch.py untertitel woerter.json untertitel.ass          burned-in captions (.srt = YouTube CC file)
    python deutsch.py fertig     bild.mp4 stimme.wav final.mp4 --woerter woerter.json --bett musik.wav --untertitel untertitel.ass
    python deutsch.py pruefen    final.mp4 blatt.jpg                  contact sheet to check the captions

Needs ffmpeg on PATH (or FFMPEG=...), plus: pip install -r requirements.txt
"""
import argparse, glob, json, os, re, shutil, subprocess, sys, tempfile

# ---------------------------------------------------------------- ffmpeg

def tool(name):
    env = os.environ.get(name.upper())
    if env: return env
    found = shutil.which(name)
    if found: return found
    # winget installs ffmpeg without linking it onto PATH
    hits = glob.glob(os.path.expandvars(
        rf"%LOCALAPPDATA%\Microsoft\WinGet\Packages\*FFmpeg*\*\bin\{name}.exe"))
    if hits: return hits[0]
    sys.exit(f"{name} not found: install ffmpeg or set {name.upper()}=path")


def run(args, cwd=None):
    r = subprocess.run([tool("ffmpeg"), "-hide_banner", "-v", "error", "-y"] + args, cwd=cwd,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode: sys.exit("ffmpeg failed:\n" + r.stderr[-3000:])
    return r


def dauer(path):
    r = subprocess.run([tool("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return float(r.stdout.strip())


def groesse(path):
    r = subprocess.run([tool("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height", "-of", "csv=p=0", path], capture_output=True, text=True)
    w, h = r.stdout.strip().split(",")[:2]
    return int(w), int(h)


def lautheit(path):
    """Integrated loudness in LUFS (EBU R128)."""
    r = subprocess.run([tool("ffmpeg"), "-hide_banner", "-nostats", "-i", path, "-af", "loudnorm=print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return float(json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1])["input_i"])

# ---------------------------------------------------------------- German text

EINER = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf",
         "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"]
ZEHNER = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"]


def _bis100(n):
    if n < 20: return EINER[n]
    z, e = divmod(n, 10)
    return ZEHNER[z] if e == 0 else ("ein" if e == 1 else EINER[e]) + "und" + ZEHNER[z]


def _bis1000(n):
    h, r = divmod(n, 100)
    return ((("ein" if h == 1 else EINER[h]) + "hundert") if h else "") + (_bis100(r) if r or not h else "")


def zahl(n):
    """1906 -> neunzehnhundertsechs (years read the German way), 2014 -> zweitausendvierzehn"""
    if 1100 <= n <= 1999:
        return _bis100(n // 100) + "hundert" + (_bis100(n % 100) if n % 100 else "")
    if n < 1000: return _bis1000(n)
    if n < 1_000_000:
        t, r = divmod(n, 1000)
        return ("ein" if t == 1 else _bis1000(t)) + "tausend" + (_bis1000(r) if r else "")
    return str(n)


def norm(t):
    """Compare form: lower case, ß=ss, digits spelled out, no punctuation or hyphens."""
    t = re.sub(r"\d+", lambda m: zahl(int(m.group())), t.casefold())
    return re.sub(r"[^\w]", "", t.replace("ß", "ss")).replace("_", "")


def skript_text(path):
    """Spoken text from a .txt, or from the narration section of a .md (headings, lists, tables and notes skipped)."""
    txt = open(path, encoding="utf-8").read()
    if not path.lower().endswith(".md"): return txt
    teile = re.split(r"^#+ .*$", txt, flags=re.M)
    titel = re.findall(r"^#+ (.*)$", txt, flags=re.M)
    for name, teil in zip(titel, teile[1:]):
        if re.search(r"narration|sprechtext|voice|stimme|skript|text", name, re.I):
            txt = teil; break
    zeilen = [z for z in txt.splitlines() if z.strip() and not re.match(r"\s*([-*|>#]|```|\d+\.)", z)]
    return "\n".join(zeilen)

# ---------------------------------------------------------------- stimme

def cmd_stimme(a):
    # trim the silence before the first word, cut rumble, gentle compression, level to -20 LUFS, 48 kHz mono 16-bit
    kette = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,"
             "highpass=f=75,lowpass=f=16000,"
             "acompressor=threshold=-20dB:ratio=3:attack=5:release=80:makeup=2")
    with tempfile.TemporaryDirectory() as tmp:
        zw = os.path.join(tmp, "zw.wav")
        run(["-i", a.roh, "-af", kette, "-ac", "1", "-ar", "48000", zw])
        gain = a.lufs - lautheit(zw)
        run(["-i", zw, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89:level=false", "-c:a", "pcm_s16le", a.aus])
    print(f"{a.aus}: {dauer(a.aus):.2f} s, {lautheit(a.aus):.1f} LUFS")

# ---------------------------------------------------------------- woerter

def transkribieren(wav, modell):
    from faster_whisper import WhisperModel
    try:
        m = WhisperModel(modell, device="cuda", compute_type="float16")
        segs, _ = m.transcribe(wav, language="de", word_timestamps=True, beam_size=5)
        segs = list(segs)
    except Exception as e:  # no NVIDIA GPU / CUDA: CPU works, just slower
        print("GPU not available, using CPU:", str(e)[:120])
        m = WhisperModel(modell, device="cpu", compute_type="int8")
        segs, _ = m.transcribe(wav, language="de", word_timestamps=True, beam_size=5)
    return [{"w": w.word.strip(), "s": w.start, "e": w.end, "p": w.probability} for s in segs for w in s.words]


def cmd_woerter(a):
    import difflib
    gehoert = transkribieren(a.stimme, a.modell)
    skript = [w for w in skript_text(a.skript).split() if norm(w)]
    sm = difflib.SequenceMatcher(a=[norm(w) for w in skript], b=[norm(w["w"]) for w in gehoert], autojunk=False)
    aus, hinweise = [], []
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op == "equal":
            for i, j in zip(range(a0, a1), range(b0, b1)):
                g = gehoert[j]
                aus.append({"w": skript[i], "s": g["s"], "e": g["e"]})
                if g["p"] < 0.5: hinweise.append(f"unsicher ({g['p']:.2f}) bei {g['s']:.2f}s: {skript[i]}")
            continue
        sw, gw = skript[a0:a1], [g["w"] for g in gehoert[b0:b1]]
        if sw: hinweise.append(f"{gehoert[b0]['s'] if b1 > b0 else (aus[-1]['e'] if aus else 0):.2f}s  Skript {sw}  gehört {gw}")
        if not sw: continue
        if b1 > b0: s, e = gehoert[b0]["s"], gehoert[b1 - 1]["e"]   # spread the heard span over the script words
        else: s = e = aus[-1]["e"] if aus else 0.0                       # not heard at all: flagged above
        for k, w in enumerate(sw):
            aus.append({"w": w, "s": s + (e - s) * k / len(sw), "e": s + (e - s) * (k + 1) / len(sw)})
    for w in aus:
        w["s"], w["e"] = round(w["s"], 3), round(w["e"], 3)
        w["f"] = round(w["s"] * a.fps)
    json.dump(aus, open(a.aus, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{a.aus}: {len(aus)} Wörter, Ende {aus[-1]['e']:.2f}s")
    print("\n".join(hinweise) if hinweise else "Skript und Stimme passen Wort für Wort.")

# ---------------------------------------------------------------- pausen

def cmd_pausen(a):
    import numpy as np
    from scipy.io import wavfile
    sr, x = wavfile.read(a.stimme)
    W = json.load(open(a.woerter, encoding="utf-8"))
    teile, cur, weg, schnitte = [], 0.0, 0.0, []
    for i in range(len(W) - 1):
        gap = W[i + 1]["s"] - W[i]["e"]
        soll = a.satz if W[i]["w"][-1] in ".!?" else a.max
        if gap > soll + 0.05:
            c0 = W[i]["e"] + 0.08                 # keep the word's natural tail
            c1 = c0 + gap - soll
            teile.append(x[int(cur * sr):int(c0 * sr)])
            schnitte.append((c1, c1 - c0)); cur = c1
    teile.append(x[int(cur * sr):])
    wavfile.write(a.aus, sr, np.concatenate(teile))
    for w in W:                                    # shift every word by what was cut before it
        d = sum(n for t, n in schnitte if t <= w["s"] + 1e-6)
        w["s"], w["e"] = round(w["s"] - d, 3), round(w["e"] - d, 3)
        if "f" in w: w["f"] = round(w["s"] * a.fps)
    wj = os.path.splitext(a.aus)[0] + ".json"
    json.dump(W, open(wj, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(x) / sr:.2f}s -> {sum(len(t) for t in teile) / sr:.2f}s, {len(schnitte)} Pausen gekürzt -> {a.aus}, {wj}")

# ---------------------------------------------------------------- untertitel

SCHRIFTEN = {  # (font family for libass, font files to measure with, first one found wins)
    "rick": ("Segoe UI Black", ["C:/Windows/Fonts/seguibl.ttf"]),
    "rick-mac": ("Arial Black", ["/System/Library/Fonts/Supplemental/Arial Black.ttf", "/Library/Fonts/Arial Black.ttf",
                                 "C:/Windows/Fonts/ariblk.ttf"]),
    "klassisch": ("Impact", ["C:/Windows/Fonts/impact.ttf", "/System/Library/Fonts/Supplemental/Impact.ttf",
                             "/Library/Fonts/Impact.ttf"]),
    "linux": ("DejaVu Sans", ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]),
}


def schrift(stil):
    for key in ([stil] if stil == "klassisch" else []) + ["rick", "rick-mac", "linux"]:
        fam, dateien = SCHRIFTEN[key]
        for d in dateien:
            if os.path.exists(d): return fam, d
    sys.exit("No caption font found (Segoe UI Black, Arial Black, Impact or DejaVu Sans).")


def ts(t):
    cs = int(round(max(0.0, t) * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def srt_datei(W, aus, max_zeichen=42):
    gruppen, cur = [], []
    for w in W:
        if cur and (len(" ".join(x["w"] for x in cur + [w])) > max_zeichen or w["s"] - cur[-1]["e"] > 0.6):
            gruppen.append(cur); cur = []
        cur.append(w)
        if w["w"][-1] in ".!?": gruppen.append(cur); cur = []
    if cur: gruppen.append(cur)
    t = lambda s: ts(s).replace(".", ",").rjust(11, "0") + "0"
    with open(aus, "w", encoding="utf-8") as f:
        for k, g in enumerate(gruppen):
            ende = g[-1]["e"] + 0.4
            if k + 1 < len(gruppen): ende = min(ende, gruppen[k + 1][0]["s"])
            f.write(f"{k + 1}\n{t(g[0]['s'])} --> {t(ende)}\n{' '.join(x['w'] for x in g)}\n\n")
    print(f"{aus}: {len(gruppen)} Untertitel (für YouTube hochladen)")


def cmd_untertitel(a):
    from PIL import ImageFont
    W = [w for w in json.load(open(a.woerter, encoding="utf-8")) if w["w"].strip()]
    if a.aus.lower().endswith(".srt"): return srt_datei(W, a.aus)
    B, H = groesse(a.video) if a.video else (a.breite, a.hoehe)
    k = H / 2560                                   # every size below is tuned for 1440x2560 and scaled from there
    klassisch = a.stil == "klassisch"
    fam, datei = schrift(a.stil)
    size = round((160 if klassisch else 118) * k)
    font = ImageFont.truetype(datei, size)
    max_w = 1120 * B / 1440                        # keep clear of the Shorts buttons on the right
    max_woerter = 3 if klassisch else 2
    y = round((a.y if a.y else 1800) * k)

    def zeig(w):
        w = w.strip(".,:;„“\"»«")
        return w.upper() if klassisch else w     # "ß".upper() == "SS", the normal German caps spelling

    breite = lambda ws: font.getlength(" ".join(zeig(x["w"]) for x in ws))
    gruppen, cur = [], []
    for w in W:
        if cur and (len(cur) >= max_woerter or breite(cur + [w]) > max_w or w["s"] - cur[-1]["e"] > 0.28):
            gruppen.append(cur); cur = []
        cur.append(w)
        if w["w"][-1] in ".,:;!?": gruppen.append(cur); cur = []
    if cur: gruppen.append(cur)

    moves = []
    for m in a.move:
        zeit, hoehe = m.split(":"); t0, t1 = zeit.split("-")
        moves.append((float(t0), float(t1), round(int(hoehe) * k)))
    y_bei = lambda t: next((yy for t0, t1, yy in moves if t0 <= t < t1), y)
    esc = lambda s: s.replace("\\", "\\\\").replace("{", "(").replace("}", ")")
    WEISS, GELB = "&H00FFFFFF", "&H004AE1FF"

    zeilen = []
    for n, g in enumerate(gruppen):
        ende = g[-1]["e"] + 0.35
        if n + 1 < len(gruppen): ende = min(ende, gruppen[n + 1][0]["s"])
        # long German compounds ("Hauptmannsuniform"): shrink the chunk to fit instead of overflowing
        sc = min(100, int(100 * max_w / max(1, breite(g))))
        for j, w in enumerate(g):
            t0 = w["s"]; t1 = g[j + 1]["s"] if j + 1 < len(g) else ende
            if t1 <= t0: continue
            txt = " ".join(("{\\c%s}%s{\\c%s}" % (GELB, esc(zeig(x["w"])), WEISS)) if i == j and klassisch
                           else esc(zeig(x["w"])) for i, x in enumerate(g))
            pop = (f"{{\\fscx{sc * 86 // 100}\\fscy{sc * 86 // 100}\\t(0,90,\\fscx{sc}\\fscy{sc})}}" if j == 0
                   else f"{{\\fscx{sc}\\fscy{sc}}}")
            zeilen.append(f"Dialogue: 0,{ts(t0)},{ts(t1)},Cap,,0,0,0,,{{\\pos({B // 2},{y_bei(g[0]['s'])})}}{pop}{txt}")
    kopf = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {B}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{fam},{size},{WEISS},{WEISS},&H0020141C,&H78000000,0,0,0,0,100,100,{round((2 if klassisch else 1) * k)},0,1,{round((10 if klassisch else 9) * k)},{round((7 if klassisch else 4) * k)},5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    open(a.aus, "w", encoding="utf-8").write(kopf + "\n".join(zeilen) + "\n")
    print(f"{a.aus}: {len(gruppen)} Einblendungen, Schrift {fam}, {B}x{H}")

# ---------------------------------------------------------------- fertig

def duck_ausdruck(W, duck_db):
    """ffmpeg volume expression: the bed sinks by duck_db while someone speaks, with soft 0.15 s / 0.3 s ramps."""
    stellen = []
    for w in W:
        if stellen and w["s"] - stellen[-1][1] < 0.5: stellen[-1][1] = w["e"]
        else: stellen.append([w["s"], w["e"]])
    g = 10 ** (-duck_db / 20)
    d = "0"
    for s, e in stellen:
        d = f"max({d},min(clip((t-{s - 0.15:.2f})/0.15,0,1),clip(({e + 0.3:.2f}-t)/0.3,0,1)))"
    return f"1-{1 - g:.4f}*{d}"


def cmd_fertig(a):
    tv, ta = dauer(a.bild), dauer(a.stimme)
    lang = max(tv, ta)
    print(f"Bild {tv:.2f}s, Stimme {ta:.2f}s" + (f"  -> letztes Bild wird {ta - tv:.2f}s gehalten" if ta > tv + 0.05 else ""))
    W = json.load(open(a.woerter, encoding="utf-8")) if a.woerter else None
    with tempfile.TemporaryDirectory() as tmp:
        # voice: level to -20 LUFS (no-op after `stimme`), centred in stereo; --roh keeps a finished mix untouched
        ins = ["-i", os.path.abspath(a.stimme)]
        stimme = "aformat=channel_layouts=stereo" if a.roh else f"volume={-20 - lautheit(a.stimme):.2f}dB,pan=stereo|c0=c0|c1=c0"
        fk = [f"[0:a]aresample=48000,{stimme},apad=whole_dur={lang:.3f}[v]"]
        if a.bett or a.bett_aus_video:
            quellen = [os.path.abspath(b) for b in a.bett] + ([os.path.abspath(a.bild)] if a.bett_aus_video else [])
            bett = os.path.join(tmp, "bett.wav")
            m = "".join(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo[b{i}];" for i in range(len(quellen)))
            m += "".join(f"[b{i}]" for i in range(len(quellen))) + f"amix=inputs={len(quellen)}:normalize=0:duration=longest[o]"
            run([x for q in quellen for x in ("-i", q)] + ["-filter_complex", m, "-map", "[o]", bett])
            gain = a.bett_lufs - lautheit(bett)
            duck = (f",volume='{duck_ausdruck(W, a.duck)}':eval=frame" if W else "")
            ins = ["-i", os.path.abspath(a.stimme), "-i", bett]
            fk.append(f"[1:a]volume={gain:.2f}dB{duck},apad=whole_dur={lang:.3f}[b]")
            fk.append("[v][b]amix=inputs=2:normalize=0:duration=longest[m]")
        else:
            fk.append("[v]anull[m]")
        mix = os.path.join(tmp, "mix.wav")
        run(ins + ["-filter_complex", ";".join(fk), "-map", "[m]", "-t", f"{lang:.3f}", "-c:a", "pcm_s24le", mix])
        # final loudness for YouTube: -14 LUFS, peaks under -1.5 dBTP
        gain = a.lufs - lautheit(mix)
        mix2 = os.path.join(tmp, "mix2.wav")
        run(["-i", mix, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.84:level=false", "-c:a", "pcm_s24le", mix2])

        vf = []
        if ta > tv + 0.05: vf.append(f"tpad=stop_mode=clone:stop_duration={ta - tv + 0.1:.2f}")
        if a.untertitel:
            shutil.copy(a.untertitel, os.path.join(tmp, "cap.ass"))   # relative name: no Windows path escaping in -vf
            vf.append("ass=cap.ass")
        video = (["-vf", ",".join(vf), "-c:v", "libx264", "-crf", str(a.crf), "-preset", "slow", "-pix_fmt", "yuv420p"]
                 if vf else ["-c:v", "copy"])
        run(["-i", os.path.abspath(a.bild), "-i", mix2, "-map", "0:v:0", "-map", "1:a:0"] + video +
            ["-c:a", "aac", "-b:a", "256k", "-t", f"{lang:.3f}", "-movflags", "+faststart", os.path.abspath(a.aus)], cwd=tmp)
    print(f"{a.aus}: {dauer(a.aus):.2f}s, {lautheit(a.aus):.1f} LUFS")

# ---------------------------------------------------------------- pruefen

def cmd_pruefen(a):
    d = dauer(a.video)
    sp = 6 if a.n >= 12 else a.n
    run(["-i", a.video, "-vf", f"fps={a.n / d:.5f},scale=300:-1,tile={sp}x{-(-a.n // sp)}:padding=6:color=white",
         "-frames:v", "1", "-q:v", "3", a.aus])
    print(f"{a.aus}: {a.n} Bilder aus {d:.1f}s – Untertitel über Gesichtern? Dann untertitel --move t0-t1:y")

# ---------------------------------------------------------------- cli

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("stimme", help="clean + level the narration"); p.add_argument("roh"); p.add_argument("aus")
    p.add_argument("--lufs", type=float, default=-20)
    p = sub.add_parser("woerter", help="word timings matched to the script"); p.add_argument("stimme")
    p.add_argument("skript"); p.add_argument("aus"); p.add_argument("--modell", default="large-v3")
    p.add_argument("--fps", type=float, default=30)
    p = sub.add_parser("pausen", help="shorten long pauses"); p.add_argument("stimme"); p.add_argument("woerter")
    p.add_argument("aus"); p.add_argument("--max", type=float, default=0.30, help="longest pause inside a sentence")
    p.add_argument("--satz", type=float, default=0.45, help="longest pause after . ! ?")
    p.add_argument("--fps", type=float, default=30)
    p = sub.add_parser("untertitel", help="captions: .ass to burn in, .srt for YouTube"); p.add_argument("woerter")
    p.add_argument("aus"); p.add_argument("--stil", choices=["rick", "klassisch"], default="rick")
    p.add_argument("--video", help="read the size from the video"); p.add_argument("--breite", type=int, default=1440)
    p.add_argument("--hoehe", type=int, default=2560); p.add_argument("--y", type=int, help="caption centre at 2560 high (1800)")
    p.add_argument("--move", action="append", default=[], help="t0-t1:y  other height while a face is there")
    p = sub.add_parser("fertig", help="mix + captions + final file"); p.add_argument("bild"); p.add_argument("stimme")
    p.add_argument("aus"); p.add_argument("--woerter", help="words.json: the music dips exactly while you speak")
    p.add_argument("--bett", action="append", default=[], help="music/SFX file (repeatable)")
    p.add_argument("--bett-aus-video", action="store_true", help="use the video's own sound as the bed")
    p.add_argument("--bett-lufs", type=float, default=-34, help="music level (voice is -20)")
    p.add_argument("--duck", type=float, default=8, help="dB the music sinks while you speak")
    p.add_argument("--roh", action="store_true", help="the audio is already a finished mix: only set the final loudness")
    p.add_argument("--untertitel"); p.add_argument("--lufs", type=float, default=-14); p.add_argument("--crf", type=int, default=16)
    p = sub.add_parser("pruefen", help="contact sheet"); p.add_argument("video"); p.add_argument("aus")
    p.add_argument("--n", type=int, default=12)
    a = ap.parse_args()
    globals()["cmd_" + a.cmd](a)


if __name__ == "__main__":
    main()
