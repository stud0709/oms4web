# Entry History

This document describes how entry history works in oms4web.

## Overview

Each password entry keeps a history of previous versions. Every time an entry is updated, the current data is captured and stored in the entry’s `history` array with a timestamp. This lets you review older versions of the entry from within the edit dialog.

## Data Model

Entries contain a `history` array:

- `PasswordEntry.history`: list of `PasswordEntryHistoryItem` objects.
- Each history item stores:
  - `timestamp`: when the snapshot was captured.
  - `data`: the entry data at that moment.

## UI Behavior

The history menu is shown in the entry form header (next to the dialog title).

- **Current version**: switches back to the editable current entry data.
- **Historical version**: loads the selected snapshot into the form in read-only mode.

When a historical version is selected:

- All fields become read-only.
- Buttons that would change data are hidden or disabled.
- The “Save Changes” button is disabled.
- The dialog title shows “Entry History” plus the selected timestamp in a muted style.
- Placeholders are set to a single space to avoid overlapping hint text.

## Notes

- History is stored locally as part of the entry object and is included in exports.
- History entries are ordered with the most recent snapshot first.
