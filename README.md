# oms4web - a password manager for OmsCompanion
⚠️ This is a very early version of the software compatible with [OneMoreSecret](https://github.com/stud0709/OneMoreSecret) *beta* versions.

This project started on Christmas 2025 as a vibe coding experiment. [Lovable.dev](https://lovable.dev/) did a great job to get things started, but with the exceeding complexity, things under the hood became increasingly messy, and I have been taking back control over the code since then. But I remain a heavy user of LLMs when it comes to coding.

The webapp is online at https://stud0709.github.io/oms4web/

The Getting Started manual is [here](./getting_started.md)

For the roadmap, see [issues](https://github.com/stud0709/oms4web/issues)

## Features

### Password manager with QR-code integration

*OneMoreSecret* has been updated to beta version, as some internal logic had to be changed to allow Android - JavaScript compatibility. *oms4web* provides the necessary QR interface out of the box, so you can use it with *OneMoreSecret* without additional software (like [omsCompanion](https://github.com/stud0709/oms_companion))

### Local data storage
Data is encrypted and stored locally in the browser database (indexDB). Encryption is enabled as soon as you have set up your public key in the app settings.  

⚠️ Export your data regularly, as indexDB is cleared every time you clear your browser's cache.

There is no back-end at all, the entire logic runs in your browser.

### Different workspace protection modes
- None - this does not affect password / field encryption though, these are always protected.
- Lock: your database is encrypted with a temporary AES key
- Encrypt: the encrypted version of the workspace is loaded into the app, you decrypt it to unlock the workspace (this is slightly more time-consuming than locking, but more secure)

## Security considerations
Not even your [thoughts](https://www.euronews.com/next/2025/08/15/a-brain-computer-chip-can-read-peoples-minds-with-up-to-74-accuracy) are private novadays. A JavaScript with dozens of [dependencies](https://martijnhols.nl/blog/the-security-risks-of-front-end-dependencies) has never been secure. But it's probably secure enough for the most use cases with the existing protection mechanisms in ths browser and your understanding of the security risks.

✅ The public key you pass to the settings can NOT be used to decrypt your data, it's part of [RSA](https://www.geeksforgeeks.org/computer-networks/rsa-algorithm-cryptography/) algorithm.

⚠️ It goes without saying, that the *oms4web* internal password generator / field encryption has access to the unencrypted version of your data. If you don't want that, generate your passwords in *OneMoreSecret*, you can then have the app TYPE its encrypted version into the entry form. 

✅ The entire workspace data is encrypted by your private key, that's why you have to unlock it first.

👉 The *Lock Workspace* protection generates a temporary AES key and encrypts your workspace. The one-time password to unlock is passed to your *OneMoreSecret* app in the usual manner, but it takes less time than decryption of the workspace. With AES key being generated in the browser, it is potentially *less* secure than workspace encryption.

The following is the original README file content by [Lovable.dev](https://lovable.dev/)

# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
