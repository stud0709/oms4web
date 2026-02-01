# How to use this file
Read through the file and implement the instructions. 

Commit to github after every topic.

Create comments on every processed topic appending the [report file](DONE_Lovable.md): 
- timestamp
- copy of the processed topic
- list of affected files
- short description of what was changed
- commit ID. 

When ready, clear this file's TODO section.

# TODO

## Default settings
- workspace protection: None

## Introduce checks when saving the settings
- show warning if workspace protection mode is 'pin' or 'encrypt', but no public key defined. Do not allow to save the settings
- same if password encryption is activated

## Enhancement to "Lock workspace" button behavior
- show warning and return if no public key defined in settings

## DecryptQrDialog: behavior on ENTER
- listen for ENTER when user is entering key response into DecryptQrDialog. ENTER should trigger "Decrypt vault" functionality

 