// Each language is its own pre-built page. Its strings for the scripts live in
// <script type="application/json" id="website-messages">; English needs none.
const messages = JSON.parse(
  document.getElementById("website-messages")?.textContent ?? "{}",
);

export function t(message, values = {}) {
  const translated = messages[message] ?? message;
  return translated.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}
