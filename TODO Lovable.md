 # How to use this file
 Read through the file and implement the instructions. 
 
 Create a report in Markdown format in the same folder. Filename "DONE Lovable <timestamp>.md". Comment on every topic: list of affected files, short description of what was changed. 

 Commit to github after every topic.

 When ready, clear this file's TODO section.

 # TODO
 
 ## Correct behavior of workspace protection settings.
 - when switching from 'encrypt' to a different mode, save local storage as an unprotected json file as soon as user saves the settings
 - when switching to 'encrypt' from another mode, save local storage as an encrypted file as soon as user saves the settings

## Introduce checks when saving the settings
- show warning if workspace protection mode is 'pin' or 'encrypt', but no public key defined. Do not allow to save the settings
- same if password encryption is activated

## Enhancement to "Lock workspace" button behavior
- show warning and return if no public key defined in settings

## DecryptQrDialog: behavior on ENTER
- listen for ENTER when user is entering key response into DecryptQrDialog. ENTER should trigger "Decrypt vault" functionality

 