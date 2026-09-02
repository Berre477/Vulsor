# Vulsor Vault — Claude access

Lets **Claude read and write your Vault** — the notes and files you see in the
app's Vault tab — plus Obsidian-style `[[wikilinks]]` between them.

## What you get

- **Claude writes files into the Vault.** Anything it generates — a note, a
  script, an HTML page, a CSV — lands in the Vault as a real file, in the
  folder you name.
- **They appear live.** The app watches the index, so a file Claude creates
  shows up in the grid straight away, with a toast saying what arrived. No need
  to click away and back.
- **`[[wikilinks]]`** in markdown notes — type `[[Some Note]]` and it becomes a
  clickable link. Click an unknown link to create that note.
- **Backlinks** — every markdown note lists the notes linked to it at the bottom.
- Two ways in: Vulsor's own in-app AI has vault tools, and Claude Code /
  Claude Desktop use the MCP server below.

## Storage

Everything lives where the app already keeps your data:

- `~/Documents/Vulsor_Memories/vault.json` — the index (files, folders, **links**)
- `~/Documents/Vulsor_Memories/vault/` — the file bodies (`.md`, `.py`, `.pdf`, …)

Files Claude creates are written exactly the way the app writes its own, so
they're ordinary files on disk and stay portable.

## MCP server

Zero dependencies — just Node. The server is `server/vault-mcp.js`.

### Claude Code (this project)

A project-scoped `.mcp.json` is already committed at the repo root, so when you
open this folder in Claude Code it will offer to enable the **vulsor-vault**
server.

To register it globally instead (any folder), with the Claude Code CLI:

```bash
claude mcp add vulsor-vault -- node /path/to/VulsorApp/server/vault-mcp.js
```

### Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`
inside a top-level `"mcpServers"` object (create the key if it isn't there),
then restart Claude Desktop:

```json
{
  "mcpServers": {
    "vulsor-vault": {
      "command": "node",
      "args": ["/path/to/VulsorApp/server/vault-mcp.js"]
    }
  }
}
```

### Tools exposed

Writing files in:

| Tool | What it does |
|------|--------------|
| `vault_write_file` | Write **any** text file — `.py`, `.html`, `.csv`, `.json`, `.md`. The extension decides how the app opens it |
| `vault_add_file` | Copy a file that already exists on disk in, binaries included (PDF, image, docx) |
| `vault_create_note` | Create a markdown note (use `[[Other Note]]` to link) |
| `vault_edit_note` | Replace a note's content |
| `vault_append_note` | Append to a note |

Finding your way around:

| Tool | What it does |
|------|--------------|
| `vault_list` | List every file, or just one folder's |
| `vault_search` | Search by name or content |
| `vault_read` | Read a note's text |
| `vault_folders` | List folders as `Parent/Child` paths, with file counts |
| `vault_create_folder` | Create a folder |
| `vault_move` | Move a file into a folder |
| `vault_link` / `vault_unlink` | Connect / disconnect two files |
| `vault_backlinks` | List notes connected to one note |
| `vault_graph` | Summarise the links (counts + most-connected notes) |

Every tool that puts a file somewhere takes a `folder` — a folder name, a
`Parent/Child` path, or an id. Leave it out and the file lands in **All Files**.
An unknown folder name is an error rather than a silent drop into the root.

### Quick check

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vault_folders","arguments":{}}}' \
  | node server/vault-mcp.js
```

## Notes for the app side (renderer)

- `js/vault.js` — `vaultStartWatching()` picks up outside writes; `renderVaultMarkdown`
  renders `[[...]]`; the markdown viewer appends a backlinks panel; files dropped
  in from Finder land in the folder they were dropped on.
- `js/vault-graph.js` — wikilinks, backlinks, the manual-link store.
- `js/jarvis.js` — the in-app AI's `vault_*` tools.
