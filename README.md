# Chatbot to Agent (VS Code Extension)

A small VS Code extension that let you use your chatbot like a coding agent. It helps you prepare a single, ready-to-paste context file
for your LLM chatbot. You type your question, attach the relevant files, and the
extension produces a filled `context-template.md` containing:

1. **Task / Question** — what you typed.
2. **Codebase Tree** — an auto-generated tree of your workspace (ignoring `node_modules`, `.git`, etc.).
3. **Relevant File Contents** — the full contents of the files you attached, each in a fenced code block.

## Why?

Coding agents have become a de facto standard for software development, but they are not accessible to everyone for different reasons such as:
- High cost for entry level and independent developers
- Some companies restrict access to LLM APIs for security reasons while providing access to a local chatbot

## Install

### Option A — Package & install a `.vsix` (recommended)

Requires [Node.js](https://nodejs.org/).

```bash
# from inside the chatbot-to-agent/ folder
npx @vscode/vsce package
# -> produces chatbot-to-agent-0.1.0.vsix

code --install-extension chatbot-to-agent-0.1.0.vsix
```

Or in VS Code: **Extensions view → "..." menu → Install from VSIX…** and pick the file.

> If `vsce` shows warnings about the placeholder `repository` field, you can ignore them
> or edit `package.json`.

### Option B — Run from source (development)

1. Open the `chatbot-to-agent/` folder in VS Code.
2. Press **F5** to launch an Extension Development Host window with the extension loaded.

## Usage

1. Open the Command Palette (`Ctrl/Cmd+Shift+P`) and run **"Context Template: Open Builder"**.
2. Type your **Task / Question**.
3. Attach files using any of these:
   - **Add files…** button (multi-select picker of workspace files), or
   - **Add open editors** button, or
   - Right-click files in the Explorer → **"Context Template: Add File to Builder"**.
4. (Optional) Toggle **Include codebase tree** and pick an **Output** mode.
5. Click **Generate**.
6. Paste/attach the generated markdown into your LLM chat.

## Output modes

| Mode | Behavior |
|------|----------|
| Open in new tab | Opens the filled template in a new untitled Markdown editor. |
| Copy to clipboard | Copies the filled template to your clipboard. |
| Save as context.md | Writes `context.md` to the workspace root and opens it. |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `contextTemplate.ignore` | `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `.vscode`, `__pycache__`, `.venv`, `venv`, `*.log`, `*.lock` | Names / `*.ext` patterns excluded from the tree and file picker. |
| `contextTemplate.maxTreeDepth` | `8` | Maximum directory depth in the generated tree. |
| `contextTemplate.maxFileSizeKB` | `200` | Files larger than this are listed but their contents are skipped. |

## Notes

- The generated file uses dynamic code-fence lengths, so files that themselves contain
  triple backticks won't break the Markdown.
- This extension is local/unsigned; the `publisher` is set to `local-dev` for VSIX install.
