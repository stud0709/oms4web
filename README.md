# oms4web

> A lightweight, client-side web password manager for [OneMoreSecret](https://github.com/stud0709/OneMoreSecret).

🌐 **Live Web App:** [https://stud0709.github.io/oms4web/](https://stud0709.github.io/oms4web/)  
📖 **Documentation Wiki:** [https://github.com/stud0709/oms4web/wiki](https://github.com/stud0709/oms4web/wiki)  
📱 **OneMoreSecret Android App:** [https://github.com/stud0709/OneMoreSecret](https://github.com/stud0709/OneMoreSecret)  
🗺️ **Roadmap & Issues:** [https://github.com/stud0709/oms4web/issues](https://github.com/stud0709/oms4web/issues)

---

## Overview

**oms4web** provides a responsive web interface to manage your credentials on desktop or mobile while keeping master private keys securely stored inside the OneMoreSecret mobile app.

There is **zero backend**. All cryptographic operations execute locally in your browser using the standard Web Cryptography API, and data is stored in your browser's local IndexedDB.

### Key Features

- **Zero-Backend Architecture:** 100% client-side execution; your data stays entirely in your browser.
- **Air-Gapped & Direct Workflows:**
  - **Desktop:** Displays animated QR code sequences for air-gapped scanning by OneMoreSecret.
  - **Mobile:** Direct Android intent (`oms00://`) integration for one-tap decryption.
  - **Nostr Relay Pairing:** Wireless, real-time synchronization and one-click unlocking over Nostr relays without scanning QR codes.
- **Workspace Protection Modes:** Choose between in-place field protection, quick PIN Lock (PBKDF2), or full asymmetric RSA/AES workspace encryption.
- **Advanced Vault Capabilities:** Dynamic cross-entry linking (`oms4web://`), automatic revision history, and multi-format vault merging (`.json`, `.oms00`, KeePass `.xml`).
- **PWA & Offline Ready:** Full Progressive Web App support for standalone desktop and mobile installation.

---

## Documentation

Full user guides and technical documentation are available in the **[oms4web Wiki](https://github.com/stud0709/oms4web/wiki)**:

- 🚀 [Getting Started Guide](https://github.com/stud0709/oms4web/wiki/Getting-Started)
- 📻 [Nostr Connection & Wireless Pairing](https://github.com/stud0709/oms4web/wiki/Nostr-Connection)
- 🔒 [Workspace Security & Protection Modes](https://github.com/stud0709/oms4web/wiki/Workspace-Security-and-Protection)
- 🔗 [Cross-Entry References](https://github.com/stud0709/oms4web/wiki/Cross-Entry-References)
- 📜 [Entry History](https://github.com/stud0709/oms4web/wiki/Entry-History)
- 🔀 [Import & Merge (JSON, .oms00, KeePass XML)](https://github.com/stud0709/oms4web/wiki/Import-and-Merge)
- 🛠️ [Architecture & Developer Guide](https://github.com/stud0709/oms4web/wiki/Architecture-and-Development)

---

## Quick Start for Development

```bash
# Clone the repository
git clone https://github.com/stud0709/oms4web.git
cd oms4web

# Install dependencies
npm install

# Start local development server (runs on port 8080)
npm run dev

# Build for production
npm run build
```

## OMS v1 compatibility

Update OneMoreSecret, omsCompanion and oms4web together. New messages are bare Base64 containing a binary `%OMS-` marker and protocol version 1; new encrypted files use `.oms`. Existing `oms00_` messages, `.oms00` files and RSA keys remain usable. Recreate Nostr pairings after updating. Existing clients cannot read v1 output.

See the [wire specification](docs/protocol-v1.md), [legacy format](docs/protocol-v0.md), and [transition/release checklist](docs/protocol-transition.md).
