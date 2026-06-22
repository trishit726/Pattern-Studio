// Generates voiceovers via free Microsoft Edge neural TTS (no key/quota).
//   node tools/make-voiceover.mjs promo   → public/music/voiceover.mp3
//   node tools/make-voiceover.mjs arch    → public/music/architecture-vo.mp3
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import ffprobe from "ffprobe-static";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");

const SCRIPTS = {
  promo: {
    out: "voiceover.mp3",
    text: `Great brand titles used to take a designer, and a week. Now, they take a sentence.
This is Pattern Studio.
Describe your brand, and A.I. designs the whole title. The headline. The colours. The motion.
And every piece stays yours to control.
Pick a style. Let the shapes gather around your words... or flood the screen in colour.
Sync it to the beat. Then render, and your brand is in motion.
Pattern Studio. Open source, and made for everyone.`,
  },
  arch: {
    out: "architecture-vo.mp3",
    text: `Here's how Pattern Studio works under the hood.
You describe your brand, in one line.
The editor — a React app — sends it to a local render server.
The server calls Gemini, which designs a complete scene, and returns it as structured data.
That scene drops straight into a live Remotion preview, where you can edit anything.
When you're happy, one click sends it back — and the server renders your scene with Remotion, into a finished M P 4.
From a sentence, to a video. Editor, server, A.I., and Remotion.`,
  },
  problem: {
    out: "problem-vo.mp3",
    text: `Every brand needs motion. A title that moves. An intro that grabs attention. A logo that comes alive.
But great motion graphics are locked behind a wall.
To make a single animated title, you need a motion designer — and they are expensive. Hundreds of dollars, for a few seconds of video.
Or, you learn the tools yourself. After Effects. Keyframes. Easing curves. That is weeks of practice, and the skills don't transfer.
So most people settle. They grab a generic template that looks like everyone else's. They ship a plain, static title. Or, they skip motion entirely.
For a founder launching a product... a student presenting a project... a small creator building a brand... high-end motion is simply out of reach.
The tools are either too expensive, too hard, or too generic. There is no middle ground.
That is the problem. Professional motion graphics should be as easy as describing what you want. And that is exactly what we set out to build.`,
  },
};

const which = process.argv[2] || "promo";
const sel = SCRIPTS[which];
if (!sel) { console.error("Unknown script:", which, "— use 'promo' or 'arch'"); process.exit(1); }

const out = path.join(ROOT, "public", "music", sel.out);
const VOICE = "en-US-GuyNeural";

const tts = new MsEdgeTTS();
await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
let result = tts.toStream(sel.text);
if (result && typeof result.then === "function") result = await result;
const audioStream = result.audioStream ?? result;

const chunks = [];
await new Promise((resolve, reject) => {
  audioStream.on("data", (d) => chunks.push(d));
  audioStream.on("end", resolve);
  audioStream.on("close", resolve);
  audioStream.on("error", reject);
});

const buf = Buffer.concat(chunks);
if (!buf.length) { console.error("no audio produced"); process.exit(1); }
fs.writeFileSync(out, buf);
console.log("voice:", VOICE, "→ saved", out, buf.length, "bytes");
try {
  const dur = execFileSync(ffprobe.path, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString().trim();
  console.log("duration:", dur, "sec  →  frames@30:", Math.ceil(parseFloat(dur) * 30));
} catch { console.log("(duration probe skipped)"); }
