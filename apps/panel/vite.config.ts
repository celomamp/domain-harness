import { reactRouter } from "@react-router/dev/vite";
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";

// Workspace packages export their TypeScript source under this condition.
const SOURCE = "@domain-harness/source";

export default defineConfig(({ command }) => ({
  plugins: [reactRouter()],
  // `react-router dev` reads workspace packages from source, so a clean clone
  // serves without building them first. Builds keep the packages' dist.
  ...(command === "serve"
    ? {
        resolve: { conditions: [SOURCE, ...defaultClientConditions] },
        ssr: { resolve: { conditions: [SOURCE, ...defaultServerConditions] } },
      }
    : {}),
  // `react-router dev`: local only, on all interfaces only when asked.
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
}));
