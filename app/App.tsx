import React, { useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { PatternTitle, patternTitleDefaults, type PatternTitleProps, type TitleItem } from "../src/compositions/PatternTitle";
import { Assembly, assemblyDefaults, ASSEMBLY_DURATION, type AssemblyProps } from "../src/compositions/Assembly";
import { Intro, introDefaults, INTRO_DURATION, type IntroProps } from "../src/compositions/Intro";
import { Shape } from "../src/lib/patterngen/PatternField";
import { ANIM_TYPES } from "../src/lib/patterngen/engine";

const MUSIC = "music/lofi.mp3"; // CC0 lo-fi bed (HoliznaCC0) in public/music/
type CompId = "PatternTitle" | "Assembly" | "Intro";

const SERVER = "http://localhost:3001";
// Default brand palette + black/white — the preset "COLOR SET".
const PALETTE = ["#6fa5a9", "#93ab5a", "#cf9f4a", "#e0573a", "#000000", "#ffffff"];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const fileToDataURL = (f: File) =>
  new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); });

const newTitle = (kind: TitleItem["kind"]): TitleItem => ({
  id: `t${Date.now()}`, kind,
  text: kind === "jp" ? "テキスト" : kind === "label" ? "SUB LABEL" : "TITLE",
  x: 0.5, y: 0.5, size: kind === "block" ? 130 : kind === "label" ? 30 : 40,
});

export const App: React.FC = () => {
  const [comp, setComp] = useState<CompId>("PatternTitle");
  const [props, setProps] = useState<PatternTitleProps>(patternTitleDefaults);
  const [assemblyProps, setAssemblyProps] = useState<AssemblyProps>(assemblyDefaults);
  const [introProps, setIntroProps] = useState<IntroProps>(introDefaults);
  const [duration, setDuration] = useState(150);
  const [selectedId, setSelectedId] = useState(props.titles[0]?.id ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [aiPaint, setAiPaint] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [script, setScript] = useState("");
  const [scriptBusy, setScriptBusy] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  React.useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const set = <K extends keyof PatternTitleProps>(k: K, v: PatternTitleProps[K]) => setProps((p) => ({ ...p, [k]: v }));
  const inputProps = useMemo(() => props, [props]);
  const sel = props.titles.find((t) => t.id === selectedId);

  // titles
  const setTitle = (id: string, patch: Partial<TitleItem>) =>
    setProps((p) => ({ ...p, titles: p.titles.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const addTitle = (kind: TitleItem["kind"]) => { const t = newTitle(kind); setProps((p) => ({ ...p, titles: [...p.titles, t] })); setSelectedId(t.id); };
  const removeTitle = (id: string) => setProps((p) => ({ ...p, titles: p.titles.filter((t) => t.id !== id) }));
  const moveSel = (e: React.PointerEvent) => {
    const el = dragRef.current; if (!el || !selectedId) return;
    const r = el.getBoundingClientRect();
    setTitle(selectedId, { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) });
  };

  // shapes
  const toggleShape = (a: string) => set("shapes", props.shapes.includes(a) ? props.shapes.filter((s) => s !== a) : [...props.shapes, a]);
  const allShapes = ANIM_TYPES.every((a) => props.shapes.includes(a));

  // pattern colors
  const has = (c: string) => props.colors.some((x) => x.toLowerCase() === c.toLowerCase());
  const toggleColor = (c: string) => set("colors", has(c) ? props.colors.filter((x) => x.toLowerCase() !== c.toLowerCase()) : [...props.colors, c]);
  const customs = props.colors.filter((c) => !PALETTE.includes(c.toLowerCase()));
  const replaceColor = (oldC: string, newC: string) => set("colors", props.colors.map((x) => (x === oldC ? newC : x)));
  const removeColor = (c: string) => set("colors", props.colors.filter((x) => x !== c));
  const addColor = () => { if (customs.length < 3) set("colors", [...props.colors, "#808080"]); };

  // background
  const onImage = (f: File | null) => { setImageFile(f); set("bgImage", f ? URL.createObjectURL(f) : ""); };

  // save / load
  const save = () => {
    const blob = new Blob([JSON.stringify({ props, duration }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "pattern-scene.json"; a.click();
  };
  const load = () => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json";
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      try { const d = JSON.parse(await f.text()); if (d.props) { setProps(d.props); setSelectedId(d.props.titles?.[0]?.id ?? ""); } if (d.duration) setDuration(d.duration); }
      catch (e) { console.error(e); }
    };
    inp.click();
  };

  // AI: turn a one-line brand description into a full PatternTitle scene.
  const generateAI = async () => {
    if (!aiPrompt.trim() || aiBusy) return;
    setAiBusy(true); setVideoUrl(null); setStatus("Designing your scene with AI…");
    try {
      const res = await fetch(`${SERVER}/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: aiPrompt }) });
      if (!res.ok) throw new Error(await res.text());
      const s = await res.json();
      const titles: TitleItem[] = (s.titles ?? []).map((t: any, i: number) => ({
        id: `ai${Date.now()}_${i}`, kind: t.kind as TitleItem["kind"], text: String(t.text), x: t.x, y: t.y, size: t.size,
      }));
      setProps((p) => ({
        ...p,
        titles: titles.length ? titles : p.titles,
        accent: s.accent ?? p.accent,
        bgColor: s.bgColor ?? p.bgColor,
        colors: Array.isArray(s.colors) && s.colors.length ? s.colors : p.colors,
        density: s.density ?? p.density,
        proximity: s.proximity ?? p.proximity,
        seed: s.seed ?? p.seed,
        shapes: Array.isArray(s.shapes) && s.shapes.length ? s.shapes : p.shapes,
      }));
      setSelectedId(titles[0]?.id ?? "");
      setStatus("AI scene ready ✓ — drag, tweak, or Render to MP4.");
    } catch (e) {
      setStatus("AI error — is the server up (npm run server) and ANTHROPIC_API_KEY set?");
      console.error(e);
    } finally { setAiBusy(false); }
  };

  // AI: write a short voiceover script for the demo/brand video.
  const writeScript = async () => {
    if (scriptBusy) return;
    const topic = aiPrompt.trim() || props.titles.map((t) => t.text).join(" ");
    if (!topic) { setStatus("Type a brand/topic first."); return; }
    setScriptBusy(true);
    try {
      const res = await fetch(`${SERVER}/script`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: topic }) });
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      setScript(j.script ?? "");
    } catch (e) {
      setScript("Error — is the server up (npm run server) and ANTHROPIC_API_KEY set?");
      console.error(e);
    } finally { setScriptBusy(false); }
  };

  const render = async () => {
    setRendering(true); setVideoUrl(null); setStatus("Rendering… (first run bundles, ~30–60s)");
    try {
      let body: Record<string, unknown>;
      if (comp === "Assembly") {
        body = { composition: "Assembly", props: assemblyProps };
      } else if (comp === "Intro") {
        body = { composition: "Intro", props: introProps, aiPaint };
      } else {
        let imageData: string | undefined, imageExt: string | undefined;
        if (imageFile) { imageData = await fileToDataURL(imageFile); imageExt = imageFile.name.split(".").pop() || "jpg"; }
        const sendProps = { ...props, bgImage: imageData || props.bgImage.startsWith("blob:") ? "" : props.bgImage };
        body = { composition: "PatternTitle", props: sendProps, imageData, imageExt, duration, aiPaint };
      }
      const res = await fetch(`${SERVER}/render`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json(); setVideoUrl(`${SERVER}${json.url}`); setStatus("Done ✓");
    } catch (e) { setStatus("Error — is the render server up? (npm run server)"); console.error(e); }
    finally { setRendering(false); }
  };

  return (
    <div style={S.app}>
      <header style={S.header}>
        <div style={S.row}>
          <span style={S.brand}>PATTERN STUDIO</span>
          <select value={comp} onChange={(e) => setComp(e.target.value as CompId)} style={S.compSelect}>
            <option value="PatternTitle">Pattern Title</option>
            <option value="Intro">Intro (opener)</option>
            <option value="Assembly">Assembly (film)</option>
          </select>
          <button className="link-btn" onClick={save}>Save</button>
          <button className="link-btn" onClick={load}>Load</button>
        </div>
        <div style={S.row}>
          {comp === "PatternTitle" ? <button className="link-btn" onClick={() => set("seed", Math.floor(Math.random() * 1e9))}>Generate</button> : null}
          <button className="link-btn accent" disabled={rendering} onClick={render}>{rendering ? "Rendering…" : "Render"}</button>
          {comp === "PatternTitle" ? <button className={props.showGrid ? "link-btn accent" : "link-btn"} onClick={() => set("showGrid", !props.showGrid)}>Grid</button> : null}
          <button className="link-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Dark" : "Light"}</button>
        </div>
      </header>

      <div style={S.canvasCell}>
        <div style={{ position: "relative", width: "100%", boxShadow: "0 30px 80px rgba(0,0,0,0.45)" }}>
          {comp === "Assembly" ? (
            <Player acknowledgeRemotionLicense component={Assembly} inputProps={assemblyProps} durationInFrames={ASSEMBLY_DURATION} fps={30}
              compositionWidth={1920} compositionHeight={1080} style={{ width: "100%", aspectRatio: "16 / 9" }}
              initialFrame={Math.min(40, ASSEMBLY_DURATION - 1)} controls loop />
          ) : comp === "Intro" ? (
            <Player acknowledgeRemotionLicense component={Intro} inputProps={introProps} durationInFrames={INTRO_DURATION} fps={30}
              compositionWidth={1920} compositionHeight={1080} style={{ width: "100%", aspectRatio: "16 / 9" }}
              initialFrame={Math.min(40, INTRO_DURATION - 1)} controls loop />
          ) : (
            <>
              <Player acknowledgeRemotionLicense component={PatternTitle} inputProps={inputProps} durationInFrames={duration} fps={30}
                compositionWidth={1920} compositionHeight={1080} style={{ width: "100%", aspectRatio: "16 / 9" }}
                initialFrame={Math.min(90, duration - 1)} controls loop />
              <div ref={dragRef} style={{ position: "absolute", inset: 0, bottom: 46, cursor: "move" }}
                onPointerDown={(e) => { draggingRef.current = true; e.currentTarget.setPointerCapture(e.pointerId); moveSel(e); }}
                onPointerMove={(e) => { if (draggingRef.current) moveSel(e); }}
                onPointerUp={(e) => { draggingRef.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }} />
            </>
          )}
        </div>
        <div style={S.status}>{status || (comp === "Assembly" ? "Assembly — the full ~18.5s film. Edit title/site & toggle music below." : comp === "Intro" ? "Intro — the animated opener (~16.7s). Edit text & audio below." : sel ? `Dragging "${sel.text.replace(/\n/g, " ")}" — pick another title to move it.` : "Add a title below.")}</div>
      </div>

      <aside style={S.sidebar}>
        {comp === "PatternTitle" ? (
        <>
        <Section title="✨ AI Brand">
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Describe your brand or topic — e.g. “Ember, a warm rustic specialty coffee roaster”"
            rows={3}
            style={{ width: "100%", resize: "vertical", background: "var(--bg)", color: "var(--input-text)", border: "1px solid var(--bar-empty)", borderRadius: 6, fontFamily: "inherit", fontSize: 14, padding: 10, boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 16, marginTop: 10, alignItems: "center" }}>
            <button className="link-btn accent" disabled={aiBusy || !aiPrompt.trim()} onClick={generateAI}>{aiBusy ? "Designing…" : "Generate Scene"}</button>
            <button className="link-btn" disabled={scriptBusy} onClick={writeScript}>{scriptBusy ? "Writing…" : "Write Script"}</button>
          </div>
          <div style={{ ...S.status, marginTop: 8 }}>Type a description, then Generate — Claude designs the title, palette &amp; pattern. Everything stays editable.</div>
          {script ? (
            <div style={{ marginTop: 12 }}>
              <textarea readOnly value={script} rows={8} style={{ width: "100%", resize: "vertical", background: "var(--bg)", color: "var(--muted)", border: "1px solid var(--bar-empty)", borderRadius: 6, fontFamily: "inherit", fontSize: 13, lineHeight: 1.5, padding: 10, boxSizing: "border-box" }} />
              <button className="link-btn" style={{ fontSize: 14, marginTop: 6 }} onClick={() => navigator.clipboard.writeText(script)}>Copy script</button>
            </div>
          ) : null}
        </Section>

        <Section title="Titles">
          {props.titles.map((t) => (
            <div key={t.id} onClick={() => setSelectedId(t.id)}
              style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8, padding: 8, borderRadius: 6, cursor: "pointer", border: `1px solid ${t.id === selectedId ? "var(--accent)" : "var(--bar-empty)"}`, background: t.id === selectedId ? "var(--panel)" : "transparent" }}>
              <span style={{ fontSize: 10, color: "var(--muted-2)", textTransform: "uppercase", width: 34, paddingTop: 6 }}>{t.kind}</span>
              <textarea value={t.text} rows={t.kind === "block" ? 2 : 1} onChange={(e) => setTitle(t.id, { text: e.target.value })}
                style={{ flex: 1, resize: "none", background: "var(--bg)", color: "var(--input-text)", border: "1px solid var(--bar-empty)", borderRadius: 4, fontFamily: "inherit", fontSize: 14, padding: 6 }} />
              <button className="link-btn" style={{ fontSize: 20 }} onClick={(e) => { e.stopPropagation(); removeTitle(t.id); }}>×</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
            <button className="link-btn" style={{ fontSize: 15 }} onClick={() => addTitle("block")}>+ Block</button>
            <button className="link-btn" style={{ fontSize: 15 }} onClick={() => addTitle("label")}>+ Label</button>
            <button className="link-btn" style={{ fontSize: 15 }} onClick={() => addTitle("jp")}>+ JP</button>
          </div>
          {sel ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: "var(--muted-2)", marginBottom: 6 }}>SIZE {sel.size}</div>
              <BarSlider value={Math.round(sel.size / 14)} min={1} max={16} onChange={(v) => setTitle(sel.id, { size: v * 14 })} />
            </div>
          ) : null}
        </Section>

        <Section title="Duration" value={`${Math.round(duration / 30)}s`}>
          <BarSlider value={Math.round(duration / 30)} min={2} max={12} onChange={(v) => setDuration(v * 30)} />
        </Section>
        <Section title="Density" value={props.density}><BarSlider value={props.density} max={20} onChange={(v) => set("density", v)} /></Section>
        <Section title="Proximity" value={props.proximity}><BarSlider value={props.proximity} max={20} onChange={(v) => set("proximity", v)} /></Section>
        <Section title="Stagger" value={props.stagger}><BarSlider value={props.stagger} min={0} max={5} onChange={(v) => set("stagger", v)} /></Section>

        <div>
          <div style={{ ...S.sectionTitle, cursor: "pointer" }} onClick={() => set("shapes", allShapes ? [] : [...ANIM_TYPES])}>
            Shapes <span style={S.valueNum}>{allShapes ? "deselect all" : "select all"}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, width: 300 }}>
            {ANIM_TYPES.map((a) => {
              const on = props.shapes.includes(a);
              return (
                <button key={a} onClick={() => toggleShape(a)} title={a}
                  style={{ aspectRatio: "1", background: on ? "var(--bar-filled)" : "var(--bar-empty)", border: "none", borderRadius: 6, padding: 9, cursor: "pointer" }}>
                  <Shape anim={a} fg={on ? "#111" : "#888"} />
                </button>
              );
            })}
          </div>
        </div>

        <Section title="Color Set">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            {PALETTE.map((c) => (
              <div key={c} onClick={() => toggleColor(c)} title={c}
                style={{ width: 48, height: 48, borderRadius: 4, background: c, cursor: "pointer", border: `2px solid ${c === "#ffffff" ? "#ccc" : "#444"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <SelectedDot on={has(c)} dark={c !== "#000000"} />
              </div>
            ))}
            {customs.map((c) => (
              <div key={c} style={{ position: "relative" }}>
                <label className="swatch" style={{ width: 48, height: 48, background: c }}>
                  <input type="color" value={c} onChange={(e) => replaceColor(c, e.target.value)} style={{ opacity: 0 }} />
                </label>
                <button className="link-btn" onClick={() => removeColor(c)} style={{ position: "absolute", top: -10, right: -6, fontSize: 16 }}>×</button>
              </div>
            ))}
            {customs.length < 3 ? <button className="link-btn" style={{ fontSize: 14 }} onClick={addColor}>+ add</button> : null}
          </div>
        </Section>

        <Section title="Title / BG">
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <label className="swatch" style={{ background: props.accent }}><input type="color" value={props.accent} onChange={(e) => set("accent", e.target.value)} style={{ opacity: 0 }} /></label>
            <label className="swatch" style={{ background: props.bgColor }}><input type="color" value={props.bgColor} onChange={(e) => set("bgColor", e.target.value)} style={{ opacity: 0 }} /></label>
            <span style={{ color: "var(--muted-2)", fontSize: 13 }}>title · bg</span>
          </div>
        </Section>

        <Section title="Background Photo">
          <input type="file" accept="image/*" onChange={(e) => onImage(e.target.files?.[0] ?? null)} style={{ color: "var(--muted)", fontSize: 13 }} />
          {props.bgImage ? <button className="link-btn" style={{ fontSize: 15, marginTop: 8 }} onClick={() => onImage(null)}>Clear</button> : null}
          {props.bgImage ? (
            <div style={{ marginTop: 12 }}>
              <button className={aiPaint ? "link-btn accent" : "link-btn"} style={{ fontSize: 15 }} onClick={() => setAiPaint(!aiPaint)}>AI Painterly</button>
              <div style={{ ...S.status, marginTop: 6 }}>{aiPaint ? "Render repaints the photo via local ComfyUI (port 8188) first. Preview shows the SVG filter." : "Off — uses the built-in SVG watercolor filter."}</div>
            </div>
          ) : null}
        </Section>

        {props.bgImage ? (
          <Section title="Painterly" value={props.paint}><BarSlider value={Math.round(props.paint / 10)} min={0} max={12} onChange={(v) => set("paint", v * 10)} /></Section>
        ) : null}

        <Section title="Audio">
          <div style={{ display: "flex", gap: 18 }}>
            <button className={props.music ? "link-btn accent" : "link-btn"} onClick={() => set("music", props.music ? "" : MUSIC)}>Music</button>
            <button className={props.sfx ? "link-btn accent" : "link-btn"} onClick={() => set("sfx", !props.sfx)}>SFX</button>
          </div>
        </Section>
        </>
        ) : comp === "Assembly" ? (
        <>
          <Section title="Title">
            <input className="line-input" value={assemblyProps.name} onChange={(e) => setAssemblyProps((p) => ({ ...p, name: e.target.value }))} />
          </Section>
          <Section title="Site">
            <input className="line-input" value={assemblyProps.site} onChange={(e) => setAssemblyProps((p) => ({ ...p, site: e.target.value }))} />
          </Section>
          <Section title="Audio">
            <button className={assemblyProps.music ? "link-btn accent" : "link-btn"} onClick={() => setAssemblyProps((p) => ({ ...p, music: p.music ? "" : MUSIC }))}>Music Bed</button>
            <div style={{ ...S.status, marginTop: 8 }}>SFX hits are always on for the film.</div>
          </Section>
        </>
        ) : (
        <>
          <Section title="Title"><input className="line-input" value={introProps.title} onChange={(e) => setIntroProps((p) => ({ ...p, title: e.target.value }))} /></Section>
          <Section title="Byline"><input className="line-input" value={introProps.byline} onChange={(e) => setIntroProps((p) => ({ ...p, byline: e.target.value }))} /></Section>
          <Section title="JP Accent"><input className="line-input" value={introProps.jp} onChange={(e) => setIntroProps((p) => ({ ...p, jp: e.target.value }))} /></Section>
          <Section title="Awards">
            <input className="line-input" value={introProps.awards.join(", ")} onChange={(e) => setIntroProps((p) => ({ ...p, awards: e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) }))} />
            <div style={{ ...S.status, marginTop: 6 }}>Comma-separated · up to 6 shown</div>
          </Section>
          <Section title="Runtime"><input className="line-input" value={introProps.runtime} onChange={(e) => setIntroProps((p) => ({ ...p, runtime: e.target.value }))} /></Section>
          <Section title="Hero Photos">
            <input className="line-input" style={{ fontSize: 15 }} value={introProps.bgImage} onChange={(e) => setIntroProps((p) => ({ ...p, bgImage: e.target.value }))} />
            <div style={{ ...S.status, marginTop: 4 }}>1 · entrance shot (e.g. images/alley1.jpg)</div>
            <input className="line-input" style={{ fontSize: 15, marginTop: 10 }} value={introProps.bgImage2} onChange={(e) => setIntroProps((p) => ({ ...p, bgImage2: e.target.value }))} />
            <div style={{ ...S.status, marginTop: 4 }}>2 · deeper shot — camera dollies into it (blank = single photo)</div>
            <div style={{ marginTop: 12 }}>
              <button className={aiPaint ? "link-btn accent" : "link-btn"} style={{ fontSize: 15 }} onClick={() => setAiPaint(!aiPaint)}>AI Painterly</button>
              <div style={{ ...S.status, marginTop: 6 }}>{aiPaint ? "Render repaints the hero via ComfyUI (8188) first." : "Off — built-in SVG watercolor filter."}</div>
            </div>
          </Section>
          <Section title="Audio">
            <div style={{ display: "flex", gap: 18 }}>
              <button className={introProps.music ? "link-btn accent" : "link-btn"} onClick={() => setIntroProps((p) => ({ ...p, music: p.music ? "" : MUSIC }))}>Music</button>
              <button className={introProps.sfx ? "link-btn accent" : "link-btn"} onClick={() => setIntroProps((p) => ({ ...p, sfx: !p.sfx }))}>SFX</button>
            </div>
          </Section>
        </>
        )}

        {videoUrl ? (
          <Section title="Last Render">
            <video src={videoUrl} controls style={{ width: "100%", borderRadius: 4 }} />
            <a href={videoUrl} download className="link-btn accent" style={{ fontSize: 15, display: "inline-block", marginTop: 6 }}>Download MP4</a>
          </Section>
        ) : null}
      </aside>
    </div>
  );
};

const Section: React.FC<{ title: string; value?: number | string; children: React.ReactNode }> = ({ title, value, children }) => (
  <div>
    <div style={S.sectionTitle}>{title}{value !== undefined ? <span style={S.valueNum}> {value}</span> : null}</div>
    {children}
  </div>
);

const SelectedDot: React.FC<{ on: boolean; dark: boolean }> = ({ on, dark }) => (
  <div style={{
    width: 16, height: 16, borderRadius: "50%", background: dark ? "#1a1a1a" : "#eee",
    transform: on ? "scale(1)" : "scale(0)", opacity: on ? 1 : 0,
    transition: "transform 280ms cubic-bezier(0.34,1.56,0.64,1), opacity 200ms ease-out",
  }} />
);

const BarSlider: React.FC<{ value: number; max: number; min?: number; onChange: (v: number) => void }> = ({ value, max, min = 1, onChange }) => (
  <div style={{ display: "flex", gap: 3, cursor: "pointer", width: 300 }}>
    {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((v) => (
      <div key={v} className="bar-step" onClick={() => onChange(v)} style={{ flex: 1, height: 18, borderRadius: 2, background: v <= value ? "var(--bar-filled)" : "var(--bar-empty)" }} />
    ))}
  </div>
);

const S: Record<string, React.CSSProperties> = {
  app: { display: "grid", gridTemplateColumns: "1fr 380px", gridTemplateRows: "auto 1fr", columnGap: 40, rowGap: 32, padding: 40, height: "100vh", width: "100vw", overflow: "hidden", background: "var(--bg)" },
  header: { gridColumn: "1 / 3", display: "flex", alignItems: "center", justifyContent: "space-between", height: 40 },
  row: { display: "flex", alignItems: "center", gap: 22 },
  brand: { fontSize: 22, fontWeight: 700, color: "var(--fg)", letterSpacing: "0.06em" },
  compSelect: { background: "var(--panel)", color: "var(--fg)", border: "1px solid var(--bar-empty)", borderRadius: 6, padding: "6px 10px", fontFamily: "inherit", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  canvasCell: { gridColumn: 1, gridRow: 2, display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 },
  sidebar: { gridColumn: 2, gridRow: 2, overflowY: "auto", display: "flex", flexDirection: "column", gap: 26 },
  sectionTitle: { fontSize: 22, fontWeight: 600, color: "var(--fg-strong)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 12 },
  valueNum: { color: "var(--muted-2)", opacity: 0.6 },
  status: { marginTop: 14, fontSize: 13, color: "var(--muted)" },
};
