# Project Knowledge Base

## 1. Project Overview
- **Purpose:** `oms4web` is a browser-based password manager tightly integrated with the OneMoreSecret (OMS) app. It provides encrypted storage and QR/intent-based workflows to encrypt/decrypt passwords and vault data using OMS-compatible RSA/AES envelopes.
- **Target users:** Users of OneMoreSecret who want a web UI for managing entries on desktop or mobile without a backend.
- **Key features:**
  - Local-only storage in browser IndexedDB (no backend).
  - OMS-compatible encryption for vault export/import and per-field encryption.
  - QR-code/Android intent workflows for air-gapped encryption/decryption.
  - Workspace protection modes: none, quick unlock, PIN lock, or full encrypt.
  - Entry history, tag filtering, JSONPath-based references between entries.
  - PWA with offline support and GitHub Pages deployment.

## 2. Architecture Overview
- **High-level architecture:**
  - **UI layer:** React components (pages + dialogs) built on shadcn/ui and Radix primitives.
  - **State + domain logic:** `useEncryptedVault` hook orchestrates vault lifecycle, encryption, and storage.
  - **Crypto layer:** `src/lib/*` handles RSA/AES envelopes, PIN derivation, QR chunking, and OMS message creation.
  - **Persistence:** IndexedDB via `idb` (vault, key request contexts, quick unlock data).
  - **PWA infrastructure:** Vite + Workbox service worker with `injectManifest` strategy.
- **Data flow:**
  1. `useEncryptedVault` loads vault bytes from IndexedDB.
  2. If encrypted, vault state becomes `encrypted` or `pin-locked`; UI shows unlock dialogs.
  3. Decryption uses OMS key request/response QR or Android intent callback.
  4. When unlocked, vault data is edited in UI and auto-saved to IndexedDB (encrypted or plain depending on settings).
  5. Export/import uses encrypted `.oms00` files or plain JSON.
- **External dependencies/integrations:**
  - OneMoreSecret app (for encryption/decryption operations via QR or Android intent).
  - GitHub Pages deployment (via `gh-pages`).

## 3. Tech Stack
- **Languages:** TypeScript, CSS.
- **Frameworks/Libraries:**
  - React 18 + React Router (`HashRouter`).
  - TanStack React Query for client-side query management.
  - shadcn/ui components built on Radix UI.
  - `idb` for IndexedDB, `jsonpath-plus` for references, `qrcode.react` for QR rendering.
  - `workbox-window` + `vite-plugin-pwa` for PWA support.
- **Build tools:** Vite, SWC plugin for React.
- **Styling:** Tailwind CSS + `tailwindcss-animate`.
- **Linting:** ESLint (typescript-eslint, react-hooks).
- **Testing:** No testing framework or tests found.
- **Storage:** IndexedDB (no backend/database server).

## 4. Directory Structure
- **`src/`**: Application source.
  - `main.tsx`: app bootstrap + service worker registration.
  - `App.tsx`: router + providers.
  - `pages/`: top-level pages (`Index`, `NotFound`).
  - `components/`: feature dialogs (decrypt, settings, password form) and reusable UI.
  - `components/ui/`: shadcn/Radix UI primitives.
  - `hooks/`: `useEncryptedVault`, `use-toast`, `use-mobile`.
  - `lib/`: crypto, IndexedDB schema, QR utilities, constants.
  - `types/`: domain types (vault, entries, settings, encryption envelopes).
- **`public/`**: icons, robots, placeholder assets.
- **`dist/`**: build output (generated).
- **Docs:** `README.md`, `getting_started.md`, `history.md`, `reference_to_another_entry.md`, `readme_images/`.

## 5. Key Entry Points
- **App entry:** `src/main.tsx` (React root, service worker registration).
- **Routing:** `src/App.tsx` uses `HashRouter` with `/` → `Index` and `*` → `NotFound`.
- **Main screen:** `src/pages/Index.tsx` (vault list, search, import/export, dialogs).
- **Dialogs and flows:** `DecryptQrDialog`, `PinUnlockDialog`, `PasswordForm`, `SettingsDialog`.
- **Service worker:** `src/sw.ts` (Workbox precache + SPA navigation route).

## 6. Core Concepts
- **Vault data model:**
  - `VaultData` = `{ entries: PasswordEntry[], settings: AppSettings }`.
  - `PasswordEntry` includes `customFields`, `history`, timestamps, and `passwordReadonly` marker for encrypted values.
  - `AppSettings` includes encryption parameters, public key, and `workspaceProtection` (`none`, `encrypt`, `pin`, `quickUnlock`).
- **Workspace protection states:**
  - `loading` → `encrypted` → `pin-locked` → `ready` (state machine in `useEncryptedVault`).
- **OMS encryption envelope:** RSA-wrapped AES key + AES-encrypted payload (compatible with OneMoreSecret).
- **Quick unlock:** Wraps vault AES key with a local AES-GCM key stored in IndexedDB to reduce unlock friction.
- **PIN lock:** Generates random PIN and encrypts vault with PBKDF2-derived AES key; PIN delivered via OMS QR.
- **References:** `oms4web://` + JSONPath expression to reference fields across entries.
- **Entry history:** Previous versions stored per entry, read-only from form history menu.

## 7. Development Patterns
- **Code organization:** Feature logic lives in hooks (`useEncryptedVault`) and lib files; UI is composed from dialog components and shadcn primitives.
- **Error handling:** Mostly client-side toasts (`use-toast`, Sonner) and console logging; import/export errors show toast messages.
- **Logging:** `console.log`/`console.error` in encryption and SW registration.
- **Configuration management:**
  - App constants in `src/lib/constants.ts`.
  - Build config in `vite.config.ts` (base path `SW_BASE` for GH Pages).
  - No `.env` files detected; uses `import.meta.env.BASE_URL` in service worker.
- **Authentication/authorization:** None. Entirely local-only; relies on OMS encryption for protection.

## 8. Testing Strategy
- **Tests:** No tests or testing framework found.
- **CI/CD:** No workflow configs detected; deployment is manual via `npm run deploy` (GitHub Pages).

## 9. Getting Started
- **Prerequisites:** Node.js + npm.
- **Install:** `npm install`.
- **Run locally:** `npm run dev` (Vite dev server on port 8080).
- **Build:** `npm run build` (or `npm run build:dev`).
- **Preview:** `npm run preview`.
- **Deploy to GitHub Pages:** `npm run deploy` (runs `npm run build` first).
- **User setup:** Provide OMS public key in Settings; otherwise encryption features are limited (see `getting_started.md`).

## 10. Areas of Complexity
- **Crypto envelope implementation:** RSA/AES envelope parsing and creation (OMS compatibility) in `src/lib/crypto.ts` and `fileEncryption.ts`.
- **Key request/response flow:** `keyRequest.ts` + `DecryptQrDialog` handle external decryption workflows and Android callbacks.
- **Vault state transitions:** `useEncryptedVault` manages multiple lock/unlock modes with IndexedDB persistence.
- **Quick unlock & PIN lock:** Dual workflows with stored wrapper keys and PBKDF2-derived AES keys.
- **Reference resolution:** JSONPath-based references in `applyRef` with protection inheritance.
