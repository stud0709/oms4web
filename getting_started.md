# Getting Started

*oms4web* is a password manager tightly integrated with *OneMoreSecret*. It's a responsive app, so you can use it on your desktop and on your mobile.
- on the decktop, the app will show QR-code sequences for encrypted content to be scanned by *OneMoreSecret*
- on your Android device, oms4web will trigger *OneMoreSecret* directly

✅ *oms4web* cannot read the passwords on its own. It will know your user name and other unencrypted stuff though.  

![appearance on mobile](./readme_images/mobile_appearance.jpg)

- On your mobile, ![webhook](./readme_images/webhook.png) will trigger *OneMoreSecret* if smth. needs to be decrypted. 
- On desktop, use ![qr-code](readme_images/qr-code.png) and scan the QR code sequence instead.

## WARNING
*oms4web* runs locally on your device, be it a desktop computer or a mobile. The data is stored in the browser's IndexDB, bad things can happen anytime. So...

⚠️ BACKUP YOUR DATA ⚠️

You can do it at any time using the download button ![download](readme_images/download.png). You can also upload your backup with the upload button ![upload](readme_images/upload.png). 

## Setting things up
Go to the settings dialog ![settings](readme_images/settings.png). The most important step is providing the public key. The public key export is described in *OneMoreSecret* [documentation](https://github.com/stud0709/OneMoreSecret/blob/master/key_management.md). TLDR: 
- go to ⋮ -> Settings -> Private Keys
- long-press private key entry in the list
- on Android: copy&paste it, on desktop: have *OneMoreSecret* [auto-type](https://github.com/stud0709/OneMoreSecret/blob/master/autotype.md) it.

You can use the app without public key as well. In this case, the in-place encryption will not be available. For password field, you will only be able to enter already encrypted data [generated](https://github.com/stud0709/OneMoreSecret/blob/master/password_generator.md) by *OneMoreSecret* (oms00_....). Your password database as a whole will not be encrypted either.

## Note on password generator and encryption
Technically, if you generate passwords in oms4web, they will be only encrypted on save. If you don't want that, do not enable password generator in the settings and generate your passwords in *OneMoreSecret*. 

## Other topics
- [Linking fields](reference_to_another_entry.md)
- [Entry history](history.md) 
- [Importing other formats / Merging](merge.md)

## One last hint
Consider installing *oms4web* as a [web app](https://support.google.com/chrome/answer/9658361?hl=en&co=GENIE.Platform%3DDesktop). This makes it more convenient to use and allows tighter integration with the operation system.

You might also want to have a look at the [README](./README.md) file.