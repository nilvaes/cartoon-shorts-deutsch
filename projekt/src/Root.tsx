import React from "react";
import { Composition } from "remotion";
import { PisaShort, PISA_FRAMES } from "./videos/pisa/Pisa";

// Each short: one folder in src/videos/<name>/ (copied from pisa/) and two compositions here.
// <Name>Short = normal 30 fps preview/render, <Name>ShortMB = 4 sub-frames per frame for motion blur (scripts/fertig_mb.sh).
export const Root: React.FC = () => (
  <>
    <Composition id="PisaShort" component={PisaShort} durationInFrames={PISA_FRAMES} fps={30} width={1080} height={1920} />
    <Composition id="PisaShortMB" component={PisaShort} durationInFrames={PISA_FRAMES * 4} fps={120} width={1080} height={1920} defaultProps={{ sub: 4, shutter: 0.5 }} />
  </>
);
