# Chatbot source documents

Drop the files you want the `/chat` assistant to answer from here — `.txt`, `.md`, `.pdf`, or `.docx`.
Legacy `.doc` (pre-2007 Word binary format) isn't supported; save as `.docx` instead.

The server reads this folder on each chat request and reloads a file automatically if its
contents change, so no restart is needed after adding, editing, or removing a document.

The assistant only answers using text found in these files — anything not covered here gets a
"don't have that information" reply instead of a guess.
