import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    sessionStorage.setItem("oms_update_available", "1");
    window.dispatchEvent(new Event("oms-update-available"));
  },
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

window.addEventListener("oms-apply-update", () => { void updateSW(true); });

createRoot(document.getElementById("root")!).render(<App />);
