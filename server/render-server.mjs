// Local render server for the Pattern Studio web app.
// POST /render { props, imageData?, imageExt?, duration?, composition?, aiPaint?, aiPrompt?, aiDenoise? }
//   → optionally repaints the background photo via ComfyUI (img2img), then renders
//     the chosen composition to out/pattern-<id>.mp4 and returns its URL.
// Runs entirely on your machine.
import "dotenv/config";
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const OUT = path.join(ROOT, "out");
const IMAGES = path.join(ROOT, "public", "images");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(IMAGES, { recursive: true });

// ── ComfyUI (local, --api-only) painterly img2img ───────────────────────────
// Start ComfyUI separately: it must be reachable at COMFY_URL. The workflow graph
// lives in server/comfy-workflow.json (re-read each request, so edits need no
// restart). COMFY_NODES maps the roles we inject into that graph's node IDs —
// keep them in sync if you paste in your own API-format workflow.
const COMFY_URL = process.env.COMFY_URL || "http://127.0.0.1:8188";
const COMFY_NODES = { loadImage: "10", positivePrompt: "6", sampler: "3" };
const WORKFLOW_PATH = path.join(ROOT, "server", "comfy-workflow.json");
const DEFAULT_PAINT_PROMPT =
  "watercolor painting, painterly, textured watercolor paper, muted earthy palette, soft brush strokes, posterized, editorial illustration style";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Upload a local image into ComfyUI's input folder; returns the stored filename.
async function comfyUpload(filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("image", new Blob([buf]), path.basename(filePath));
  form.append("overwrite", "true");
  const res = await fetch(`${COMFY_URL}/upload/image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`ComfyUI upload failed (${res.status}): ${await res.text()}`);
  const j = await res.json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

// Queue a prompt and poll /history until the output image is ready.
async function comfyRun(workflow, { timeoutMs = 240000, intervalMs = 1500 } = {}) {
  const clientId = randomUUID();
  const queue = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!queue.ok) throw new Error(`ComfyUI /prompt rejected (${queue.status}): ${await queue.text()}`);
  const { prompt_id: promptId, node_errors: nodeErrors } = await queue.json();
  if (nodeErrors && Object.keys(nodeErrors).length) {
    throw new Error(`ComfyUI workflow node errors: ${JSON.stringify(nodeErrors)}`);
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${COMFY_URL}/history/${promptId}`);
    const hist = await res.json();
    const entry = hist[promptId];
    if (entry && entry.outputs) {
      for (const out of Object.values(entry.outputs)) {
        if (out.images && out.images.length) return out.images[0]; // { filename, subfolder, type }
      }
      throw new Error("ComfyUI finished but produced no image output");
    }
    await sleep(intervalMs);
  }
  throw new Error("ComfyUI render timed out");
}

// Full img2img pass: upload source → inject prompt/seed/denoise → run → save the
// painted result into public/images/ and return its staticFile-relative path.
async function paintWithComfy(srcPath, { prompt, denoise, seed, id }) {
  const uploaded = await comfyUpload(srcPath);
  const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));
  const load = workflow[COMFY_NODES.loadImage];
  const pos = workflow[COMFY_NODES.positivePrompt];
  const ksampler = workflow[COMFY_NODES.sampler];
  if (!load || !pos || !ksampler) {
    throw new Error(`comfy-workflow.json is missing one of the COMFY_NODES ids (${Object.values(COMFY_NODES).join(", ")})`);
  }
  load.inputs.image = uploaded;
  pos.inputs.text = prompt || DEFAULT_PAINT_PROMPT;
  ksampler.inputs.seed = Math.abs(Math.floor(seed)) || 1;
  ksampler.inputs.denoise = denoise;

  const img = await comfyRun(workflow);
  const view = await fetch(
    `${COMFY_URL}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${img.type || "output"}`,
  );
  if (!view.ok) throw new Error(`ComfyUI /view failed (${view.status})`);
  const outRel = `images/ai-${id}.png`;
  fs.writeFileSync(path.join(ROOT, "public", outRel), Buffer.from(await view.arrayBuffer()));
  return outRel;
}

// ── Claude (Anthropic) — AI "brand-from-a-prompt" + script writer ────────────
// Calls run server-side only, so the API key never reaches the browser.
// Default: first-party Anthropic API (set ANTHROPIC_API_KEY in .env).
// To use Google Cloud / Vertex credits instead, swap `new Anthropic()` for the
// AnthropicVertex client from `@anthropic-ai/vertex-sdk` (same call shape).
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";
let anthropic = null;
const getAnthropic = () => {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error("ANTHROPIC_API_KEY is not set — copy .env.example to .env and add your key.");
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
};

const SHAPE_IDS = [
  "arrowUp", "capsuleDiag", "capsuleH", "plug", "hBars", "barsII", "circle",
  "target", "squares4", "xCross", "dotGrid", "dots3", "dice5", "dice2", "nested", "stripes",
];

const clampNum = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const isHex = (s) => typeof s === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(s.trim());
const normHex = (s, fallback) => (isHex(s) ? (s.trim().startsWith("#") ? s.trim() : "#" + s.trim()) : fallback);

// Strip ```json fences / stray prose, then JSON.parse.
const parseJson = (text) => {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
};

const SYSTEM_GENERATE = `You are a senior brand and motion designer working inside "Pattern Studio", a tool that turns a one-line brand description into a bold animated title card: heavy condensed UPPERCASE caps inside a vivid colored block, with small geometric shapes scattered around it on a dark background.

Given a short description of a brand, product, topic, or event, design ONE striking title card and return it as a single JSON object with EXACTLY these fields:

{
  "titles": [
    { "kind": "block", "text": "TWO\\nWORDS", "x": 0.36, "y": 0.46, "size": 130 },
    { "kind": "label", "text": "A SHORT TAGLINE", "x": 0.36, "y": 0.61, "size": 30 }
  ],
  "accent": "#e0573a",
  "bgColor": "#2b2b2b",
  "colors": ["#6fa5a9", "#cf9f4a", "#e0573a"],
  "density": 11,
  "proximity": 11,
  "seed": 7,
  "shapes": ["circle", "target", "xCross", "dots3", "squares4", "stripes"]
}

Rules:
- titles: exactly one main "block" (the punchy title, 1-3 words, UPPERCASE, use \\n to split two lines), plus optionally one "label" (a short uppercase tagline) and/or one "jp" (a SHORT vertical Japanese accent — ONLY if the brand is genuinely Japan-related; otherwise omit it).
- x, y are fractions 0..1 of a 1920x1080 canvas. Keep the block centered-left (x ~0.34-0.46) and vertically centered (y ~0.44-0.62). Put a label just below the block; put a jp accent to the right of it.
- size: block ~110-150, label ~26-34, jp ~36-44.
- accent must pop against bgColor. Choose a palette ("colors", 3-6 hex) that evokes the brand's mood.
- density and proximity are 8-14. seed is any integer.
- shapes: 6-12 ids chosen ONLY from: ${SHAPE_IDS.join(", ")}.
- Respond with ONLY the JSON object — no prose, no markdown, no code fences.`;

const SYSTEM_SCRIPT = `You are a scriptwriter for short product-demo and brand videos. Given a brand or topic, write a punchy spoken voiceover script for a 45-75 second video. Structure it as: a 1-line HOOK, a 1-2 line PROBLEM, a 2-3 line SOLUTION/what it does, and a 1-line CALL TO ACTION. Write plain narration the creator reads aloud (no stage directions, no headers unless they help). Keep it energetic, concrete, and under ~140 words.`;

const app = express();
app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use("/out", express.static(OUT));

// Bundle the Remotion project once (cached for subsequent renders).
let serveUrlPromise = null;
const getServeUrl = () => {
  if (!serveUrlPromise) {
    console.log("Bundling Remotion project (first render only)…");
    serveUrlPromise = bundle({ entryPoint: path.join(ROOT, "src", "index.ts") });
  }
  return serveUrlPromise;
};

app.post("/render", async (req, res) => {
  const { props = {}, imageData, imageExt = "jpg", duration, composition: compId = "PatternTitle", aiPaint = false, aiPrompt, aiDenoise = 0.6 } = req.body;
  const id = `${Date.now()}`;
  try {
    // Save an uploaded background photo into public/ so staticFile can resolve it.
    let sourceImage = null; // absolute path of the photo to (optionally) repaint
    if (imageData) {
      const b64 = imageData.split(",")[1] ?? imageData;
      const file = path.join(IMAGES, `upload-${id}.${imageExt}`);
      fs.writeFileSync(file, Buffer.from(b64, "base64"));
      props.bgImage = `images/upload-${id}.${imageExt}`;
      sourceImage = file;
    } else if (props.bgImage && !/^(https?:|blob:|data:)/.test(props.bgImage)) {
      const p = path.join(ROOT, "public", props.bgImage);
      if (fs.existsSync(p)) sourceImage = p;
    }

    // Painterly background via ComfyUI (runs before Remotion so the MP4 bakes it in).
    if (aiPaint && sourceImage) {
      console.log("Painting background via ComfyUI…");
      props.bgImage = await paintWithComfy(sourceImage, {
        prompt: aiPrompt,
        denoise: aiDenoise,
        seed: props.seed ?? Number(id.slice(-9)),
        id,
      });
      props.paint = 0; // skip the SVG watercolor filter — ComfyUI already painted it
      console.log("ComfyUI background ready:", props.bgImage);
    }

    const serveUrl = await getServeUrl();
    // Pin the renderer's internal server port (3000 is often taken).
    const composition = await selectComposition({ serveUrl, id: compId, inputProps: props, port: 3017 });
    if (duration) composition.durationInFrames = duration;

    const outputLocation = path.join(OUT, `pattern-${id}.mp4`);
    console.log(`Rendering ${compId} → pattern-${id}.mp4 …`);
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: 18,
      outputLocation,
      inputProps: props,
      port: 3018,
    });
    console.log("Done:", outputLocation);
    res.json({ url: `/out/pattern-${id}.mp4` });
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e?.message ?? e));
  }
});

// AI brand-from-a-prompt → a full PatternTitle scene the editor can drop in.
app.post("/generate", async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || !String(prompt).trim()) return res.status(400).send("Missing 'prompt'.");
  try {
    const client = getAnthropic();
    const msg = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: SYSTEM_GENERATE,
      messages: [{ role: "user", content: `Brand / topic: ${String(prompt).trim()}` }],
    });
    const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const raw = parseJson(text);

    // Validate + clamp into the PatternTitle prop ranges (never trust the model blindly).
    const kinds = new Set(["block", "label", "jp"]);
    const titles = (Array.isArray(raw.titles) ? raw.titles : [])
      .filter((t) => t && kinds.has(t.kind) && typeof t.text === "string" && t.text.trim())
      .slice(0, 4)
      .map((t) => ({
        kind: t.kind,
        text: String(t.text).slice(0, 80),
        x: clampNum(t.x, 0, 1, 0.4),
        y: clampNum(t.y, 0, 1, 0.5),
        size: clampNum(t.size, 8, 400, t.kind === "block" ? 130 : t.kind === "label" ? 30 : 40),
      }));
    if (!titles.length) titles.push({ kind: "block", text: "UNTITLED", x: 0.4, y: 0.5, size: 130 });

    const colors = (Array.isArray(raw.colors) ? raw.colors : [])
      .filter(isHex).map((c) => normHex(c)).slice(0, 6);
    const shapes = (Array.isArray(raw.shapes) ? raw.shapes : [])
      .filter((s) => SHAPE_IDS.includes(s));

    res.json({
      titles,
      accent: normHex(raw.accent, "#e0573a"),
      bgColor: normHex(raw.bgColor, "#2b2b2b"),
      colors: colors.length ? colors : ["#6fa5a9", "#cf9f4a", "#e0573a", "#000000", "#ffffff"],
      density: Math.round(clampNum(raw.density, 1, 20, 11)),
      proximity: Math.round(clampNum(raw.proximity, 1, 20, 11)),
      seed: Math.round(clampNum(raw.seed, 0, 1e9, Math.floor(Date.now() % 1e9))),
      shapes: shapes.length ? shapes : SHAPE_IDS,
    });
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e?.message ?? e));
  }
});

// AI script writer → a short voiceover script for the demo/brand video.
app.post("/script", async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || !String(prompt).trim()) return res.status(400).send("Missing 'prompt'.");
  try {
    const client = getAnthropic();
    const msg = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      system: SYSTEM_SCRIPT,
      messages: [{ role: "user", content: `Brand / topic: ${String(prompt).trim()}` }],
    });
    const script = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    res.json({ script });
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e?.message ?? e));
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Render server on http://localhost:${PORT}`));
