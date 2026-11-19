import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Absolute asset paths: deep links like /join/ABCD2345 must still load /assets/*.
  base: "/",
});
