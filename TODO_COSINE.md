add new file format to the merge function: 
- format name: keepass XML
- The corresponding xds is here: https://keepass.info/help/download/KDBX_XML.xsd 
- encrypt all fields with ProtectInMemory = true (if they are not alreay encrypted, i.e. start with oms00_...) immediately, similar to handleSubmit in PasswordForm