# Cartoon-Shorts auf Deutsch 🇩🇪

Mach Cartoon-Shorts mit Claude – komplett auf deinem eigenen PC.
Flache 2D-Figuren in einer bunten 3D-Welt, mit Tusche-Linien, Unschärfe, fliegender Kamera, deutscher Stimme, Untertiteln, Musik und Soundeffekten.

**Kein KI-Videogenerator. Kein Animationsprogramm. Kein Schnittprogramm.** Claude schreibt jedes Bild als Code.

## Was du bekommst

- 📝 **Ideen und Skript auf Deutsch** – wahre Geschichten mit Quellen, Hook im ersten Satz, Pointe am Ende
- 🎙️ **Deine Stimme oder ElevenLabs** – Claude macht sie sauber und misst jedes Wort
- 🎬 **Die Animation** – Welt, Figuren, Kamera und Licht, Bild für Bild auf deine Stimme getimt
- 🎵 **Eigene Musik und Soundeffekte** – direkt im Code erzeugt, keine Lizenzprobleme
- 💬 **Untertitel im Video** – auch lange deutsche Wörter passen auf den Bildschirm
- 📺 **YouTube-fertig** – 1440x2560, richtige Lautstärke, plus `.srt`-Datei
- 🏛️ **Ein komplettes Beispiel**: „Der Turm, den der Krieg rettete“ (Pisa)

## Was du brauchst

- [Claude Code](https://claude.com/claude-code)
- Node.js 22 oder neuer
- Python 3.10 oder neuer
- ffmpeg (Windows: `winget install Gyan.FFmpeg`, Mac: `brew install ffmpeg`)
- Google Chrome
- Eine Grafikkarte hilft beim Rendern, ist aber nicht Pflicht

## Installation

1. Lade dieses Repo herunter (grüner Button **Code → Download ZIP**) und entpacke es.
2. Kopiere den Ordner nach:
   - Windows: `C:\Users\<du>\.claude\skills\cartoon-shorts-deutsch\`
   - Mac: `~/.claude/skills/cartoon-shorts-deutsch/`
3. Öffne Claude Code und sag:

> *„Nutze cartoon-shorts-deutsch und richte das Projekt in meinem Ordner `cartoon-shorts` ein.“*

Claude kopiert das Projekt, installiert alles und rendert ein Testbild.

## So machst du einen Short

> *„Nutze cartoon-shorts-deutsch und mach einen Short über den Hauptmann von Köpenick.“*

oder

> *„Gib mir 10 Ideen für einen Cartoon-Short.“*

Claude schreibt dir das Skript. Wenn es dir gefällt, nimmst du die Stimme auf (oder machst sie mit ElevenLabs) und gibst sie Claude. Der Rest passiert automatisch: Welt, Figuren, Kamera, Ton, Untertitel, fertiges Video.

**Wie lange dauert das?** Ein Short braucht meistens ein paar Stunden – vor allem Rendern. Am besten laufen lassen und zwischendurch die Testbilder anschauen.

## Was ist drin

| Ordner | Inhalt |
|---|---|
| `SKILL.md` | Die Anleitung für Claude: jeder Schritt, jede Regel, jeder Look-Wert |
| `projekt/` | Das fertige Remotion-Projekt zum Kopieren |
| `projekt/src/videos/pisa/` | Das Beispiel: Welt, Figuren, Kamera, Tusche, Unschärfe, Farbe |
| `projekt/audio/` | Musik und Soundeffekte aus Code |
| `projekt/tools/deutsch.py` | Stimme, Wort-Timing, Untertitel, Mix, Prüfblatt |
| `projekt/scripts/` | Testbilder, Motion-Blur-Render, Qualitätskontrolle |
| `projekt/stories/leaning-tower/` | Das Beispiel-Skript mit Quellen (Englisch + Deutsch) |

## Lizenz

MIT – siehe `LICENSE`. Die 3D-Modelle von Kenney sind CC0.
