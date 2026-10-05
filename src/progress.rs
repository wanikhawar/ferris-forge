//! The save file: XP, finished levels, drafts, the error codex and settings.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// "claude_code" uses your Claude subscription through the `claude` CLI; "offline" uses built-in hints.
    pub teacher: String,
    /// A Claude Code model alias (fable, opus, sonnet, haiku) or a full model name.
    pub model: String,
    /// low, medium, high, xhigh or max.
    pub effort: String,
    /// Ask Ferris automatically every time the code fails.
    pub auto_explain: bool,
    pub sound: bool,
    /// "clean" or "pixel".
    pub code_font: String,
    /// Edit with Vim motions, powered by the player's own Neovim.
    pub vim: bool,
    /// Load the player's Neovim config (init.lua, plugins, keymaps) instead of `--clean`.
    pub nvim_config: bool,
    /// Smooth, larger text for lessons and chat (the pixel art and headings stay).
    pub readable_text: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            teacher: "claude_code".into(),
            model: "opus".into(),
            effort: "low".into(),
            auto_explain: false,
            sound: true,
            code_font: "clean".into(),
            vim: false,
            nvim_config: true,
            readable_text: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Completion {
    pub xp: u32,
    pub hints_used: u32,
    pub attempts: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CodexEntry {
    pub first_level: String,
    pub count: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Progress {
    pub name: String,
    pub xp: u32,
    pub completed: BTreeMap<String, Completion>,
    pub skipped: BTreeSet<String>,
    /// Every level that was ever cleared or skipped. Replaying a level never re-locks
    /// what comes after it, because unlocking looks here.
    pub reached: BTreeSet<String>,
    pub attempts: BTreeMap<String, u32>,
    /// Highest hint tier the player has opened for each level (0–3).
    pub hint_tier: BTreeMap<String, u32>,
    /// Wrong guesses on predict levels.
    pub wrong_guesses: BTreeMap<String, u32>,
    /// Levels where Ferris' code review already paid out bonus XP.
    pub review_bonus: BTreeSet<String>,
    pub drafts: BTreeMap<String, String>,
    pub codex: BTreeMap<String, CodexEntry>,
    /// Days (counted from 1970) on which the player played.
    pub days_played: BTreeSet<u64>,
    pub settings: Settings,
}

pub const RANKS: &[(u32, &str)] = &[
    (0, "Hatchling"),
    (250, "Little Crab"),
    (700, "Rustacean"),
    (1500, "Borrow Checker Whisperer"),
    (3000, "Crab Captain"),
    (5000, "Ferris' Equal"),
];

pub fn today() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

impl Progress {
    /// Load the save file. A missing file means a new game. A file that exists but
    /// can't be parsed is moved aside (never overwritten) and the returned note says where.
    /// A file that can't be read at all is an error: better to stop than risk wiping it.
    pub fn load(path: &Path) -> Result<(Progress, Option<String>), String> {
        let text = match std::fs::read_to_string(path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok((Progress::default(), None));
            }
            Err(e) => return Err(format!("can't read your save file {}: {e}", path.display())),
        };
        match serde_json::from_str::<Progress>(&text) {
            Ok(mut p) => {
                // Saves from before `reached` existed: everything finished counts as reached.
                let finished: Vec<String> = p.completed.keys().chain(&p.skipped).cloned().collect();
                p.reached.extend(finished);
                Ok((p, None))
            }
            Err(e) => {
                let stamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let backup = path.with_file_name(format!("progress.broken-{stamp}.json"));
                std::fs::rename(path, &backup).map_err(|re| {
                    format!("your save file is damaged ({e}) and couldn't be backed up: {re}")
                })?;
                let note = format!(
                    "Your save file was damaged ({e}), so a new game was started. The old file is kept at {}.",
                    backup.display()
                );
                Ok((Progress::default(), Some(note)))
            }
        }
    }

    /// Write to a temp file first and rename it into place, so a crash can't leave a half-written save.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let tmp: PathBuf = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, text).map_err(|e| format!("couldn't write {}: {e}", tmp.display()))?;
        std::fs::rename(&tmp, path).map_err(|e| format!("couldn't replace {}: {e}", path.display()))
    }

    pub fn rank(&self) -> (&'static str, Option<(u32, &'static str)>) {
        let idx = RANKS
            .iter()
            .rposition(|(min, _)| self.xp >= *min)
            .unwrap_or(0);
        (RANKS[idx].1, RANKS.get(idx + 1).copied())
    }

    /// Consecutive days played, ending today or yesterday.
    pub fn streak(&self) -> u32 {
        let mut day = today();
        if !self.days_played.contains(&day) {
            day = day.saturating_sub(1);
        }
        let mut streak = 0;
        while self.days_played.contains(&day) {
            streak += 1;
            day = day.saturating_sub(1);
        }
        streak
    }

    pub fn is_done(&self, level_id: &str) -> bool {
        self.completed.contains_key(level_id) || self.skipped.contains(level_id)
    }

    /// Cleared or skipped now, or at some point before a replay.
    pub fn has_reached(&self, level_id: &str) -> bool {
        self.is_done(level_id) || self.reached.contains(level_id)
    }

    /// Start a level over: take back its XP and forget its hints, attempts and guesses.
    /// Returns the XP that was taken back.
    pub fn replay(&mut self, level_id: &str) -> u32 {
        let xp = self.completed.remove(level_id).map(|c| c.xp).unwrap_or(0);
        self.xp = self.xp.saturating_sub(xp);
        self.skipped.remove(level_id);
        self.hint_tier.remove(level_id);
        self.attempts.remove(level_id);
        self.wrong_guesses.remove(level_id);
        self.review_bonus.remove(level_id);
        self.drafts.remove(level_id);
        xp
    }

    pub fn record_errors(&mut self, level_id: &str, codes: &[String]) {
        for code in codes {
            let entry = self
                .codex
                .entry(code.clone())
                .or_insert_with(|| CodexEntry {
                    first_level: level_id.to_string(),
                    count: 0,
                });
            entry.count += 1;
        }
    }

    /// XP after hint penalties: tier 1 costs 10%, tier 2 30%, tier 3 (the answer) 60%.
    pub fn xp_for(&self, level_id: &str, base: u32) -> u32 {
        let penalty = match self.hint_tier.get(level_id).copied().unwrap_or(0) {
            0 => 0,
            1 => 10,
            2 => 30,
            _ => 60,
        };
        base * (100 - penalty) / 100
    }

    /// A short description of the player, so Ferris can personalise feedback.
    pub fn learner_profile(&self) -> String {
        let (rank, _) = self.rank();
        let mut s = format!(
            "Rank: {rank} ({} XP). Levels finished: {}.",
            self.xp,
            self.completed.len()
        );
        let mut common: Vec<_> = self.codex.iter().collect();
        common.sort_by_key(|(_, e)| std::cmp::Reverse(e.count));
        if !common.is_empty() {
            let list: Vec<String> = common
                .iter()
                .take(5)
                .map(|(code, e)| format!("{code} ×{}", e.count))
                .collect();
            s.push_str(&format!(
                " Compiler errors they hit most: {}.",
                list.join(", ")
            ));
        }
        let mut struggles: Vec<_> = self.attempts.iter().filter(|(_, n)| **n >= 4).collect();
        struggles.sort_by(|a, b| b.1.cmp(a.1));
        if !struggles.is_empty() {
            let list: Vec<String> = struggles
                .iter()
                .take(5)
                .map(|(id, n)| format!("level {id} ({n} tries)"))
                .collect();
            s.push_str(&format!(
                " Levels that took many tries: {}.",
                list.join(", ")
            ));
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_save(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ferris-forge-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("progress.json")
    }

    #[test]
    fn missing_save_starts_a_new_game() {
        let path = temp_save("missing");
        let (p, note) = Progress::load(&path).unwrap();
        assert_eq!(p.xp, 0);
        assert!(note.is_none());
    }

    #[test]
    fn damaged_save_is_backed_up_not_overwritten() {
        let path = temp_save("damaged");
        std::fs::write(&path, "{ not json").unwrap();
        let (p, note) = Progress::load(&path).unwrap();
        assert_eq!(p.xp, 0);
        assert!(note.unwrap().contains("progress.broken-"));
        assert!(!path.exists(), "the damaged file must be moved aside");
        let backups: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("progress.broken-")
            })
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            std::fs::read_to_string(backups[0].path()).unwrap(),
            "{ not json"
        );
    }

    #[test]
    fn save_round_trips() {
        let path = temp_save("roundtrip");
        let p = Progress {
            xp: 123,
            ..Default::default()
        };
        p.save(&path).unwrap();
        assert_eq!(Progress::load(&path).unwrap().0.xp, 123);
    }

    #[test]
    fn save_reports_errors() {
        let p = Progress::default();
        assert!(
            p.save(Path::new("/nonexistent-dir/for/sure/progress.json"))
                .is_err()
        );
    }

    #[test]
    fn hint_penalties() {
        let mut p = Progress::default();
        assert_eq!(p.xp_for("1.1", 100), 100);
        p.hint_tier.insert("1.1".into(), 1);
        assert_eq!(p.xp_for("1.1", 100), 90);
        p.hint_tier.insert("1.1".into(), 3);
        assert_eq!(p.xp_for("1.1", 100), 40);
    }

    #[test]
    fn ranks_follow_xp() {
        let mut p = Progress::default();
        assert_eq!(p.rank().0, "Hatchling");
        p.xp = 700;
        assert_eq!(p.rank().0, "Rustacean");
        p.xp = 99_999;
        assert_eq!(p.rank(), ("Ferris' Equal", None));
    }

    #[test]
    fn replay_takes_back_xp_and_keeps_the_level_reached() {
        let mut p = Progress {
            xp: 100,
            ..Default::default()
        };
        p.completed.insert(
            "1.1".into(),
            Completion {
                xp: 30,
                hints_used: 1,
                attempts: 2,
            },
        );
        p.reached.insert("1.1".into());
        p.hint_tier.insert("1.1".into(), 1);
        assert_eq!(p.replay("1.1"), 30);
        assert_eq!(p.xp, 70);
        assert!(!p.is_done("1.1"));
        assert!(p.has_reached("1.1"));
        assert_eq!(p.xp_for("1.1", 100), 100, "hint penalty is gone");
    }

    #[test]
    fn streak_counts_consecutive_days() {
        let mut p = Progress::default();
        let t = today();
        p.days_played.extend([t, t - 1, t - 2, t - 4]);
        assert_eq!(p.streak(), 3);
    }
}
