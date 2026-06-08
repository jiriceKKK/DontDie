// ============================================================
// SCHOOL — copy-paste prompt templates (English). The app NEVER calls an
// AI API: it only fills these templates with planner context and copies
// them. You upload your notes/images into a Claude chat, paste the prompt,
// and Claude generates the interactive session + an APP_RESULT block you
// can paste back.
//
// The prompts assume the material is ALREADY in the chat — they never ask
// you to retype subject/source.
// ============================================================

import { sessionType } from './sessionTypes.js';

const list = arr => (Array.isArray(arr) && arr.length ? arr.join(', ') : 'none');

// Build the {{...}} context from a planned session + its test/subject/settings.
// Everything degrades to a safe string so a prompt never contains "undefined".
export function promptContext(session, { test, subject, lastResult } = {}) {
  const minutes = Number(session && session.minutes) || sessionType(session && session.sessionType).minutes || 25;
  const difficulty = (subject && Number(subject.defaultDifficulty)) || 3;
  const testDate = (test && test.testDate) || 'n/a';
  const du = test && Number.isFinite(test._daysUntil) ? test._daysUntil : (test && test.daysUntil);
  const daysUntilTest = Number.isFinite(du) ? String(du) : 'n/a';
  const targetTopics = list(session && session.targetTopics);
  const weakTopics = list(test && test.weakTopics);
  const weakTopicsOrNone = (test && test.weakTopics && test.weakTopics.length) ? test.weakTopics.join(', ') : 'none';
  const subjectName = (subject && subject.name) || 'this subject';
  const topicLine = [test && test.title, (test && test.topics && test.topics.length) ? test.topics.join(', ') : '']
    .filter(Boolean).join(' — ') || 'n/a';
  const previousResult = lastResult
    ? `${lastResult.sessionType || 'session'} scored ${lastResult.scorePercent == null ? 'n/a' : lastResult.scorePercent + '%'}, weak: ${list(lastResult.weakTopics)}`
    : 'none';

  return { minutes, difficulty, testDate, daysUntilTest, targetTopics, weakTopics, weakTopicsOrNone, subjectName, topicLine, previousResult };
}

const contextBlock = (typeId, c) => `Context from my planner:

* Session type: ${typeId}
* Planned duration: ${c.minutes} minutes
* Difficulty: ${c.difficulty} / 5
* Test date: ${c.testDate}
* Days until test: ${c.daysUntilTest}
* Target topics from planner: ${c.targetTopics}
* Weak topics: ${c.weakTopics}
* Previous APP_RESULT if any: ${c.previousResult}`;

const resultBlock = (typeId, c, { score = '[0-100]', weak = '[comma list or none]', strong = '[comma list or none]', next, minutes = '[integer]' }) => `APP_RESULT
subject: ${c.subjectName}
topic: ${c.topicLine}
session_type: ${typeId}
score_percent: ${score}
weak_topics: ${weak}
strong_topics: ${strong}
recommended_next_session: ${next}
recommended_minutes: ${minutes}
confidence: [low | medium | high]
END_APP_RESULT`;

const USE_MATERIAL = `Use only the notes, images, screenshots, text and context already provided in this chat. Do not invent extra syllabus content. If something in the notes/images is unreadable or missing, say so clearly and build the session only from what you can read.

Write the study session itself — all questions, answers, explanations, flashcards and feedback — in the same language as my notes/materials in this chat. If the materials mix languages or the language is unclear, ask me which language to use. Keep the final APP_RESULT block in English: its field names and the values for session_type, score_percent, recommended_next_session, recommended_minutes and confidence must stay exactly as specified (weak_topics and strong_topics may stay in the materials' language).`;

const TEMPLATES = {
  diagnostic_quiz: c => `I want a diagnostic study session.

${USE_MATERIAL}

Goal:
Find out what I already know and what my weak areas are before planning more study.

${contextBlock('diagnostic_quiz', c)}

Create an interactive diagnostic quiz.

Requirements:

1. Create 10–12 questions.
2. Use a mix of: direct recall, short explanation, compare/differentiate, application or inference.
3. Do not show the answers first.
4. Present only the quiz first.
5. Wait for my answers.
6. After I answer, grade each answer briefly.
7. Give partial credit when appropriate.
8. Calculate score_percent.
9. Identify weak_topics and strong_topics.
10. Recommend the next session type.

Use no motivational filler. Be direct and practical.

After grading, output this exact block:

${resultBlock('diagnostic_quiz', c, { next: '[diagnostic_quiz | active_reading | active_recall | flashcards | mixed_quiz | weak_spots_drill | interleaved_practice | final_review]' })}`,

  active_reading: c => `I want an active reading / understanding session.

${USE_MATERIAL}

Goal:
Help me understand the material actively. Do not make this passive rereading.

${contextBlock('active_reading', c)}

Create a structured active reading session.

Requirements:

1. Do not just summarize the notes.
2. Turn the material into 6–8 active steps.
3. Include tasks like: explain this in your own words; why/how questions; compare two similar things; create a mini table; identify key terms; 90-second free recall; "teach it to a classmate".
4. Keep it realistic for ${c.minutes} minutes.
5. If the subject is math/science/programming, use guided worked-example reading: show a step, ask why that step is done, ask me to finish a similar step.
6. If useful, generate a clean mobile-friendly HTML study activity with sections and small timers.
7. At the end, provide a short "what to do next" recommendation.

Since this session is not mainly scored, output:

${resultBlock('active_reading', c, { score: 'n/a', weak: c.weakTopicsOrNone, strong: 'none', next: '[flashcards | active_recall | mixed_quiz]' })}`,

  active_recall: c => `I want an active recall session.

${USE_MATERIAL}

Goal:
Make me retrieve the material from memory without looking at the answer first.

${contextBlock('active_recall', c)}

Create an interactive active recall session.

Requirements:

1. Create 12–15 open-ended questions.
2. Do not include answer choices unless absolutely needed.
3. Include: direct recall; explanation in my own words; compare/differentiate; 2–3 application/inference questions if difficulty is 4–5.
4. Do not show answers first.
5. Wait for my answers.
6. After I answer, grade each answer with 0 / 1 / 2 points.
7. Explain missing pieces briefly.
8. Calculate score_percent.
9. Identify weak_topics and strong_topics.
10. Recommend the next session type.

No motivational filler. Just useful feedback.

After grading, output:

${resultBlock('active_recall', c, { next: '[weak_spots_drill | mixed_quiz | interleaved_practice]' })}`,

  flashcards: c => `I want a flashcards session.

${USE_MATERIAL}

Goal:
Create concise flashcards for active recall and spaced repetition.

${contextBlock('flashcards', c)}

Create flashcards.

Requirements:

1. Create 18–25 flashcards.
2. Keep front side short and unambiguous.
3. Keep back side complete but concise.
4. Use approximately: 60–70% direct recall cards, 20–30% differentiation cards, 10% mini-application cards.
5. Mark the 5 highest-priority cards.
6. Avoid duplicates.
7. If useful, generate them as a clean mobile-friendly HTML flashcard activity.
8. Do not turn this into a long explanation.

At the end, output:

${resultBlock('flashcards', c, { score: 'n/a', weak: c.weakTopicsOrNone, strong: 'none', next: '[active_recall | mixed_quiz]' })}`,

  mixed_quiz: c => `I want a mixed quiz session.

${USE_MATERIAL}

Goal:
Measure exam readiness using retrieval practice, feedback and some transfer/inference.

${contextBlock('mixed_quiz', c)}

Create an interactive mixed quiz.

Requirements:

1. Create 10–12 questions.
2. Use a mix of: short open answer; multiple choice; compare/explain; application/inference.
3. Do not show answers first.
4. Present only the quiz first.
5. Wait for my answers.
6. After I answer, grade the quiz.
7. Give feedback for every wrong or incomplete answer.
8. Calculate score_percent.
9. Identify weak_topics and strong_topics.
10. Recommend the next session.

If you generate HTML, make it clean, mobile-friendly and interactive, but still wait for my answers before final grading if needed.

After grading, output:

${resultBlock('mixed_quiz', c, { next: '[weak_spots_drill | interleaved_practice | final_review]' })}`,

  weak_spots_drill: c => `I want a weak spots drill.

${USE_MATERIAL}

Goal:
Fix the specific topics I got wrong before.

${contextBlock('weak_spots_drill', c)}

Create an interactive weak spots drill.

Requirements:

1. Focus only on weak topics.
2. Create 8–12 targeted drill items.
3. Try to identify the exact confusion or wrong principle.
4. Run it interactively: ask one item, wait for my answer, give immediate short correction, continue.
5. Keep corrections short and precise.
6. At the end, summarize: fixed topics, still risky topics, next recommended session.
7. Calculate score_percent.

After the drill, output:

${resultBlock('weak_spots_drill', c, { next: '[weak_spots_drill | mixed_quiz | final_review]' })}`,

  interleaved_practice: c => `I want an interleaved practice session.

${USE_MATERIAL}

Goal:
Train me to distinguish between similar topics, concepts, authors, rules, formulas, problem types or procedures.

${contextBlock('interleaved_practice', c)}

Create an interactive interleaved session.

Requirements:

1. Use 2–3 related or easily confused topics.
2. Create 12–15 items.
3. Do not group the same topic together.
4. Mix the topics intentionally so I have to choose the right concept/procedure.
5. Include prompts like: which concept applies here and why? how do you know this is not the other one? compare A vs B; choose the right method/rule/author/style and justify.
6. Present only the activity first.
7. Wait for my answers.
8. Grade after I answer.
9. Identify top confusions.
10. Recommend next session.

After grading, output:

${resultBlock('interleaved_practice', c, { next: '[weak_spots_drill | mixed_quiz | final_review]' })}`,

  final_review: c => `I want a final review session.

${USE_MATERIAL}

Goal:
Do a final high-yield check before the test. Do not teach large new content.

${contextBlock('final_review', c)}

Create a final review.

Requirements:

1. No big new explanations unless absolutely necessary.
2. Create: 8–10 high-yield prompts, 5 lightning checks, and a short "must-fix before test" section.
3. Present the activity first.
4. Wait for my answers if it is interactive.
5. After grading, give only concise feedback.
6. Calculate score_percent if answers were provided.
7. Recommend either: none, final_review, or weak_spots_drill.

After grading, output:

${resultBlock('final_review', c, { next: '[final_review | weak_spots_drill | none]', minutes: '[0-20]' })}`,

  quick_review: c => `I want a very short test-day quick review. The test is today and I only have a 5–10 minute break before it.

${USE_MATERIAL}

Goal:
A fast, high-yield refresher right before the test. Do NOT teach new material and do NOT run a long session.

${contextBlock('quick_review', c)}

Create a quick review.

Requirements:

1. Keep it doable in 5–10 minutes total.
2. Create 5–8 lightning checks (one-line question → one-line answer).
3. Focus on my weak topics and the must-remember facts/formulas/definitions.
4. No big new explanations. No long HTML unless a tiny list genuinely helps.
5. End with a 3-item "do not forget" list.
6. Keep corrections to a single line each.

After the review, output:

${resultBlock('quick_review', c, { score: 'n/a', weak: c.weakTopicsOrNone, strong: 'none', next: '[none | final_review]', minutes: '[0-10]' })}`,
};

// Build the full prompt string for a session. Unknown type → mixed_quiz.
// Manually-added extra sessions get a short note so Claude knows the context.
export function buildPrompt(session, deps = {}) {
  const c = promptContext(session, deps);
  const tpl = TEMPLATES[session && session.sessionType] || TEMPLATES.mixed_quiz;
  let prompt = tpl(c);
  if (session && session.source === 'manual_extra') {
    prompt = `Note: this is an additional study session I added manually because I have extra study time today. Keep it useful and self-contained.\n\n${prompt}`;
  }
  return prompt;
}
