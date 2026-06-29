# Changelog

## 0.2.0

- Tree generation now respects the workspace `.gitignore` (toggle via `chatbotToAgent.useGitignore`).
- Added an optional "Exclude from tree" input to omit specific paths.
- The exclude input supports glob/wildcard patterns such as `*.wav`, `**/*.png`, plus folder paths (comma-separated).

## 0.1.1

- Renamed extension from "Context Template Builder" to "Chatbot to Agent".
- Updated command IDs and configuration namespace to `chatbotToAgent.*`.
- Updated user-facing titles, messages, and webview heading.

## 0.1.0

- Initial release.
- Webview builder: question textarea, file attachments, codebase tree toggle.
- Attach files via picker, open editors, or Explorer right-click.
- Output to new tab, clipboard, or `context.md`.
- Configurable ignore patterns, tree depth, and max file size.
