# Merge

The **Merge** action lets you **add entries from another file into your currently opened vault** without replacing what you already have.

## Where to find it

On the main vault screen, click the **Merge** button (the *Git merge* icon) in the top toolbar.

## What you can merge

Merge accepts these file types:

- **oms4web export JSON**: `.json`
- **Encrypted oms4web export**: `.oms00`
  - You’ll be prompted to decrypt it before merging.
- **KeePass XML export**: `.xml`

## How merging works (what you will see)

1. Click **Merge** and choose a file.
2. If the file is encrypted (`.oms00`), a decrypt dialog opens. After a successful decrypt, merging continues.
3. A confirmation dialog opens:
   - It shows how many entries will be added.
   - You can choose a **tag for merged entries**.
     - A default tag is suggested in the form `merged_YYYY_MM_DD`.
4. Click **Merge** to finish.

After merging:

- The imported entries are added to your vault (your existing entries remain unchanged).
- All merged entries receive the tag you chose (in addition to any tags they already had).

## KeePass XML notes

- KeePass entries are imported as new vault entries.
- KeePass group names are converted into tags (walking up parent groups).
- KeePass entry history is imported when present.
- If a KeePass field is marked as **protected** (e.g. password/custom fields with `ProtectInMemory="True"`), oms4web needs its **"password generator & encryption"** setting enabled to import it as a protected value. Otherwise, merge is blocked and you’ll be prompted to enable that setting.

## Duplicate/Collision behavior

- If a merged entry’s internal ID conflicts with an existing entry, oms4web automatically assigns a new ID to the merged entry.
- Merge does **not** try to detect “same login/site” duplicates. If the other file contains entries that look similar to yours, they will still be added as separate entries.

## Troubleshooting

- **“Unknown file format, cannot merge”**: the selected file is not a supported JSON export, `.oms00` file, or KeePass XML export.
- **“Cannot merge KeePass XML”**: enable **"password generator & encryption"** in Settings if the KeePass file contains protected fields.
