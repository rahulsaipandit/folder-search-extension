# Humanizer / Stop Slop

Two related built-in actions that detect and reduce "AI writing" markers in text:
`humanizer.ts` (rewrite pass) and `stopSlop.ts` (scoring + gated rewrite), sharing
pattern banks and text utilities from `textSlopPatterns.ts`.

## Source

Inspired by [github.com/blader/humanizer](https://github.com/blader/humanizer) (MIT) and
[github.com/hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop) (MIT), both of
which draw their pattern taxonomy from Wikipedia's
["Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)
(WikiProject AI Cleanup). No code or wording was copied from either project — the pattern
lists here are reimplemented from the same public taxonomy.

`blader/humanizer` itself is a Markdown-based **agent skill**, not a standalone library: it
hands the entire two-pass job (draft rewrite, then validate against the 35 documented
patterns and the source material) to an LLM (Claude), with no deterministic/mechanical layer
of its own.

## What these actions do

- **Humanizer** (`org.page-agent.text.humanize`) — runs a deterministic cleanup pass over
  the input text, then reports what it found for optional LLM follow-up.
- **Stop Slop** (`org.page-agent.text.stopslop`) — scores text 1–10 across five dimensions
  (directness, rhythm, trust, authenticity, density; 50 total) and triggers a mechanical
  rewrite when the score is below 35, or any single dimension is 3 or below.

## Our approach

Unlike `blader/humanizer`'s all-LLM design, both actions here are **deterministic-first**:

1. **Mechanical fixes** (safe, grammar-preserving, no LLM needed): em/en dash → comma,
   `**bold**` → plain text, curly quotes → straight quotes, emoji stripping, and dropping
   whole sentences that are chatbot artifacts (e.g. "as an AI...", "I hope this helps!").
   These mutate the text directly because removing them never breaks sentence grammar.
2. **Detection-only patterns** (AI vocabulary, filler, hedging, generic conclusions,
   sycophantic/condescending tone, inflated importance, vague attribution, forced rule-of-three,
   passive voice, repeated sentence openings): these are *word-, phrase-, or sentence-structure*
   level, so mechanically stripping them out would break grammar (`"a seamless, robust
   architecture"` → `"a , architecture"`) or isn't even mutation-shaped (you can't "delete" a
   sentence for being passive voice). Both actions only surface these as findings/score
   penalties; actually rewriting around them needs semantic understanding.
3. **LLM fallback** (`fallbackToLLM: true`): whenever a real rewrite is needed — restructuring
   sentences, rule-of-three/repetition removal, voice matching against a `voiceSample` — the
   action defers to the LLM, using the deterministic findings as its brief instead of a
   blind, unguided rewrite prompt. An `instructionDoc` on both actions carries an explicit
   **no-fabrication guardrail** (adopted from `blader/humanizer`'s validate-against-source step):
   the LLM may only reorganize/restate content already present in the input, never invent
   statistics, names, or sources to make a rewritten sentence read more convincingly.

This split keeps the fast, free, network-free path doing everything it safely can, and only
asks the LLM to do the part that genuinely requires judgment.

## Mechanical output vs. LLM rewrite — worked example

`humanize()` (the deterministic pass in `humanizer.ts`) only ever does *safe* edits: it never
touches word/phrase-level content, because deleting a flagged word mid-sentence breaks grammar.
The LLM fallback is what actually rewrites the sentence around a flagged pattern. Same input,
two different outputs:

**Input** (this is the actual string run through `HumanizerAction.execute()` below):

> It's important to note that our platform leverages a seamless, robust architecture — one that
> truly showcases our commitment to innovation. As an AI, I don't have personal opinions. But this
> **solution** stands as a testament to what's possible. 🚀 In conclusion, this approach delivers
> real value.

**1. Mechanical pass only (`humanizer.ts` → `humanized`, verified output):**

> It's important to note that our platform leverages a seamless, robust architecture, one that
> truly showcases our commitment to innovation. But this solution stands as a testament to what's
> possible. In conclusion, this approach delivers real value.

```json
[
  { "pattern": "em/en dash overuse", "count": 1 },
  { "pattern": "boldface overuse", "count": 1 },
  { "pattern": "emojis", "count": 1 },
  { "pattern": "chatbot artifacts / cutoff disclaimers", "count": 1 },
  { "pattern": "AI vocabulary", "count": 5 },
  { "pattern": "filler phrases", "count": 1 },
  { "pattern": "generic conclusions", "count": 1 },
  { "pattern": "inflated importance", "count": 1 }
]
```

What changed and why:
- ` — ` → `, ` (em dash normalized)
- `**solution**` → `solution` (bold markers stripped)
- 🚀 removed (emoji stripped)
- The whole "As an AI, I don't have personal opinions." sentence was dropped — a
  `CHATBOT_ARTIFACTS` match is a self-contained sentence, safe to remove outright. Note it had to
  be its own sentence to be droppable cleanly: if the disclaimer had instead been comma-spliced
  into the next sentence (`"As an AI, I don't have personal opinions, but this solution..."`),
  whole-sentence removal would take the rest of that sentence down with it — a real limitation of
  sentence-granularity removal, not something this pass tries to patch around.
- `leverages`, `seamless`, `robust`, `showcases`, `"stands as a testament"`,
  `"it's important to note that"`, and `"in conclusion"` are all **left in place**, but reported
  in `findings` — mechanically deleting them would leave `"our platform a , architecture"`, which
  is broken grammar, not humanized prose

**2. What the LLM fallback produces instead (semantic rewrite, guided by those same
`findings`, respecting the no-fabrication guardrail — no new specifics invented):**

> Our platform is built on a single, well-tested architecture. It's not flashy, but it holds up
> under load, and that's the whole point.

The LLM pass restructures the sentence rather than just deleting words: `leverages a seamless,
robust architecture` becomes a concrete claim (`built on a single, well-tested architecture`)
instead of `a architecture` with the buzzwords hollowed out, `showcases our commitment to
innovation` is dropped as filler rather than left dangling, and `stands as a testament to what's
possible` (flagged as both AI vocabulary and inflated importance) is replaced with a plain,
verifiable statement instead of merely un-bolded.

The practical difference: the mechanical pass is instant, free, and 100% reproducible, but it
can only clean up *punctuation and self-contained sentences*. Real de-sloppifying of vocabulary
and tone requires the semantic rewrite step — that's why `fallbackToLLM: true` and the `findings`
array exist: the deterministic pass hands the LLM a precise list of what to fix instead of a
vague "make this sound human" prompt.

## How it compares to blader/humanizer

| | `blader/humanizer` | This implementation |
|---|---|---|
| Runtime | LLM does 100% of the work (rewrite + self-validate) | Deterministic pass first; LLM only for what needs semantic rewriting |
| Cost/latency | One or more LLM calls every time | Zero LLM calls for punctuation/artifact cleanup and for scoring; LLM only invoked via `fallbackToLLM` when triggered |
| Determinism | Rewrite output can vary run to run | Mechanical fixes are 100% reproducible; only the LLM-fallback portion varies |
| Pattern set | 35 documented patterns across 4 categories (content, language, style, filler/hedging) | A broad subset reimplemented into `textSlopPatterns.ts`: content (AI vocabulary, inflated importance, vague attribution, generic conclusions), language (filler, hedging, sycophantic/condescending phrases, forced rule-of-three, passive voice, repeated sentence openings), style (dashes, bold, curly quotes, emoji), filler/hedging (chatbot artifacts) — not a 1:1 port of all 35, but now spans all 4 categories rather than a handful of word lists |
| Scoring | No standalone score — single rewrite step | `stopSlop.ts` adds a 5-dimension 1–10 scorer (not present in `blader/humanizer`) with a pass/rewrite gate, usable standalone to just *measure* slop without rewriting |
| Voice matching | Supported via writing samples | `humanizer.ts` accepts an optional `voiceSample` and reports sentence-length stats (`avgSentenceWords`, `sentenceCount`); it does not yet feed voice-matching into the deterministic pass — that part still relies on the LLM fallback |
| Fact-safety guardrail | Explicit — the rewrite must validate against the source material, never inventing details | Adopted: both actions' `instructionDoc` explicitly forbids the LLM fallback from inventing statistics, names, or sources when rewriting a flagged sentence |

## How blader/humanizer differs from hardikpandya/stop-slop

Both upstream projects are Claude **skill files** (Markdown instructions, no executable code)
built from the same "Signs of AI writing" taxonomy, but they hand the LLM a different job:

| | `blader/humanizer` | `hardikpandya/stop-slop` |
|---|---|---|
| Role | Remediation — rewrite the text | Diagnosis — score the text, then guide a manual/AI-assisted revision |
| Output | A finished rewritten draft | A 1–10 × 5-dimension score (directness, rhythm, trust, authenticity, density; 50 total), pass/revise verdict at the 35-point threshold |
| Mechanism | Two-pass: draft rewrite, then validate the draft against the 35 patterns and the source material | No algorithmic replacement step — it names the target patterns (throat-clearing, structural clichés, passive voice, em dashes, rhetorical formulas) and leaves removal to the model's judgment |
| Deliverable shape | One skill file, used stand-alone | Core `SKILL.md` plus reference docs: a banned-phrase list, structural-pattern list, and before/after examples |
| Fact-safety guardrail | Explicit — must not invent details, everything must trace back to the source or the author | Not the focus — it's a style/slop rubric, not a fact-preservation contract |

In short: `humanizer` produces a rewrite; `stop-slop` produces a grade and a punch list. Our
codebase mirrors that same split — `humanizer.ts` returns rewritten text, `stopSlop.ts` returns
scores — but reimplements the *diagnosis* half of both (pattern detection, scoring) as plain
deterministic code instead of LLM judgment, and only calls out to the LLM for the *remediation*
half that can't be done safely by mechanical rules (see "Our approach" above).

## Files

| File | Role |
|---|---|
| `textSlopPatterns.ts` | Shared pattern banks (`AI_VOCAB`, `FILLER_PHRASES`, `CHATBOT_ARTIFACTS`, `SYCOPHANTIC_PHRASES`, `HEDGING_PHRASES`, `GENERIC_CONCLUSIONS`, `CONDESCENDING_PHRASES`, `INFLATED_IMPORTANCE_PHRASES`, `VAGUE_ATTRIBUTION_PHRASES`, `FORMULAIC_OPENERS`) and utilities (`countPhrases` — word-boundary-aware, `normalizePunctuation`, `splitSentences`, `countAdverbs`, `countRuleOfThree`, `countPassiveVoice`, `countRepeatedOpeners`, `wordCount`) |
| `humanizer.ts` | `HumanizerAction` — mechanical cleanup + findings, optional voice sample stats, no-fabrication `instructionDoc` |
| `stopSlop.ts` | `StopSlopAction` — 5-dimension scorer + gated mechanical rewrite, no-fabrication `instructionDoc` |

### Known heuristic limitations

- `countPhrases` matches on word boundaries (`\bphrase\b`), so it no longer double-counts one
  listed phrase that is a substring of another (e.g. "seamless" inside "seamlessly") or false-hits
  unrelated words (e.g. "robust" inside "robustness") — but each inflected form that should count
  (`leverage` vs. `leverages` vs. `leveraged`) has to be listed explicitly rather than falling out
  of substring matching.
- `countAdverbs` still relies on a `-ly` suffix heuristic (not real POS tagging), with a manually
  maintained exclusion list (`family`, `apply`, `early`, `silly`, ...) for common non-adverb `-ly`
  words; it does not exhaustively cover every non-adverb `-ly` word in English.
- `countPassiveVoice` only catches regular past participles (`was rejected`), not irregular ones
  (`was written`, `were made`) — a real regex limitation, not a bug, since matching irregular verb
  morphology reliably needs a POS tagger, not a heuristic string match.
- `countRuleOfThree` flags any three-comma-and-joined short phrase, including legitimate lists
  (ingredient lists, enumerations) that aren't rhetorical padding — it's a signal to weigh, not a
  guaranteed-correct detector.

Both are registered as standard actions in `index.ts` via `globalActionRegistry.register(...)`
and are invoked like any other built-in action (see `../types.ts` for the `ActionDefinition`
contract) — no separate setup is required.

## How to run

These are in-process `ActionDefinition`s, not standalone scripts — there's nothing to launch on
its own. They run wherever the extension's action registry runs (side panel chat, skill
triggers, etc.), invoked either:

- **By trigger phrase** — e.g. "humanize this", "make this sound human" (`humanizer.ts`), or
  "stop slop", "rate this text" (`stopSlop.ts`); see each action's `triggers` array.
- **Directly**, by calling the exported action's `execute()`:

```ts
import { HumanizerAction } from './humanizer';
import { StopSlopAction } from './stopSlop';

const result = await HumanizerAction.execute(
  { text: 'Let’s delve into this seamless, robust solution—it truly showcases...' },
  context,
);
// result.humanized, result.findings

const score = await StopSlopAction.execute({ text: someDraft }, context);
// score.scores, score.total, score.verdict ('pass' | 'rewrite'), score.rewritten
```

To exercise them end-to-end in the extension UI, trigger one of the phrases above from the
side panel chat with some AI-sounding text pasted in.
