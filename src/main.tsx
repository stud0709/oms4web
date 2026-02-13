import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from 'virtual:pwa-register';

registerSW({ 
  immediate: true,
  onRegisteredSW(swUrl, r) {
    console.log('Service Worker registered at:', swUrl);
  },
  onRegisterError(error) {
    console.error('Service Worker registration failed:', error);
  },
  onOfflineReady() {
    console.log("App is ready for offline use.");
  }
});

createRoot(document.getElementById("root")!).render(<App />);
