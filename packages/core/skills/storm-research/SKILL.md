---
name: storm-research
display_name: STORM Research
description: Use when the user wants deep, multi-perspective research on a topic before writing, deciding, investing, interviewing, negotiating, or presenting — not a quick factual lookup.
version: 1.0.0
author: built-in
tags: [research, analysis, synthesis, decision-making, multi-perspective, storm]
score_threshold: 0.70
---

You are running the STORM method (Synthesis of Topic Outlines through Retrieval and Multi-perspective Question Asking), adapted from the Stanford OVAL Lab's NAACL 2024 paper. A single-angle answer only surfaces the majority view — this method simulates five independent experts, finds where they clash, synthesizes their views, and then critiques its own output before handing it to the user.

Research the topic inside the <topic> tags by executing these four phases in order, in full, without skipping any:

**Phase 1 — Multi-Perspective Scan**
Simulate 5 independent expert perspectives on the topic:
1. THE PRACTITIONER — works with this daily. What do they know that academics miss? What practical realities get ignored?
2. THE ACADEMIC — has studied this for years. What does the peer-reviewed evidence actually say? Where does it contradict popular belief?
3. THE SKEPTIC — thinks the mainstream view is wrong. What is the strongest counterargument? What do proponents conveniently ignore?
4. THE ECONOMIST — follows the money. Who profits from the current narrative? What financial incentives shape it?
5. THE HISTORIAN — has seen similar patterns before. What historical parallels exist, and how did they play out?

For each perspective, give: their core position in 2 sentences, the strongest evidence supporting it, and the one thing they'd say that no other perspective would.

**Phase 2 — Contradiction Map**
Using the 5 perspectives above:
1. Where do two or more perspectives directly contradict each other? List each conflict with the specific claims that clash.
2. Which perspective has the strongest evidence? Which the weakest, and why?
3. What single question, if answered, would resolve the biggest contradiction?
4. What does every perspective agree on? (Likely true — even opponents confirm it.)
5. What did none of the perspectives address? (The blind spot in the field — often the most valuable finding.)

**Phase 3 — Synthesis**
Pull Phases 1 and 2 into a research briefing:
1. ONE-PARAGRAPH SUMMARY — brief a CEO who has 60 seconds and needs nuance, not just a headline.
2. FIVE KEY FINDINGS — ranked by reliability; note which perspectives support and which challenge each one.
3. HIDDEN CONNECTION — one non-obvious link between findings visible only when all 5 perspectives are viewed together.
4. ACTIONABLE INSIGHT — what should someone in the user's stated role or goal actually DO differently? Be specific.
5. FRONTIER QUESTION — the one open question that, if answered, would change how we understand this topic.

**Phase 4 — Peer Review**
Critique your own briefing:
1. CONFIDENCE SCORES — rate each of the 5 key findings 1-10 for reliability, with reasons.
2. WEAKEST LINK — which claim are you least confident in, and what would verify it?
3. BIAS CHECK — which perspective is overrepresented in the synthesis? Did one voice dominate?
4. MISSING PERSPECTIVE — is there a 6th angle that would change the conclusions?
5. OVERALL GRADE — if a professor reviewed this briefing, what grade and why? What would they say to fix?

Present all four phases in full, clearly labeled, in a single response — do not truncate or summarize a phase away.

<topic>
[Describe the topic to research, and optionally the role/goal it's for — e.g. "evaluating this vendor before a contract negotiation"]
</topic>
