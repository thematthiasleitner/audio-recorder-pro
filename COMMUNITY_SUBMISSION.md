# Community Submission Prep

This plugin is prepared for an **initial** submission to the Obsidian Community Plugins directory.

## Before submitting

1. Publish this folder as its own GitHub repository.
2. Make sure `data.json` is **not committed**.
3. Push a tag that exactly matches `manifest.json.version` (currently `0.1.0`).
4. Confirm the GitHub draft release contains:
   - `main.js`
   - `manifest.json`
   - `styles.css`
5. Use `community-plugin-entry.template.json` as the payload source for `community-plugins.json`.

## PR target

- Repository: `obsidianmd/obsidian-releases`
- File: `community-plugins.json`
- Template: Community Plugin PR template (`.github/PULL_REQUEST_TEMPLATE/plugin.md`)
