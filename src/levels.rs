//! Loads the curriculum: one TOML file per world in `levels/` (`worldNN_*.toml`), plus
//! `levels/book.toml`, the table of contents of the Rust Book the game follows.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Fix,
    Fill,
    Predict,
    Boss,
    /// A multiple-choice question about a concept, with no code to run.
    Quiz,
}

/// How the game decides that a level is passed.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Check {
    /// Compile, run, and compare stdout with `expected_output`.
    Output,
    /// Append `tests` to the code and run them with `rustc --test`.
    Tests,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Level {
    pub id: String,
    pub title: String,
    pub kind: Kind,
    /// Rust Book sections this level teaches (ids from book.toml, e.g. "4.2").
    #[serde(default)]
    pub book: Vec<String>,
    pub goal: String,
    #[serde(default)]
    pub lesson: String,
    #[serde(default)]
    pub c_compare: String,
    #[serde(default)]
    pub py_compare: String,
    /// Starting code (for predict levels: the code to read).
    #[serde(default)]
    pub starter: String,
    #[serde(default = "default_check")]
    pub check: Check,
    #[serde(default)]
    pub expected_output: Option<String>,
    #[serde(default)]
    pub tests: Option<String>,
    #[serde(default)]
    pub hints: Vec<String>,
    #[serde(default)]
    pub solution: String,
    // Predict levels only.
    #[serde(default)]
    pub choices: Vec<String>,
    #[serde(default)]
    pub answer: Option<usize>,
    #[serde(default)]
    pub compile_fails: bool,
    #[serde(default)]
    pub explanation: String,
    #[serde(default = "default_xp")]
    pub xp: u32,
    // What the program gets when it runs (all optional).
    /// Typed at the keyboard (standard input).
    #[serde(default)]
    pub stdin: String,
    /// Command-line arguments.
    #[serde(default)]
    pub args: Vec<String>,
    /// Environment variables.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Extra files next to main.rs: data files, or modules like `garden.rs`.
    #[serde(default)]
    pub files: BTreeMap<String, String>,
    /// What the program must print to standard error (e.g. with eprintln!).
    #[serde(default)]
    pub expected_stderr: Option<String>,
    /// How many `#[test]` functions the player must write themselves.
    #[serde(default)]
    pub min_tests: usize,
}

fn default_check() -> Check {
    Check::Output
}

fn default_xp() -> u32 {
    30
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct World {
    pub id: u32,
    pub name: String,
    pub blurb: String,
    /// "project" or "bonus" islands; plain worlds have none.
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(rename = "level", default)]
    pub levels: Vec<Level>,
    /// Levels that are designed but not built yet.
    #[serde(default)]
    pub planned: Vec<Planned>,
}

/// A placeholder for a level that will be built later.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Planned {
    pub title: String,
    pub kind: String,
    #[serde(default)]
    pub book: Vec<String>,
    #[serde(default)]
    pub about: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Section {
    pub id: String,
    pub title: String,
    pub file: String,
    /// False for entries that aren't topics to teach (e.g. the appendix index page).
    #[serde(default = "yes")]
    pub topic: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct Book {
    pub base_url: String,
    #[serde(rename = "section")]
    pub sections: Vec<Section>,
}

impl Book {
    pub fn load(path: &Path) -> Result<Book, String> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| format!("can't read {}: {e}", path.display()))?;
        toml::from_str(&text).map_err(|e| format!("bad book file {}: {e}", path.display()))
    }

    pub fn get(&self, id: &str) -> Option<&Section> {
        self.sections.iter().find(|s| s.id == id)
    }

    pub fn url(&self, s: &Section) -> String {
        format!("{}{}", self.base_url, s.file)
    }

    /// "4.2 References and Borrowing" style labels for a list of section ids.
    pub fn labels(&self, ids: &[String]) -> Vec<String> {
        ids.iter()
            .map(|id| match self.get(id) {
                Some(s) if s.title.starts_with("Appendix") => s.title.clone(),
                Some(s) => format!("{} {}", s.id, s.title),
                None => id.clone(),
            })
            .collect()
    }

    /// The sections the game must teach: every topic that has no subsections.
    pub fn leaf_topics(&self) -> Vec<&Section> {
        self.sections
            .iter()
            .filter(|s| {
                s.topic
                    && !self
                        .sections
                        .iter()
                        .any(|o| o.id.starts_with(&format!("{}.", s.id)))
            })
            .collect()
    }
}

/// Which book sections are taught by built levels, which only by planned ones, and
/// which by nothing. Unknown section ids (typos in a level file) are returned too.
pub struct Coverage<'a> {
    pub built: Vec<&'a Section>,
    pub planned_only: Vec<&'a Section>,
    pub missing: Vec<&'a Section>,
    pub unknown: Vec<String>,
}

pub fn coverage<'a>(book: &'a Book, worlds: &[World]) -> Coverage<'a> {
    let built: Vec<&String> = worlds
        .iter()
        .flat_map(|w| &w.levels)
        .flat_map(|l| &l.book)
        .collect();
    let planned: Vec<&String> = worlds
        .iter()
        .flat_map(|w| &w.planned)
        .flat_map(|p| &p.book)
        .collect();
    let mut unknown: Vec<String> = built
        .iter()
        .chain(&planned)
        .filter(|id| book.get(id).is_none())
        .map(|id| id.to_string())
        .collect();
    unknown.sort();
    unknown.dedup();
    let mut cov = Coverage {
        built: vec![],
        planned_only: vec![],
        missing: vec![],
        unknown,
    };
    for s in book.leaf_topics() {
        if built.contains(&&s.id) {
            cov.built.push(s);
        } else if planned.contains(&&s.id) {
            cov.planned_only.push(s);
        } else {
            cov.missing.push(s);
        }
    }
    cov
}

pub fn load_worlds(dir: &Path) -> Result<Vec<World>, String> {
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("can't read {}: {e}", dir.display()))?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|ext| ext == "toml"))
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("world"))
        })
        .collect();
    paths.sort();

    let mut worlds = Vec::new();
    for path in paths {
        let text = std::fs::read_to_string(&path)
            .map_err(|e| format!("can't read {}: {e}", path.display()))?;
        let world: World =
            toml::from_str(&text).map_err(|e| format!("bad level file {}: {e}", path.display()))?;
        worlds.push(world);
    }
    worlds.sort_by_key(|w| w.id);
    Ok(worlds)
}

impl World {
    pub fn find<'a>(worlds: &'a [World], level_id: &str) -> Option<(&'a World, usize, &'a Level)> {
        worlds.iter().find_map(|w| {
            w.levels
                .iter()
                .position(|l| l.id == level_id)
                .map(|i| (w, i, &w.levels[i]))
        })
    }
}
