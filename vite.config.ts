import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Project Pages live at https://<user>.github.io/househunter/
const pages = process.env.GITHUB_PAGES === "1";

export default defineConfig({
  plugins: [react()],
  base: pages ? "/househunter/" : "/",
});
