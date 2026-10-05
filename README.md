# 🦀 Ferris' Forge

A cozy pixel-art game that teaches Rust from the ground up. Ferris the crab is your teacher, powered by Claude through your Claude Code subscription.

## Play

```bash
cargo run
```

Your browser opens at http://127.0.0.1:7878. Press Ctrl+C in the terminal to quit.

## How it works

- **Real compiler.** Your code is compiled and run with your own `rustc`. The compiler and tests decide whether you pass a level, not the AI.
- **Ferris = Claude.** Explanations, hints, code reviews and chat go through `claude -p` (Claude Code's headless mode), so they use your Claude subscription. There's no API key. Ferris has no tools in the game: he can only talk.
- **Switch models** with the 🧠 chip under Ferris (Fable, Opus, Sonnet, Haiku, or any model name Claude Code accepts) and pick an effort level.
- **The ⚡ "E" bar** in the top-right corner shows how much of your Claude usage limit is left. It updates after Ferris answers.
- **Offline mode** (in Settings) uses built-in hints and doesn't touch your Claude limit.

## Vim mode

Click **VIM** above the editor (or turn it on in Settings) and every keystroke goes to your own Neovim, running invisibly in the background (`nvim --embed`). Motions, operators, text objects, registers, macros, `:s`, undo and your keymaps all work. The status line under the code shows the mode and your `:` commands.

- By default it loads your config (`~/.config/nvim`). Settings can switch to a clean Neovim instead.
- It never writes files: the buffer is a scratch buffer, and the game saves your code itself.
- Use **Ctrl+Shift+C / Ctrl+Shift+V** for the system clipboard. Some browser shortcuts (like Ctrl+W) can't be captured by a web page.

## Controls

| Key | Action |
|---|---|
| Ctrl+Enter | Run your code |
| 1–9, 0, N | Hotbar: Run, Compiler, Output, Expected/Tests, Hint, Explain, Review, Reset, Skip, Map, Next |
| A–D | Answer a predict question |
| Tab / Shift+Tab | Indent / dedent |
| Ctrl+/ | Toggle comment (when Vim mode is off) |
| L | Open the lesson |
| Q | Quick questions for Ferris |

## Level types

🔧 **Fix it**: broken code to repair · ✍️ **Fill it**: write the missing part · 🔮 **Predict it**: guess the output · 👹 **Boss**: a mini-project at the end of each world.

Hints cost XP on that level (−10%, −30%, then −60% for the full answer). If Ferris' code review says your passing code is idiomatic, you get +15 bonus XP.

## Project layout

```
src/        Rust backend (axum): runner (rustc), teacher (claude -p), progress, API
levels/     the curriculum: one TOML file per world
web/        the pixel UI (plain HTML/CSS/JS, no build step)
save/       your progress (created on first run)
```

To check that every level is solvable (each starter fails, each solution passes, each predict answer is correct):

```bash
cargo run -- verify
```

## Follows the Rust Book

The curriculum follows **The Rust Programming Language**, using Brown University's interactive edition (https://rust-book.cs.brown.edu). `levels/book.toml` lists every chapter and section. Each level says which sections it teaches, and the lesson popup links straight to them.

`cargo run -- verify` also checks **coverage**: every book topic must be taught by at least one level (built or planned), and every section id a level mentions must exist.

## Roadmap

25 islands cover the whole book, ordered by what you need to know first rather than by chapter number. Worlds 0–3 are playable; the rest are placeholders whose planned levels already have names and goals.

| # | Island | Book |
|---|---|---|
| 0 | Tutorial Beach | Ch 1, 3.4 |
| 1 | Variable Village | 3.1–3.2 |
| 2 | Flow Forest | 3.3, 3.5 |
| 3 | Ownership Caves | 4.1 |
| 4 | Borrow Bridge | 4.2–4.5 (incl. the permissions model, fixing ownership errors) |
| 5 | Struct Smithy | Ch 5 |
| 6 | Enum Isles | Ch 6 (+ Ownership Inventory #1) |
| 7 | Collection Citadel | Ch 8 (+ Inventory #2) |
| 8 | Error Marsh | Ch 9 |
| 9 | Guessing Game Grotto 🛠 | Ch 2 (project) |
| 10 | Pattern Plains | Ch 19 |
| 11 | Module Mines | Ch 7 |
| 12 | Testing Grounds | Ch 11 |
| 13 | Trait Tower | 10.1–10.2, App. C |
| 14 | Lifetime Labyrinth | 10.3 (+ Inventory #3) |
| 15 | Iterator Rapids | 13.1, 13.2, 13.4 |
| 16 | Minigrep Harbor 🛠 | Ch 12, 13.3 (project) |
| 17 | Pointer Peaks | Ch 15 |
| 18 | Object Observatory | Ch 18 (+ Inventory #4) |
| 19 | Thread Volcano | Ch 16 |
| 20 | Async Archipelago | Ch 17 |
| 21 | Cargo Docks | Ch 14 |
| 22 | Advanced Abyss | Ch 20 |
| 23 | Web Server Citadel 🛠 | Ch 21 (final project) |
| 24 | Ferris' Library 📚 | Appendices |

The Guessing Game, Minigrep and async worlds will need extra runner features (keyboard input for programs, command-line arguments and files, and external crates like `rand`) before their levels can be built.
