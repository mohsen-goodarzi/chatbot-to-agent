const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/** @type {vscode.WebviewPanel | undefined} */
let panel;
/** @type {{ rel: string, abs: string }[]} */
let attachedFiles = [];

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('chatbotToAgent.open', () => openPanel(context)),
    vscode.commands.registerCommand('chatbotToAgent.addSelectedFile', (uri, uris) => {
      const targets = uris && uris.length ? uris : uri ? [uri] : [];
      if (!targets.length) {
        vscode.window.showInformationMessage('Chatbot to Agent: no file selected.');
        return;
      }
      openPanel(context);
      addUris(targets);
    })
  );
}

function deactivate() {}

/* ---------- helpers ---------- */

function getWorkspaceFolder() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0] : undefined;
}

function toRel(abs) {
  const wf = getWorkspaceFolder();
  if (!wf) return abs;
  return path.relative(wf.uri.fsPath, abs).split(path.sep).join('/');
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('chatbotToAgent');
  return {
    ignore: cfg.get('ignore') || [],
    maxTreeDepth: cfg.get('maxTreeDepth') || 8,
    maxFileSizeKB: cfg.get('maxFileSizeKB') || 200,
    useGitignore: cfg.get('useGitignore') !== false
  };
}

function isIgnored(name, ignore) {
  return ignore.some(function (pattern) {
    if (pattern.startsWith('*.')) return name.endsWith(pattern.slice(1));
    return name === pattern;
  });
}

function buildExcludeGlob(ignore) {
  const parts = ignore.map(function (p) {
    return p.startsWith('*.') ? '**/' + p : '**/' + p + '/**';
  });
  return '{' + parts.join(',') + '}';
}

function loadGitignorePatterns(rootDir) {
  const patterns = [];
  try {
    const content = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
    content.split(/\r?\n/).forEach(function (line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.charAt(0) === '#') return;
      patterns.push(trimmed);
    });
  } catch (e) { /* no .gitignore */ }
  return patterns;
}

function globToRegex(pattern, anchored) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.indexOf(c) !== -1) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  const prefix = anchored ? '^' : '(^|/)';
  return new RegExp(prefix + re + '($|/)');
}

function buildGitignoreMatcher(patterns) {
  if (!patterns.length) return null;
  const rules = patterns.map(function (raw) {
    let pattern = raw;
    let negated = false;
    if (pattern.charAt(0) === '!') { negated = true; pattern = pattern.slice(1); }
    let dirOnly = false;
    if (pattern.slice(-1) === '/') { dirOnly = true; pattern = pattern.slice(0, -1); }
    let anchored = false;
    if (pattern.charAt(0) === '/') { anchored = true; pattern = pattern.slice(1); }
    if (pattern.indexOf('/') !== -1) anchored = true;
    return { regex: globToRegex(pattern, anchored), negated: negated, dirOnly: dirOnly };
  });
  return function (relPath, isDir) {
    let ignored = false;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.dirOnly && !isDir) continue;
      if (r.regex.test(relPath)) ignored = !r.negated;
    }
    return ignored;
  };
}

function normalizeExcludePaths(input) {
  if (!input) return [];
  return String(input)
    .split(',')
    .map(function (p) {
      return p.trim().replace(/^[.][/]/, '').replace(/^[/]+/, '').replace(/[/]+$/, '');
    })
    .filter(function (p) { return p.length > 0; });
}

function buildTree(dir, prefix, ctx, depth) {
  let result = '';
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return '';
  }
  entries = entries.filter(function (e) {
    if (isIgnored(e.name, ctx.ignore)) return false;
    const rel = path.relative(ctx.root, path.join(dir, e.name)).split(path.sep).join('/');
    if (ctx.excludeMatch && ctx.excludeMatch(rel, e.isDirectory())) return false;
    if (ctx.gitignoreMatch && ctx.gitignoreMatch(rel, e.isDirectory())) return false;
    return true;
  });
  entries.sort(function (a, b) {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });
  entries.forEach(function (entry, idx) {
    const isLast = idx === entries.length - 1;
    const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
    result += prefix + connector + entry.name + (entry.isDirectory() ? '/' : '') + '\n';
    if (entry.isDirectory() && depth < ctx.maxDepth) {
      const newPrefix = prefix + (isLast ? '    ' : '\u2502   ');
      result += buildTree(path.join(dir, entry.name), newPrefix, ctx, depth + 1);
    }
  });
  return result;
}

function langFromExt(file) {
  const base = path.basename(file).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'jsx',
    '.ts': 'typescript', '.tsx': 'tsx', '.py': 'python', '.rb': 'ruby', '.go': 'go',
    '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.c': 'c', '.h': 'c',
    '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp', '.cs': 'csharp', '.php': 'php',
    '.swift': 'swift', '.m': 'objectivec', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.ini': 'ini',
    '.xml': 'xml', '.html': 'html', '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.sql': 'sql', '.md': 'markdown', '.vue': 'vue', '.dart': 'dart', '.r': 'r',
    '.lua': 'lua', '.pl': 'perl', '.ex': 'elixir', '.exs': 'elixir', '.scala': 'scala',
    '.env': 'bash', '.gradle': 'groovy', '.tf': 'hcl'
  };
  return map[ext] || '';
}

function fenceFor(content) {
  const matches = content.match(/`+/g) || [];
  let max = 0;
  for (let i = 0; i < matches.length; i++) max = Math.max(max, matches[i].length);
  return '`'.repeat(Math.max(3, max + 1));
}

function readFileSafe(abs, maxKB) {
  try {
    const stat = fs.statSync(abs);
    if (stat.size > maxKB * 1024) {
      return '// [skipped: file is ' + Math.round(stat.size / 1024) + ' KB, exceeds ' + maxKB + ' KB limit]';
    }
    return fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return '// [error reading file: ' + e.message + ']';
  }
}

function fillTemplate(question, treeText, files) {
  const lines = [];
  lines.push('# Coding Task Context');
  lines.push('');
  lines.push('## 1. Task / Question');
  lines.push('');
  lines.push(question && question.trim() ? question.trim() : '_(describe your task here)_');
  lines.push('');
  lines.push('## 2. Codebase Tree');
  lines.push('');
  if (treeText && treeText.trim()) {
    const f = fenceFor(treeText);
    lines.push(f + 'text');
    lines.push(treeText.replace(/\s+$/, ''));
    lines.push(f);
  } else {
    lines.push('_(tree not included)_');
  }
  lines.push('');
  lines.push('## 3. Relevant File Contents');
  lines.push('');
  if (!files.length) {
    lines.push('_(no files attached)_');
  } else {
    files.forEach(function (file) {
      lines.push('### `' + file.rel + '`');
      lines.push('');
      const f = fenceFor(file.content);
      lines.push(f + langFromExt(file.rel));
      lines.push(file.content.replace(/\s+$/, ''));
      lines.push(f);
      lines.push('');
    });
  }
  lines.push('');
  return lines.join('\n');
}

/* ---------- file selection ---------- */

function addUris(uris) {
  uris.forEach(function (uri) {
    try {
      const stat = fs.statSync(uri.fsPath);
      if (stat.isDirectory()) return;
      const abs = uri.fsPath;
      if (!attachedFiles.find(function (f) { return f.abs === abs; })) {
        attachedFiles.push({ rel: toRel(abs), abs: abs });
      }
    } catch (e) { /* ignore */ }
  });
  postFiles();
}

async function pickFiles() {
  const wf = getWorkspaceFolder();
  if (!wf) {
    vscode.window.showErrorMessage('Chatbot to Agent: open a folder or workspace first.');
    return;
  }
  const cfg = getConfig();
  const uris = await vscode.workspace.findFiles('**/*', buildExcludeGlob(cfg.ignore), 5000);
  const items = uris
    .map(function (u) { return { label: toRel(u.fsPath), uri: u }; })
    .sort(function (a, b) { return a.label.localeCompare(b.label); });
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select files to attach to the context'
  });
  if (picked) addUris(picked.map(function (p) { return p.uri; }));
}

function getOpenEditorUris() {
  const uris = [];
  vscode.window.tabGroups.all.forEach(function (group) {
    group.tabs.forEach(function (tab) {
      const input = tab.input;
      if (input && input.uri && input.uri.scheme === 'file') uris.push(input.uri);
    });
  });
  return uris;
}

/* ---------- generation ---------- */

async function generate(question, includeTree, outputMode, excludePath) {
  const cfg = getConfig();
  const wf = getWorkspaceFolder();
  let treeText = '';
  if (includeTree && wf) {
    const root = path.basename(wf.uri.fsPath);
    const ctx = {
      root: wf.uri.fsPath,
      ignore: cfg.ignore,
      maxDepth: cfg.maxTreeDepth,
      excludeMatch: buildGitignoreMatcher(normalizeExcludePaths(excludePath)),
      gitignoreMatch: cfg.useGitignore
        ? buildGitignoreMatcher(loadGitignorePatterns(wf.uri.fsPath))
        : null
    };
    treeText = root + '/\n' + buildTree(wf.uri.fsPath, '', ctx, 0);
  }
  const files = attachedFiles.map(function (f) {
    return { rel: f.rel, content: readFileSafe(f.abs, cfg.maxFileSizeKB) };
  });
  const output = fillTemplate(question, treeText, files);

  if (outputMode === 'clipboard') {
    await vscode.env.clipboard.writeText(output);
    vscode.window.showInformationMessage('Context copied to clipboard.');
  } else if (outputMode === 'save' && wf) {
    const target = vscode.Uri.joinPath(wf.uri, 'context.md');
    fs.writeFileSync(target.fsPath, output, 'utf8');
    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    vscode.window.showInformationMessage('Context saved to context.md');
  } else {
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: output });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }
}

/* ---------- webview ---------- */

function openPanel(context) {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One);
    postFiles();
    return;
  }
  panel = vscode.window.createWebviewPanel(
    'chatbotToAgent',
    'Chatbot to Agent',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = getHtml(getNonce());
  panel.onDidDispose(function () { panel = undefined; }, null, context.subscriptions);
  panel.webview.onDidReceiveMessage(async function (msg) {
    switch (msg.command) {
      case 'pickFiles':
        await pickFiles();
        break;
      case 'addOpenEditors':
        addUris(getOpenEditorUris());
        break;
      case 'removeFile':
        attachedFiles = attachedFiles.filter(function (f) { return f.rel !== msg.rel; });
        postFiles();
        break;
      case 'clearFiles':
        attachedFiles = [];
        postFiles();
        break;
      case 'generate':
        await generate(msg.question, msg.includeTree, msg.outputMode, msg.excludePath);
        break;
    }
  }, undefined, context.subscriptions);
  postFiles();
}

function postFiles() {
  if (panel) {
    panel.webview.postMessage({
      command: 'setFiles',
      files: attachedFiles.map(function (f) { return f.rel; })
    });
  }
}

function getNonce() {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function getHtml(nonce) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Chatbot to Agent</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 14px; }
  h2 { font-size: 1.15em; margin: 0 0 6px; }
  .hint { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin: 0 0 14px; }
  .section-label { font-weight: 600; margin-top: 14px; display: block; }
  textarea { width: 100%; box-sizing: border-box; min-height: 130px; margin-top: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
    padding: 8px; font-family: var(--vscode-font-family); resize: vertical; }
  input[type="text"] { width: 100%; box-sizing: border-box; margin-top: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
    padding: 6px 8px; font-family: var(--vscode-font-family); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 10px 0; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.generate { font-weight: 600; }
  ul { list-style: none; padding: 0; margin: 6px 0; border: 1px solid var(--vscode-panel-border, #8884);
    border-radius: 4px; max-height: 240px; overflow: auto; }
  li { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, #8884); }
  li:last-child { border-bottom: none; }
  li.empty { color: var(--vscode-descriptionForeground); justify-content: flex-start; }
  .path { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; word-break: break-all; }
  button.remove { background: transparent; color: var(--vscode-foreground); padding: 0 6px; font-size: 1em; }
  button.remove:hover { color: var(--vscode-errorForeground, #f55); background: transparent; }
  label { font-size: 0.9em; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, transparent); border-radius: 4px; padding: 4px 6px; }
</style>
</head>
<body>
  <h2>Chatbot to Agent</h2>
  <p class="hint">Describe your task, attach the relevant files, then generate a ready-to-paste context file for your LLM coding agent.</p>

  <label class="section-label" for="question">Task / Question</label>
  <textarea id="question" placeholder="Describe what you want the coding agent to do..."></textarea>

  <label class="section-label">Attached files</label>
  <div class="row">
    <button id="addFiles">Add files\u2026</button>
    <button id="addOpen" class="secondary">Add open editors</button>
    <button id="clear" class="secondary">Clear</button>
  </div>
  <ul id="fileList"></ul>
  <p class="hint">Tip: you can also right-click files in the Explorer &rarr; "Chatbot to Agent: Add File to Builder".</p>

  <div class="row">
    <label><input type="checkbox" id="includeTree" checked> Include codebase tree</label>
  </div>
  <label class="section-label" for="excludePath">Exclude from tree (optional)</label>
  <input type="text" id="excludePath" placeholder="e.g. src/generated, *.wav, **/*.png (comma-separated)">
  <p class="hint">Supports glob patterns (<code>*.wav</code>, <code>**/*.png</code>) and paths. Files in <code>.gitignore</code> are excluded automatically.</p>

  <div class="row">
    <label for="outputMode">Output:</label>
    <select id="outputMode">
      <option value="newTab">Open in new tab</option>
      <option value="clipboard">Copy to clipboard</option>
      <option value="save">Save as context.md</option>
    </select>
    <button id="generate" class="generate">Generate</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const qEl = document.getElementById('question');
    const listEl = document.getElementById('fileList');
    const treeEl = document.getElementById('includeTree');
    const outEl = document.getElementById('outputMode');
    const excludeEl = document.getElementById('excludePath');
    let files = [];

    const prev = vscode.getState() || {};
    if (prev.question) qEl.value = prev.question;
    if (typeof prev.includeTree === 'boolean') treeEl.checked = prev.includeTree;
    if (prev.outputMode) outEl.value = prev.outputMode;
    if (prev.excludePath) excludeEl.value = prev.excludePath;

    function saveState() {
      vscode.setState({
        question: qEl.value,
        includeTree: treeEl.checked,
        outputMode: outEl.value,
        excludePath: excludeEl.value
      });
    }
    qEl.addEventListener('input', saveState);
    treeEl.addEventListener('change', saveState);
    outEl.addEventListener('change', saveState);
    excludeEl.addEventListener('input', saveState);

    function render() {
      listEl.innerHTML = '';
      if (files.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'No files attached yet.';
        listEl.appendChild(li);
        return;
      }
      files.forEach(function (rel) {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = rel;
        span.className = 'path';
        const btn = document.createElement('button');
        btn.textContent = '\u2715';
        btn.title = 'Remove';
        btn.className = 'remove';
        btn.addEventListener('click', function () {
          vscode.postMessage({ command: 'removeFile', rel: rel });
        });
        li.appendChild(span);
        li.appendChild(btn);
        listEl.appendChild(li);
      });
    }

    document.getElementById('addFiles').addEventListener('click', function () {
      vscode.postMessage({ command: 'pickFiles' });
    });
    document.getElementById('addOpen').addEventListener('click', function () {
      vscode.postMessage({ command: 'addOpenEditors' });
    });
    document.getElementById('clear').addEventListener('click', function () {
      vscode.postMessage({ command: 'clearFiles' });
    });
    document.getElementById('generate').addEventListener('click', function () {
      vscode.postMessage({
        command: 'generate',
        question: qEl.value,
        includeTree: treeEl.checked,
        outputMode: outEl.value,
        excludePath: excludeEl.value
      });
    });

    window.addEventListener('message', function (event) {
      const msg = event.data;
      if (msg.command === 'setFiles') {
        files = msg.files || [];
        render();
      }
    });

    render();
  </script>
</body>
</html>`;
}

module.exports = { activate: activate, deactivate: deactivate };
