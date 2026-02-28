in Index.tsx, add a new button to the toolbar: "merge". It shall
- display "open file" dialog
- detect file format (currently, plain or encrypted (.oms00) oms4web JSON file)
- display "ready to merge" dialog, suggesting a tag, that will mark all merged entries: "merged_YYYY_MM_DD" with the current date. If file format was unknown, display a toast "unknown file format, cannot merge".
- for encrypted oms4web, decrypt first
- add entries to the currently loaded vaultData, mark them with the tag described above
- show toast: merge successful
