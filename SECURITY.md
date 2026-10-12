# Security

Ferris' Forge runs a small web server on your computer that compiles and runs Rust code and
Neovim. If you find a way to misuse it, please tell me privately first.

## Reporting a problem

Use **[Report a vulnerability](https://github.com/wanikhawar/ferris-forge/security/advisories/new)**
(the Security tab of this repository). Please don't open a public issue for it.

Include what you did, what happened, and your OS and `rustc --version`. I'll reply as soon as
I can and credit you in the fix unless you'd rather not be named.

Only the latest release and `master` get fixes.

## What counts

The game is meant to keep its powers to its own page and to the player sitting at it. These
are security problems:

- Another website, another program or another user on the computer can use the game's API,
  run code through it, or read your save (for example by getting around the `#key=…` check).
- The server can be reached from outside 127.0.0.1.
- A program you run in a level gets past its limits (memory, file size, CPU time, the
  5-second timeout) or keeps running after the run is over.
- The compiler can be made to use unbounded memory or time from a small program.

These are expected, not vulnerabilities:

- Code you write runs as you, with your files and network, just like `cargo run`. Don't paste
  code you wouldn't run in a terminal.
- Anyone who has your game key (from `save/game.key` or the printed link) can use the game.
- Ferris (Claude Code) sees the code and questions you send him.
