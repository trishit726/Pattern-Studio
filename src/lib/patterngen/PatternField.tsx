// PatternField — renders a PatternGen placement as animated DOM/SVG, driven by
// useCurrentFrame(). Squares + tiles reveal with a clip-side wipe (staggered by
// each element's seeded animDelay); dots pulse. Deterministic per seed.
import React from "react";
import { useCurrentFrame } from "remotion";
import {
  generatePlacement,
  ANIM_TYPES,
  type TitleRect,
  type ClipSide,
  type AnimType,
  type ColorPair,
} from "./engine";

const DUR = 14; // reveal duration per element

const clamp = (v: number) => Math.max(0, Math.min(1, v));

const clipFor = (side: ClipSide, p: number): string => {
  const r = (1 - p) * 100;
  switch (side) {
    case "left": return `inset(0 ${r}% 0 0)`;
    case "right": return `inset(0 0 0 ${r}%)`;
    case "top": return `inset(0 0 ${r}% 0)`;
    case "bottom": return `inset(${r}% 0 0 0)`;
  }
};

// 16 built-in 40x40 shapes matching the halfof8 selector grid. fg shape, transparent bg.
// Exported so the web app's shape selector shows the same thumbnails.
export const Shape: React.FC<{ anim: AnimType; fg: string }> = ({ anim, fg }) => {
  const f = { fill: fg } as const;
  const dot = (x: number, y: number, r = 3.4) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} {...f} />;
  const S = (children: React.ReactNode) => (
    <svg viewBox="0 0 40 40" width="100%" height="100%">{children}</svg>
  );
  switch (anim) {
    case "arrowUp":
      return S(<path d="M20 5 L34 21 L27 21 L27 35 L13 35 L13 21 L6 21 Z" {...f} />);
    case "capsuleDiag":
      return S(<rect x={8} y={17} width={24} height={7} rx={3.5} transform="rotate(-45 20 20)" {...f} />);
    case "capsuleH":
      return S(<rect x={5} y={16} width={30} height={8} rx={4} {...f} />);
    case "plug":
      return S(<>
        <rect x={5} y={10} width={30} height={7} rx={3.5} {...f} />
        <rect x={5} y={23} width={30} height={7} rx={3.5} {...f} />
      </>);
    case "hBars":
      return S(<>
        <rect x={8} y={6} width={7} height={28} rx={2} {...f} />
        <rect x={25} y={6} width={7} height={28} rx={2} {...f} />
        <rect x={8} y={17} width={24} height={6} {...f} />
      </>);
    case "barsII":
      return S(<>
        <rect x={11} y={7} width={7} height={26} rx={3} {...f} />
        <rect x={22} y={7} width={7} height={26} rx={3} {...f} />
      </>);
    case "circle":
      return S(<circle cx={20} cy={20} r={13} {...f} />);
    case "target":
      return S(<>
        <circle cx={20} cy={20} r={13} fill="none" stroke={fg} strokeWidth={5} />
        <circle cx={20} cy={20} r={4} {...f} />
      </>);
    case "squares4":
      return S(<>
        <rect x={7} y={7} width={10} height={10} {...f} />
        <rect x={23} y={7} width={10} height={10} {...f} />
        <rect x={7} y={23} width={10} height={10} {...f} />
        <rect x={23} y={23} width={10} height={10} {...f} />
      </>);
    case "xCross":
      return S(<>
        <rect x={17} y={4} width={6} height={32} rx={2} transform="rotate(45 20 20)" {...f} />
        <rect x={17} y={4} width={6} height={32} rx={2} transform="rotate(-45 20 20)" {...f} />
      </>);
    case "dotGrid":
      return S([6, 14, 22, 30].map((y) => [6, 14, 22, 30].map((x) => dot(x, y, 2.2))));
    case "dots3":
      return S(<>{dot(10, 12)}{dot(22, 22)}{dot(30, 30)}</>);
    case "dice5":
      return S(<>{dot(10, 10)}{dot(30, 10)}{dot(20, 20)}{dot(10, 30)}{dot(30, 30)}</>);
    case "dice2":
      return S(<>{dot(12, 12, 4)}{dot(28, 28, 4)}</>);
    case "nested":
      return S(<>
        <rect x={6} y={6} width={28} height={28} fill="none" stroke={fg} strokeWidth={4} />
        <rect x={16} y={16} width={8} height={8} {...f} />
      </>);
    case "stripes":
    default:
      return S([2, 14, 26].map((x) => <rect key={x} x={x} y={-6} width={6} height={52} transform={`rotate(20 ${x} 20)`} {...f} />));
  }
};

export const PatternField: React.FC<{
  titles: TitleRect[];
  colors: string[];
  density: number;
  proximity: number;
  seed: number;
  begin?: number;
  stagger?: number; // 0 = all reveal together, 5 = maximally spread
  enabledAnims?: AnimType[];
}> = ({ titles, colors, density, proximity, seed, begin = 0, stagger = 3, enabledAnims = ANIM_TYPES }) => {
  const SPREAD = 6 + stagger * 10; // frames over which elements stagger in
  const frame = useCurrentFrame();
  const place = generatePlacement(titles, colors, density, proximity, seed, enabledAnims);
  const f = frame - begin;

  const prog = (delay: number) => clamp((f - delay * SPREAD) / DUR);

  return (
    <>
      {/* colored squares */}
      {place.squares.map((s) => {
        const p = prog(s.animDelay);
        if (p <= 0) return null;
        return (
          <div
            key={s.id}
            style={{
              position: "absolute",
              left: s.x,
              top: s.y,
              width: s.size,
              height: s.size,
              background: s.color,
              clipPath: clipFor(s.clipSide, p),
              WebkitClipPath: clipFor(s.clipSide, p),
            }}
          />
        );
      })}

      {/* pattern tiles */}
      {place.patterns.map((t: { id: string; anim: AnimType; x: number; y: number; size: number; colors: ColorPair; animDelay: number; clipSide: ClipSide }) => {
        const p = prog(t.animDelay);
        if (p <= 0) return null;
        return (
          <div
            key={t.id}
            style={{
              position: "absolute",
              left: t.x,
              top: t.y,
              width: t.size,
              height: t.size,
              background: t.colors.bg,
              clipPath: clipFor(t.clipSide, p),
              WebkitClipPath: clipFor(t.clipSide, p),
            }}
          >
            <Shape anim={t.anim} fg={t.colors.fg} />
          </div>
        );
      })}

      {/* pulsing dots */}
      {place.dots.map((d) => {
        const appear = clamp((f - d.blinkPhase * SPREAD) / 8);
        if (appear <= 0) return null;
        const blink = 0.5 + 0.5 * Math.sin(frame * d.blinkSpeed + d.blinkPhase * Math.PI * 2);
        return (
          <div
            key={d.id}
            style={{
              position: "absolute",
              left: d.x,
              top: d.y,
              width: 9,
              height: 9,
              borderRadius: 3,
              background: d.color,
              opacity: appear * (0.4 + 0.6 * blink),
            }}
          />
        );
      })}
    </>
  );
};
