import { createMascot } from "./ferris.js";
import { t } from "./i18n.js";

// Three real "Predict it" levels from the game, answered here without a
// compiler: the answers and explanations are written into the page.
const XP_PER_LEVEL = 25;

function initializePredictDemo(demo) {
  const questions = Array.from(
    demo.querySelectorAll("[data-predict-question]"),
  );
  const status = demo.querySelector("[data-predict-status]");
  const xpOutput = demo.querySelector("[data-predict-xp]");
  const next = demo.querySelector("[data-predict-next]");
  const progress = demo.querySelector("[data-predict-progress]");
  const ferris = createMascot(demo.querySelector("[data-predict-ferris]"), {
    scale: 5,
    pad: 4,
  });
  let current = 0;
  let xp = 0;
  let danceTimer = 0;

  const show = (index) => {
    current = index;
    questions.forEach((question, i) => {
      question.hidden = i !== index;
    });
    progress.textContent = t("{n} of {total}", {
      n: index + 1,
      total: questions.length,
    });
    next.textContent =
      index === questions.length - 1 ? t("Play again") : t("Next level");
    next.disabled = true;
    status.textContent = t("Pick an answer, or press A to D.");
    ferris.setDance(false);
    ferris.setMood("thinking");
  };

  const reset = (question) => {
    delete question.dataset.answered;
    question.querySelectorAll("[data-choice]").forEach((button) => {
      button.classList.remove("is-correct", "is-wrong");
      button.removeAttribute("aria-disabled");
    });
    const answer = question.querySelector("[data-predict-answer]");
    answer.hidden = true;
    answer.open = false;
  };

  const choose = (question, button) => {
    if (question.dataset.answered !== undefined) return;
    question.dataset.answered = "";
    const correct = question.dataset.answer;
    const right = button.dataset.choice === correct;
    question.querySelectorAll("[data-choice]").forEach((candidate) => {
      candidate.setAttribute("aria-disabled", "true");
      if (candidate.dataset.choice === correct)
        candidate.classList.add("is-correct");
    });
    if (!right) button.classList.add("is-wrong");
    const answer = question.querySelector("[data-predict-answer]");
    answer.hidden = false;
    answer.open = true;
    next.disabled = false;

    window.clearTimeout(danceTimer);
    if (right) {
      xp += XP_PER_LEVEL;
      xpOutput.value = String(xp);
      status.textContent = t("Correct! +{xp} XP. Ferris is dancing.", {
        xp: XP_PER_LEVEL,
      });
      ferris.setDance(true);
      danceTimer = window.setTimeout(() => {
        ferris.setDance(false);
        ferris.setMood("happy");
      }, 4000);
    } else {
      status.textContent = t(
        "Not quite. The compiler would have caught you, so read why below.",
      );
      ferris.setMood("worried", 3000);
    }
  };

  questions.forEach((question) => {
    reset(question);
    question.querySelectorAll("[data-choice]").forEach((button) => {
      button.addEventListener("click", () => choose(question, button));
    });
  });

  demo.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const index = "abcd".indexOf(event.key.toLowerCase());
    if (index === -1) return;
    const button = questions[current].querySelectorAll("[data-choice]")[index];
    if (button === undefined) return;
    event.preventDefault();
    button.focus();
    choose(questions[current], button);
  });

  next.addEventListener("click", () => {
    const following = (current + 1) % questions.length;
    if (following === 0) {
      xp = 0;
      xpOutput.value = "0";
      questions.forEach(reset);
    }
    show(following);
    questions[following].querySelector("[data-choice]").focus();
  });

  demo.querySelector(".predict-controls").hidden = false;
  demo.querySelector(".predict-stage").hidden = false;
  show(0);
}

document.querySelectorAll("[data-predict-demo]").forEach(initializePredictDemo);
