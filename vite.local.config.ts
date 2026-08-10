import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

// Windows ARM does not have a local workerd binary. This keeps local UI
// development available while vite.config.ts remains the Sites deployment build.
export default defineConfig({
  plugins: [vinext(), sites()],
});
