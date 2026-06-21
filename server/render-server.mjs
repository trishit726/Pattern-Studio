// Local render server for the Pattern Studio web app.
// POST /render { props, imageData?, imageExt?, duration?, composition?, aiPaint?, aiPrompt?, aiDenoise? }
//   → optionally repaints the background photo via ComfyUI (img2img), then renders
//     the chosen composition to out/pattern-<id>.mp4 and returns its URL.
// Runs entirely on your machine.
import express from "express";
import cors from "cors";
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

const PORT = 3001;
app.listen(PORT, () => console.log(`Render server on http://localhost:${PORT}`));
