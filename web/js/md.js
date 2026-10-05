// A tiny Markdown renderer for lessons and Ferris' speech (safe: escapes all HTML).
import { escapeHtml, highlightRust } from "./editor.js";

function inline(text) {
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return s;
}

function table(lines) {
  const cells = l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  const head = cells(lines[0]);
  const body = lines.slice(2).map(cells);
  return `<table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body
    .map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function blocks(text, soft) {
  const lines = text.split("\n");
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      const t = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) t.push(lines[i++]);
      html += table(t);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) { html += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`; i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      html += `<${tag}>${items.map(it => `<li>${inline(it)}</li>`).join("")}</${tag}>`;
      continue;
    }
    // A paragraph always takes its first line, so a stray "|" line (e.g. a half-streamed
    // table) can never stall the parser.
    const para = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^#{1,3}\s/.test(lines[i]) && !/^\s*\|/.test(lines[i])) {
      para.push(lines[i++]);
    }
    html += `<p>${para.map(inline).join(soft ? " " : "<br>")}</p>`;
  }
  return html;
}

/** `soft`: single newlines inside a paragraph are just wrapping (like rustc's docs). */
export function renderMarkdown(src, { soft = false } = {}) {
  const parts = src.split(/```([\w-]*)[^\n]*\n?([\s\S]*?)(?:```|$)/g);
  let html = "";
  for (let i = 0; i < parts.length; i += 3) {
    html += blocks(parts[i] || "", soft);
    if (i + 2 < parts.length) {
      const lang = (parts[i + 1] || "").toLowerCase();
      const code = (parts[i + 2] || "").replace(/\n$/, "");
      const plain = ["text", "console", "sh", "bash", "toml", "json", "python", "py", "c"].includes(lang);
      const body = plain ? escapeHtml(code) : highlightRust(code);
      html += `<pre><code>${body}</code></pre>`;
    }
  }
  return html;
}
