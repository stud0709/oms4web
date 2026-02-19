import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { SW_BASE } from "./src/lib/constants";

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const base = command === 'serve' ? '/' : SW_BASE;
  return {
    base: base,
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      VitePWA({
        base: base,
        registerType: 'prompt',
        injectRegister: 'script', 
        includeAssets: ['favicon.png', 'favicon_192.png', 'favicon_512.png'],
        strategies: 'injectManifest',
        filename: 'sw.ts',
        srcDir: 'src',
        injectManifest: {
          injectionPoint: '__WB_MANIFEST',
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        },
        manifest: {
          //id: base,    
          name: 'oms4web',
          short_name: 'oms4web',
          description: 'OneMoreSecret password manager',
          theme_color: '#ffffff',
          start_url: base, 
          scope: base,     
          display: 'standalone',
          launch_handler: { client_mode: "focus-existing" },
          icons: [
            {
              src: 'favicon_192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'favicon_512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
      })
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  }
});
