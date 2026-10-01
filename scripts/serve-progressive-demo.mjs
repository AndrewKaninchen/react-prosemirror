import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { build, preview } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = {
  root,
  configFile: false,
  plugins: [react()],
  build: {
    target: "esnext",
    outDir: `${root}/.progressive-demo-dist`,
    emptyOutDir: true,
    rollupOptions: { input: `${root}/demo/progressive-mount.html` },
  },
};
await build(config);
await preview({
  ...config,
  preview: { host: "127.0.0.1", port: 4180, strictPort: true },
});
// eslint-disable-next-line no-console
console.log("Manual demo: http://127.0.0.1:4180/demo/progressive-mount.html");
