---
name: cartoon-shorts-deutsch
description: Make a German vertical cartoon short (55-90 s) on your own PC. Flat 2D cartoon characters in a colourful painted 3D world with ink outlines, lens blur and gliding cameras, plus a German voice, captions, synthesized music and sound effects. Rendered with three.js inside Remotion, with no AI video generator. Use when the user wants a cartoon short, an animated history/science short, "so einen Cartoon-Short", or says "nutze cartoon-shorts-deutsch".
---

# Cartoon-Shorts auf Deutsch

The result is a 1440x2560 MP4 at 30 fps, about 55–90 s long. A true, surprising story is told by a German narrator, with burned-in captions and its own music. The worked example is **Pisa** ("Der Turm, den der Krieg rettete"):
- code in `projekt/src/videos/pisa/`, script in `projekt/stories/leaning-tower/`
- German voice in `projekt/voice/leaning-tower-de/`, composition `PisaShortDE` (sound: `ED=de python audio/pisa/pisa_audio.py`)
- the English original is `PisaShort`

## Rules
- **Our own content:** story, script, characters and shots are always new. Never recreate another creator's video, characters or branding. No real living people as characters, and no logos or mascots.
- **German:** the script, the voice and the captions are German. Code comments may stay English.
- **True facts:** every fact used gets a source in `SKRIPT.md`. Legends are clearly called legends.
- **Ask, then build:** show the topic and the script and wait for approval. After that, work without stopping and ask only if something is genuinely unclear.
- **Never upload or publish anything.** The user uploads.
- **Save after every step.** Keep intermediate files; a later fix then only needs its own step again.

## 0. Setup (first time only)
1. Copy `projekt/` from this skill folder to a working folder the user picks (e.g. `~/cartoon-shorts`). All paths below are inside that folder.
2. Run `npm install`. Needs Node 22+. The versions are pinned on purpose (see the gotchas).
3. Python 3.10+: run `python -m venv .venv`, then `pip install -r requirements.txt` inside the venv. Installs faster-whisper, numpy, scipy and Pillow.
4. ffmpeg on the PATH (Windows: `winget install Gyan.FFmpeg`, Mac: `brew install ffmpeg`).
5. Set `REMOTION_TMP` to a folder with space (e.g. `C:/remotion-tmp`). Every Remotion bundle copies `public/` there.
6. Test it: `COMP=PisaShort node scripts/stills.mjs out/test/x_ 300 0.5` should produce an image.

## 1. Topic and facts
- A good topic is **one** true story with a visible cause and effect: something breaks, falls, leans, explodes or gets surprisingly saved. Add a twist at the end and an everyday comparison that explains it.
- If the user has no topic, offer 5–10 ideas. For each: title, hook sentence, twist, the 2–3 big pictures, and whether it's true or a legend.
- Check the key facts with a web search. Write them as a table with sources at the top of `stories/<name>/SKRIPT.md`.

## 2. German script
Write it as German text in its own right, never as a translation. **Length:** about 2.5 words per second, so 60 s ≈ 150 words and 80 s ≈ 200 words.

Structure:
1. **Hook:** the strangest fact in one sentence. No greeting, no lead-in.
2. **Setting:** year, place, who. 1–2 sentences with a concrete detail.
3. **Escalation:** 3–4 beats, each a little bigger. Others doubt or laugh.
4. **The snap:** the moment it tips.
5. **Dry double line:** "Zum Glück … / Zum Pech …".
6. **Explanation:** one idea with an everyday comparison ("Wie eine Matratze aus Memory-Schaum…").
7. **Consequence:** what changed because of it.
8. **Twist:** the last sentence turns everything around. The video ends on the last word.

Style:
- Short main clauses, verbs instead of noun chains, "du" when addressing the viewer.
- **Spell numbers out** ("Neunzehnhundertvierunddreißig").
- Never describe what the viewer can already see.

Save the spoken text in `SKRIPT.md` under `## Sprechtext`. Show it to the user and wait for approval.

## 3. Voice and word timings
- **ElevenLabs:** Multilingual v2, a German voice, speed about 1.05–1.15.
- **Own recording:** WAV 48 kHz mono with 2 s of silence at the start.
- Save it as `voice/<name>/roh.wav` (or .mp3), then:
```
python tools/deutsch.py stimme  voice/<name>/roh.wav voice/<name>/stimme.wav
python tools/deutsch.py woerter voice/<name>/stimme.wav stories/<name>/SKRIPT.md voice/<name>/woerter.json
python tools/deutsch.py pausen  voice/<name>/stimme.wav voice/<name>/woerter.json voice/<name>/voice.wav   # optional
```
- With `pausen`, keep working with `voice.wav` + `voice.json`. Without it, rename `stimme.wav` → `voice.wav` and `woerter.json` → `voice.json`.
- Read every flagged line ("Skript … gehört …", "unsicher"). If the speaker really said something else, fix it. If it's only Whisper's spelling, the timing is fine.
- **Everything is timed to the `f` values (frames at 30 fps) in the json.** Total frames = the end of the last word × 30 + about 20 frames.

## 4. Shot plan (`story.ts`)
1. Copy `src/videos/pisa/` to `src/videos/<name>/`. Rename `Pisa.tsx` / `PisaShort` / `PISA_FRAMES`, and register both compositions (`<Name>Short` and `<Name>ShortMB`) in `src/Root.tsx`, following the Pisa example.
2. Write the plan as a table first: shot, from–to frame, words, place, light, camera, characters, effects, sound cue.
3. Then fill in `story.ts`:
   - `TOTAL`, the place constants
   - `SHOTS` (era/light/frames), `XFADE` (crossfades), `FLASH_AT` (white flash after the hook)
   - `camAt` (camera paths), `kickAt` (impact shakes), `DOF`/`dofAt` (lens blur per beat)
   - `FOREGROUND` (props near the lens), `FOCUS` (what has to stay in frame)
4. **Timing:** every visible reaction lands 0–3 frames *before* its word.

## 5. World (`lights.ts`, `shade.ts`, `build.ts`, `paint.ts`, `world.ts`)
- `lights.ts`: light presets (day / golden) with sun direction, colours and the `LOOK` palette (sky, fog, ground) per era.
- `shade.ts`: two-tone shading.
- `paint.ts`: painted Canvas2D textures (stone, wood, plaster, roof, grass) with dark joints. Write new painters in the same style.
- `build.ts`: buildings and props. Kenney models (CC0, `public/bridge/kenney/`) get recoloured by material name.
- `world.ts`: sky, fog = horizon colour, ground, and per-frame posing. Anything that blocks a camera ray is removed automatically.
- Moving set pieces (collapses, falls, tilts) run off a 0..1 progress value from `story.ts`, eased and staggered.

## 6. Characters (`toon.ts`, `cast.ts`, `cardshade.ts`)
- `toon.ts`: characters are drawn with the `Pen` API on a 600x1000 canvas, soles at y = 975. Bean heads, stick limbs, plum outlines and a set of expressions. Extend outfits, hats and props in the same style.
- `cast.ts`: characters are camera-facing cards with crowds, walk cycles, blinks and effect cards (stars, dust, notes). Cards never get the world ink.
- `cardshade.ts`: cards get the scene light.
- Render a test sheet for every new design before it goes into the short.

## 7. Picture checks
- Stills: `COMP=<Name>Short node scripts/stills.mjs out/<name>/x_ 60,240,500 0.5`. Look at them yourself before showing the user.
- Framing: `node tools/framecheck.mjs src/videos/<name>/story.ts`. Repeat until it says framing OK.
- Camera debugging: `node tools/camdebug.mjs src/videos/<name>/story.ts 120,480 "x,y,z"`.
- Show the user a sheet of stills before the long render.

## 8. Sound (`audio/<name>/<name>_audio.py`)
- Copy `audio/pisa/pisa_audio.py`, set `VOICE`/`WORDS` to `voice/<name>/voice.wav` + `voice.json`, and rewrite the cue table for the new story. The synths in `dsp.py`, `instruments.py`, `sfx_gen.py` and `stink/stink_audio.py` stay as they are.
- **One** theme with 3–4 moods that crossfade over 2 s. About 15 key effects, not more. Quiet: music about 22 LU under the voice, effects 10 dB under their naive level.
- Lock the picture timing **first**. Any timing change means running the sound again.
- Run `python audio/<name>/<name>_audio.py` → `mix.wav` + `stem_music.wav`, `stem_sfx.wav`, `stem_voice.wav`.

## 9. Render and finish
1. Preview without motion blur: `npx remotion render src/index.ts <Name>Short out/<name>/preview.mp4 --scale 0.5 --gl angle`. Check it.
2. Final picture with motion blur, upscaled to 1440x2560: `bash scripts/fertig_mb.sh <Name>ShortMB out/<name>`, which writes `bild.mp4`. Takes about 4× as long.
3. Captions: `python tools/deutsch.py untertitel voice/<name>/voice.json out/<name>/untertitel.ass --video out/<name>/bild.mp4`.
4. Finish: `mix.wav` from the sound script is already finished (voice, music and effects balanced), so `--roh` only sets the final loudness:
```
python tools/deutsch.py fertig out/<name>/bild.mp4 audio/<name>/mix.wav out/<name>/<Titel>.mp4 --roh --untertitel out/<name>/untertitel.ass
```
   Without your own sound script (e.g. a music file only): `fertig bild.mp4 voice.wav … --woerter voice.json --bett musik.wav`. The music then dips automatically under the voice.
5. YouTube CC file: `python tools/deutsch.py untertitel voice/<name>/voice.json out/<name>/untertitel.srt`.

## Re-voicing a finished short (other voice or language)
When a short is already animated and gets a new voice, don't rebuild it. Use a **time map**, as in the Pisa example (`WARP_DE` in `story.ts`):
1. `deutsch.py stimme` + `woerter` for the new voice. Put 0.5 s of silence in front (`ffmpeg -af adelay=500`) and add 0.5 s to the word times.
2. Pairs `[old frame, new frame]`: every sentence start, plus the words the picture reacts to (impacts, props, punchlines). Both columns must rise strictly.
3. In `story.ts`: `TOTAL_DE`, `WARP_DE`, `de2en`/`en2de`. In the main component: `f = lang === "de" ? de2en(fo) : fo`. In `Root.tsx`: two compositions with `lang: "de"`.
4. Sound: under `ED=de`, the sound script reads the same map and runs every cue time through it. Write every time value as `fr(frame)`, never as plain seconds.
5. Check: stills at matching frames (old/new) must be identical.

## 10. Final check
- `python tools/deutsch.py pruefen out/<name>/<Titel>.mp4 out/<name>/blatt.jpg`: does a caption cover a face? Fix it with `untertitel --move t0-t1:y`.
- `python scripts/short_qa.py out/<name>/<Titel>.mp4 out/<name>/qa`: catches black, white and frozen frames, and checks loudness.
- Tell the user: the length, the loudness, what each shot shows, and anything still open.

## Look values (the Pisa look, start from these)
- **Camera:**
  - Continuous glides along Catmull-Rom paths through key framings, never completely still.
  - Hard cuts only for big jumps, with a whip or an 8-frame crossfade between places or eras, and a white flash after the hook.
  - Impact shakes flip sign every frame and decay over 7 frames. Rolls of 3–5° on drama.
- **Motion blur:** the MB composition renders 4 sub-frames per frame (shutter 0.5), and `fertig_mb.sh` blends them.
- **Lens blur:** on close-ups and medium shots (`DOF`), focused on the eyes. Wide shots stay sharp.
- **Light:** day for normal, golden hour for drama and decline. Shadows are violet-blue, never brown. Fog = horizon colour.
- **Picture:** vignette, slightly desaturated (saturate 0.9, contrast 0.96). Light beams, dust and glowing fire are allowed. Dense props and crowds.
- **Characters:** about 3.5 head-heights tall, bean head, plum outlines, blinks every 0.5–2.3 s. Walks have 3–7 % bob and planted feet.

## Gotchas
- **Versions:** React 18 / @react-three/fiber 8 / @react-three/postprocessing 2 / Remotion 4.0.536. With React 19 + fiber 9 every frame renders blank. Never upgrade.
- **Windows renders:** `--gl angle` (and `--browser-executable` pointing at Chrome if needed). `stills.mjs` finds Chrome on its own.
- **Exact 2K scale:** if you render with `--scale` instead of `fertig_mb.sh`, use `--scale 1.3333333333333333`. Shorter values give odd heights and Remotion refuses them.
- **Temp folder:** `REMOTION_TMP` fills up. When nothing is rendering, delete `remotion-webpack-bundle-*` and `puppeteer_dev_chrome_profile-*` there.
- **JS strings:** write paths with `/`, never `\` (`\r` turns into a carriage return).
- **Silent Remotion track:** Remotion writes a silent audio track. `deutsch.py fertig` uses only the video track from it.
- **Ink:** the ink pass has to run as its own pass *before* the lens blur, otherwise the blur overwrites it.
- **No film grain:** it quadruples the file size and turns to mush on YouTube.
- **Readability traps:**
  - A swing with one rope looks like a hanging: always use two ropes.
  - Props closer than 2 m to the lens become huge blobs.
  - A bush cut by the frame edge reads as a green ball.
  - Flags have to fit the period.
  - Signs facing the sun turn grey: give them an unlit material.
  - Rim light only on the inside edge.
  - Railings should cross legs, not faces (lens about 2.5 m up).
  - Every hold needs a slow push-in, otherwise QA reads it as a freeze.
