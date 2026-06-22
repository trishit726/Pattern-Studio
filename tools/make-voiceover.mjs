// Generates the demo voiceover via free Microsoft Edge neural TTS (no key/quota)
// → public/music/voiceover.mp3
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import ffprobe from "ffprobe-static";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const out = path.join(ROOT, "public", "music", "voiceover.mp3");

const SCRIPT = `Great brand titles used to take a designer, and a week. Now, they take a sentence.
This is Pattern Studio.
Describe your brand, and A.I. designs the whole title. The headline. The colours. The motion.
And every piece stays yours to control.
Pick a style. Let the shapes gather around your words... or flood the screen in colour.
Sync it to the beat. Then render, and your brand is in motion.
Pattern Studio. Open source, and made for everyone.`;

const VOICE = "en-US-GuyNeural";

const tts = new MsEdgeTTS();
await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

let result = tts.toStream(SCRIPT);
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
