# Motion Graphics (Remotion + TypeScript)

A clean, neutral starting point for designing animated graphics in code and
exporting them into any video editor. The visual design is intentionally plain —
it's a foundation to take in your own direction, not a finished style.

Built with [Remotion](https://www.remotion.dev) `4.0.481`.

---

## Quick start

```bash
npm install        # already done if you're reading this
npm run studio     # open the live preview at http://localhost:3000
```

In **Remotion Studio** you can scrub the timeline, and edit every prop live in
the right-hand panel (text, colors, etc.) thanks to the zod schemas.

> If port 3000 is busy, run `npx remotion studio --port=3999`.

---

## Project structure

```
remotion/
├─ src/
│  ├─ index.ts            # entry — registers the root (don't edit)
│  ├─ Root.tsx            # ← register every composition here
│  ├─ config.ts           # ← shared canvas: resolution + fps in ONE place
│  ├─ lib/
│  │  ├─ animation.ts     # enter/exit envelope + easing helpers
│  │  └─ fonts.ts         # Google font loader (Inter by default)
│  └─ compositions/       # one file per graphic
│     ├─ TitleCard.tsx
│     ├─ LowerThird.tsx
│     ├─ KineticText.tsx
│     └─ TransparentOverlay.tsx
├─ public/                # fonts, images, audio (via staticFile())
├─ out/                   # rendered output
├─ remotion.config.ts     # Studio render defaults
└─ package.json
```

---

## Changing resolution / frame rate

Everything reads from [`src/config.ts`](src/config.ts). Change it once:

```ts
export const FPS = 60;          // switch to 60fps
export const CANVAS = ULTRA_HD; // switch to 4K (FULL_HD | QUAD_HD | ULTRA_HD)
```

All four compositions pick up the new size/fps automatically. Use `seconds(n)`
in `Root.tsx` for durations so timings stay correct at any frame rate.

---

## The four starter compositions

| id                   | What it is                | Background   |
| -------------------- | ------------------------- | ------------ |
| `TitleCard`          | Centered title + subtitle | Solid        |
| `LowerThird`         | Name/role bar, lower-left | Transparent  |
| `KineticText`        | Words spring in one-by-one| Solid        |
| `TransparentOverlay` | Pulsing badge             | **Alpha**    |

Each has a clean **enter and exit** (nothing pops or cuts mid-animation), a
**zod schema** + **defaultProps** so you can edit it live in Studio.

---

## Adding a new graphic

1. Create `src/compositions/MyGraphic.tsx`. Export three things:

   ```tsx
   import { z } from "zod";
   import { zColor } from "@remotion/zod-types";

   export const myGraphicSchema = z.object({
     headline: z.string(),
     color: zColor(),
   });
   export type MyGraphicProps = z.infer<typeof myGraphicSchema>;
   export const myGraphicDefaults: MyGraphicProps = {
     headline: "Hello",
     color: "#5b8def",
   };

   export const MyGraphic: React.FC<MyGraphicProps> = ({ headline, color }) => {
     /* useCurrentFrame() + interpolate()/spring() — give it an enter AND exit */
   };
   ```

2. Register it in [`src/Root.tsx`](src/Root.tsx):

   ```tsx
   <Composition
     id="MyGraphic"                 // unique — this is the render name
     component={MyGraphic}
     durationInFrames={seconds(5)}
     fps={FPS}
     width={CANVAS.width}
     height={CANVAS.height}
     schema={myGraphicSchema}
     defaultProps={myGraphicDefaults}
   />
   ```

3. It appears in Studio and is renderable by its `id`.

---

## Rendering / exporting

Replace `<id>` with a composition id from the table above.

**Standard MP4 (H.264):**

```bash
npx remotion render <id> out/<id>.mp4 --codec=h264 --crf=18
```

**Transparent video (ProRes 4444 — real alpha channel for editors):**

```bash
npx remotion render <id> out/<id>.mov --codec=prores \
  --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png
```

**PNG sequence (frame-by-frame, also keeps alpha):**

```bash
npx remotion render <id> out/<id>/frame-%04d.png --image-format=png
```

Example for the transparent badge:

```bash
npx remotion render TransparentOverlay out/TransparentOverlay.mov \
  --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png
```

> Tip: add `--port=3999` to any render command if port 3000 is occupied.

---

## Tips for clean motion graphics

- **Stay in the title-safe area.** Keep important text within ~5% of the edges
  (`TITLE_SAFE_PADDING` in `config.ts`) so nothing is clipped on different
  screens or after a crop.
- **Always animate a full enter AND exit.** Use the `enterExit()` helper in
  `src/lib/animation.ts` so graphics never pop on or cut off abruptly.
- **Trim leading silence on sound effects** before importing, so the hit lands
  exactly on the frame where you place the `<Sequence from={...}>`.
- **CSS transitions/animations don't render** — animate with `useCurrentFrame()`
  + `interpolate()` / `spring()` only.
- **Transparency:** a composition is transparent only if its root element sets
  **no** background color (see `TransparentOverlay.tsx`).

---

## Fonts & sound effects

**Google font** — loaded once in [`src/lib/fonts.ts`](src/lib/fonts.ts) via
`@remotion/google-fonts`. Swap `Inter` for any family:

```ts
import { loadFont } from "@remotion/google-fonts/Montserrat";
```

**Sound effect** — drop a file in `public/sfx/`, then time it with a `Sequence`:

```tsx
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { Audio } from "@remotion/media";

<AbsoluteFill>
  <MyGraphic {...myGraphicDefaults} />
  <Sequence from={seconds(0.2)}>
    <Audio src={staticFile("sfx/whoosh.mp3")} />
  </Sequence>
</AbsoluteFill>;
```

(There's a copy-paste-ready version commented at the bottom of `Root.tsx`.)
