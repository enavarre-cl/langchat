# Contributing to Lang Chat

## Develop & run

```bash
npm install
npm run compile        # tsc → out/
```

Open the folder in VS Code and press **F5** (the “Run Extension” launch config). An *Extension
Development Host* window opens with the extension loaded. Create a chat from the command palette
(`Cmd/Ctrl+Shift+P`) → **“Lang Chat: New chat”**, or open any file with the `.chat` extension.

> Reloading the dev host (**⌘R / Ctrl+R**) is required after changing `package.json` (commands,
> menus, views) or the extension host code.

## Validation (run after changes)

```bash
npm run compile                 # tsc
npx eslint src                  # 0 errors / 0 warnings
node --check media/*.js         # webview JS syntax (not linted)
node --test out/test/*.test.js  # test suite
```

For `package.json`: keep the `%nls%` placeholders in sync with `package.nls*.json`, and ensure
every menu command is declared in `contributes.commands`.

## Spell‑check assets

The bundled Hunspell dictionaries and the `nspell` engine are regenerated with:

```bash
npm run build:spell
```

(Dev deps: `nspell`, `dictionary-es`, `dictionary-en`, `esbuild`.) Keep the `media/dict/*.LICENSE`
files alongside the dictionaries.

## Packaging a `.vsix`

```bash
npm install -g @vscode/vsce
vsce ls          # review what will be packaged (respects .vscodeignore)
vsce package     # produces lang-chat-<version>.vsix
```

Install it via **Extensions → Install from VSIX…**. CI (Azure DevOps, `azure-pipelines.yml`) also
builds the `.vsix` as a pipeline artifact.

## Publishing

See **`plan-publish.md`** for the full Marketplace publishing plan (publisher setup, licensing,
metadata and the `vsce publish` / Open VSX steps).
