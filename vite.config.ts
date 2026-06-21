import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server for the custom control-panel web app (app/). Remotion's own CLI
// (studio/render) does not use this — it bundles src/index.ts itself.
export default defineConfig({
  plugins: [react()],
  publicDir: "public",
  server: { port: 5173 },
});
