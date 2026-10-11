import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  // `react-router dev`: local only, on all interfaces only when asked.
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
