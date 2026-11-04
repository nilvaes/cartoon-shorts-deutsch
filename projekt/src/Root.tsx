import React from "react";
import { Composition } from "remotion";
import { PisaShort, PISA_FRAMES } from "./videos/pisa/Pisa";
import { TOTAL_DE as PISA_DE_FRAMES } from "./videos/pisa/story";

// Each short: one folder in src/videos/<name>/ (copied from pisa/) and its compositions here.
// <Name>Short = normal 30 fps preview/render, <Name>ShortMB = 4 sub-frames per frame for motion blur (scripts/fertig_mb.sh).
// The Pisa example exists twice: the German edition (DE, timed to voice/leaning-tower-de) and the English original.
export const Root: React.FC = () => (
  <>
    <Composition id="PisaShortDE" component={PisaShort} durationInFrames={PISA_DE_FRAMES} fps={30} width={1080} height={1920} defaultProps={{ lang: "de" as const }} />
    <Composition id="PisaShortDEMB" component={PisaShort} durationInFrames={PISA_DE_FRAMES * 4} fps={120} width={1080} height={1920} defaultProps={{ sub: 4, shutter: 0.5, lang: "de" as const }} />
    <Composition id="PisaShort" component={PisaShort} durationInFrames={PISA_FRAMES} fps={30} width={1080} height={1920} />
    <Composition id="PisaShortMB" component={PisaShort} durationInFrames={PISA_FRAMES * 4} fps={120} width={1080} height={1920} defaultProps={{ sub: 4, shutter: 0.5 }} />
  </>
);
