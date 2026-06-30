// Talks to the Claude Messages API over raw HTTPS (no SDK dependency).
// The API key lives only here, on the server — never sent to the browser.
import { normalizeQuestion } from './util.js';

// Haiku 4.5 pricing (USD per 1M tokens). Update if rates change.
const PRICE = { input: 1.0, output: 5.0 };
const USD_TO_INR = 88;
const OUTPUT_TOKENS_PER_MCQ = 180; // estimate: question + 4 options + answer + short explanation
const INPUT_TOKENS_PER_REQUEST = 1000; // syllabus + instructions
const BATCH_SIZE = 20; // MCQs requested per API call

/** Cost/usage estimate for generating `count` MCQs — no API call. */
export function estimate(count) {
  const requests = Math.ceil(count / BATCH_SIZE);
  const inputTokens = requests * INPUT_TOKENS_PER_REQUEST;
  const outputTokens = count * OUTPUT_TOKENS_PER_MCQ;
  const usd = (inputTokens / 1e6) * PRICE.input + (outputTokens / 1e6) * PRICE.output;
  return {
    count,
    requests,
    batchSize: BATCH_SIZE,
    inputTokens,
    outputTokens,
    usd: Number(usd.toFixed(2)),
    inr: Math.round(usd * USD_TO_INR),
    note: 'Estimate at Haiku 4.5 rates ($1/$5 per 1M tokens). Actual varies with question length.',
  };
}

const MCQ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          answerIndex: { type: 'integer', enum: [0, 1, 2, 3] },
          topic: { type: 'string' },
          difficulty: { type: 'string', enum: ['EASY', 'MEDIUM', 'HARD'] },
          explanation: { type: 'string' },
        },
        required: ['question', 'options', 'answerIndex', 'topic', 'difficulty', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

function buildPrompt(syllabus, n, avoidTopics) {
  return [
    `You are a senior university examiner writing a PROFESSIONAL, exam-quality test.`,
    `Generate exactly ${n} multiple-choice questions (MCQs) STRICTLY within this syllabus/source — do not go beyond it:`,
    `"""`,
    syllabus.trim(),
    `"""`,
    ``,
    `Quality standards (professional level):`,
    `- Test real understanding and application, not trivial recall or trick wording.`,
    `- Each MCQ has exactly 4 options and exactly ONE unambiguously correct answer (answerIndex 0-3).`,
    `- The 3 distractors must be plausible and related (common misconceptions), not obviously wrong or joke options.`,
    `- Keep options similar in length and style; avoid "All/None of the above" and avoid grammatical give-aways.`,
    `- Use clear, precise, professional language. Self-contained questions (no "refer to above").`,
    `- Spread across the syllabus topics with a balanced mix of EASY / MEDIUM / HARD.`,
    `- Every question must be distinct — do not paraphrase or repeat the same idea.`,
    `- "explanation" = one concise sentence justifying the correct answer.`,
    `- Set "topic" to the specific concept each question covers.`,
    avoidTopics && avoidTopics.length
      ? `- Prefer topics not yet covered, e.g.: ${avoidTopics.slice(0, 12).join(', ')}.`
      : ``,
    `Return only the JSON object matching the schema.`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function callClaude({ apiKey, model, syllabus, n, avoidTopics }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      output_config: { format: { type: 'json_schema', schema: MCQ_SCHEMA } },
      messages: [{ role: 'user', content: buildPrompt(syllabus, n, avoidTopics) }],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `Claude API ${res.status}`;
    try {
      const j = JSON.parse(text);
      msg = j.error?.message ?? msg;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  const data = JSON.parse(text);
  const block = (data.content || []).find((b) => b.type === 'text');
  if (!block) throw new Error('No text block in Claude response');
  const parsed = JSON.parse(block.text);
  const usage = data.usage || {};
  return { questions: parsed.questions || [], usage };
}

/**
 * Generate `target` unique MCQs, calling Claude in batches and deduping by
 * normalized question text. `onProgress` is called after each batch.
 */
export async function generateBank({ apiKey, model, syllabus, target, existingNorms, onProgress }) {
  const seen = new Set(existingNorms || []);
  const collected = [];
  const topics = new Set();
  let requests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const maxRequests = Math.ceil(target / BATCH_SIZE) * 2 + 8; // headroom for dedup misses

  while (collected.length < target && requests < maxRequests) {
    const need = Math.min(BATCH_SIZE, target - collected.length);
    const { questions, usage } = await callClaude({
      apiKey,
      model,
      syllabus,
      n: need + 4, // ask for a few extra to offset duplicates
      avoidTopics: [...topics],
    });
    requests++;
    inputTokens += usage.input_tokens || 0;
    outputTokens += usage.output_tokens || 0;

    for (const q of questions) {
      if (collected.length >= target) break;
      if (!q || !Array.isArray(q.options) || q.options.length !== 4) continue;
      if (typeof q.answerIndex !== 'number' || q.answerIndex < 0 || q.answerIndex > 3) continue;
      const norm = normalizeQuestion(q.question);
      if (!norm || seen.has(norm)) continue; // dedup
      seen.add(norm);
      if (q.topic) topics.add(q.topic);
      collected.push({
        id: crypto.randomUUID(),
        question: String(q.question).trim(),
        options: q.options.map((o) => String(o)),
        answerIndex: q.answerIndex,
        topic: q.topic || 'General',
        difficulty: q.difficulty || 'MEDIUM',
        explanation: q.explanation || '',
        norm,
      });
    }
    if (onProgress) onProgress({ collected: collected.length, target, requests });
  }

  const usd = (inputTokens / 1e6) * PRICE.input + (outputTokens / 1e6) * PRICE.output;
  return {
    questions: collected,
    stats: {
      requested: target,
      generated: collected.length,
      requests,
      inputTokens,
      outputTokens,
      actualUsd: Number(usd.toFixed(4)),
      actualInr: Math.round(usd * USD_TO_INR),
    },
  };
}
