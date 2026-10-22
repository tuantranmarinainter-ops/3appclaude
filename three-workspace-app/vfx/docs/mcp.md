# MCP server

`effekseer-ai-mcp` runs a local stdio MCP server. It does not open a network listener and does not send effect data to a remote service.

## Client configuration

Configure an MCP client to run this command:

```text
command: effekseer-ai-mcp
environment:
  EFFEKSEER_AI_BIN_DIR: <Effekseer-install>/Tool/bin
```

The client must inherit the virtual environment where `effekseer-ai` was installed, or use the absolute path to `effekseer-ai-mcp` in that environment.

## Tools

| Area | Tools |
| --- | --- |
| Document | `effect_new`, `effect_open`, `effect_save`, `effect_export` |
| Nodes | `node_list`, `node_add`, `node_rename`, `node_remove`, `node_move` |
| Properties | `property_list`, `property_get`, `property_set` |
| Images | `asset_import_image` |
| Settings and curves | `settings_list`, `settings_set`, `curve_list`, `curve_set` |

The server keeps one effect document in memory per process. Use `effect_new` or `effect_open` before invoking tools that modify or inspect the current document. Call `effect_save` after changes to persist them.

## Agent guidance

Use `property_list` or `settings_list` before writing an unfamiliar field. Validate exported `.efk` files in your target runtime and inspect the effect across its complete duration; successful save or export confirms file structure, not visual quality.
