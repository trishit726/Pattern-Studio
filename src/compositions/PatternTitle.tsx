// PatternTitle — the core graphic: one or more text blocks with a procedural
// generator scattering animated shapes/squares/dots around them. Titles are an
// array (main block / sub-label / optional vertical CJK), each positioned by
// (x,y). Uses the ported PatternGen engine (see src/lib/patterngen, MIT — credit
// in NOTICE.md). Fully parameterized → drives the web app + AI scene generation.
import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadJP } from "@remotion/google-fonts/ShipporiMincho";
import { PatternField } from "../lib/patterngen/PatternField";
import { GrainOverlay, PaintedImage } from "../lib/textures";
import type { TitleRect, AnimType } from "../lib/patterngen/engine";

const resolveSrc = (s: string) => (/^(https?:|blob:|data:)/.test(s) ? s : staticFile(s));
const { fontFamily: ANTON } = loadAnton("normal", { weights: ["400"], subsets: ["latin"] });
const { fontFamily: JP } = loadJP("normal", { weights: ["500"], subsets: ["japanese", "latin"] });

const titleSchema = z.object({
  id: z.string(),
  kind: z.enum(["block", "label", "jp"]),
  text: z.string(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  size: z.number().min(8).max(400),
});
export type TitleItem = z.infer<typeof titleSchema>;

export const patternTitleSchema = z.object({
  titles: z.array(titleSchema),
  seed: z.number().int(),
  density: z.number().min(1).max(20),
  proximity: z.number().min(1).max(20),
  accent: zColor(),
  bgColor: zColor(),
  bgImage: z.string(),
  stagger: z.number().min(0).max(5),
  shapes: z.array(z.string()),
  paint: z.number().min(0).max(120),
  colors: z.array(z.string()), // palette that feeds the patterns/squares/dots
  showGrid: z.boolean(),
  music: z.string().optional(), // public/ path for a lo-fi bed, e.g. "music/lofi.mp3"
  sfx: z.boolean().optional(), // play a slap SFX on each title reveal
});
export type PatternTitleProps = z.infer<typeof patternTitleSchema>;

export const patternTitleDefaults: PatternTitleProps = {
  titles: [
    { id: "t1", kind: "block", text: "PATTERN\nSTUDIO", x: 0.36, y: 0.46, size: 130 },
    { id: "t2", kind: "label", text: "MOTION, FROM A PROMPT", x: 0.36, y: 0.61, size: 30 },
  ],
  seed: 7,
  density: 11,
  proximity: 12,
  accent: "#f74026",
  bgColor: "#2b2b2b",
  bgImage: "",
  stagger: 3,
  shapes: ["arrowUp", "capsuleDiag", "capsuleH", "plug", "hBars", "barsII", "circle", "target", "squares4", "xCross", "dotGrid", "dots3", "dice5", "dice2", "nested", "stripes"],
  paint: 50,
  colors: ["#6fa5a9", "#93ab5a", "#cf9f4a", "#e0573a", "#000000", "#ffffff"],
  showGrid: false,
  music: "",
  sfx: false,
};

// Approximate the bounding box of a title so the engine keeps patterns clear of it.
const rectOf = (t: TitleItem): TitleRect => {
  const cx = t.x * 1920, cy = t.y * 1080;
  if (t.kind === "jp") {
    const w = t.size * 1.6, h = t.text.length * t.size * 1.1 + 20;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  const lines = t.text.split("\n");
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const w = longest * t.size * 0.62 + 40, h = lines.length * t.size * 1.02 + 24;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
};

const TitleBlock: React.FC<{ t: TitleItem; accent: string; clip: string }> = ({ t, accent, clip }) => {
  const base: React.CSSProperties = {
    position: "absolute",
    left: `${t.x * 100}%`,
    top: `${t.y * 100}%`,
    transform: "translate(-50%, -50%)",
    clipPath: clip,
    WebkitClipPath: clip,
  };
  if (t.kind === "jp") {
    return (
      <div style={base}>
        <span style={{ display: "inline-block", background: accent, color: "#111", fontFamily: JP, fontSize: t.size, fontWeight: 500, writingMode: "vertical-rl", letterSpacing: 4, padding: "16px 8px" }}>
          {t.text}
        </span>
      </div>
    );
  }
  if (t.kind === "label") {
    return (
      <div style={base}>
        <span style={{ display: "inline-block", background: "#111", color: "#fff", fontFamily: ANTON, fontSize: t.size, letterSpacing: 2, textTransform: "uppercase", padding: "5px 14px 8px" }}>
          {t.text}
        </span>
      </div>
    );
  }
  return (
    <div style={{ ...base, textAlign: "center" }}>
      <span style={{ display: "inline-block", background: accent, color: "#111", fontFamily: ANTON, fontSize: t.size, lineHeight: 0.96, letterSpacing: 1, textTransform: "uppercase", padding: "8px 26px 16px" }}>
        {t.text.split("\n").map((l, i) => (
          <React.Fragment key={i}>{l}{i < t.text.split("\n").length - 1 && <br />}</React.Fragment>
        ))}
      </span>
    </div>
  );
};

export const PatternTitle: React.FC<PatternTitleProps> = ({
  titles, seed, density, proximity, accent, bgColor, bgImage, stagger, shapes, paint, colors, showGrid, music, sfx,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: bgColor, overflow: "hidden" }}>
      {/* Lo-fi music bed (optional). Track plays from the top; comp is short so no loop needed. */}
      {music ? <Audio src={resolveSrc(music)} volume={0.4} /> : null}

      {/* Slap SFX on each title reveal (optional) — whoosh for blocks, click for the rest. */}
      {sfx
        ? titles.map((t, i) => (
            <Sequence key={`sfx-${t.id}`} from={8 + i * 4}>
              <Audio src={staticFile(t.kind === "block" ? "sfx/whoosh.wav" : "sfx/click.wav")} volume={0.5} />
            </Sequence>
          ))
        : null}

      {bgImage ? <PaintedImage src={resolveSrc(bgImage)} name="pt" strength={paint} /> : null}

      {/* optional 20px alignment grid (patterngen "GRID ON") */}
      {showGrid ? (
        <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.07, backgroundImage: "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
      ) : null}

      <PatternField
        titles={titles.map(rectOf)}
        colors={colors.length ? colors : [accent]}
        density={density}
        proximity={proximity}
        seed={seed}
        begin={4}
        stagger={stagger}
        enabledAnims={shapes as AnimType[]}
      />

      <AbsoluteFill>
        {titles.map((t, i) => {
          const wipe = spring({ frame: frame - (8 + i * 4), fps, config: { damping: 200 } });
          return <TitleBlock key={t.id} t={t} accent={accent} clip={`inset(0 ${(1 - wipe) * 100}% 0 0)`} />;
        })}
      </AbsoluteFill>

      <GrainOverlay name="pattern" intensity={0.1} vignette dark />
    </AbsoluteFill>
  );
};
