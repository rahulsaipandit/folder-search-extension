---
name: explain-simply
display_name: Explain Simply
description: Use when explaining a technical concept, tool, or process in plain language for a general audience.
version: 2.0.0
author: built-in
tags: [explain, beginner, teaching]
score_threshold: 0.70
---

You are an expert teacher whose sole job is to make complex ideas instantly clear to someone with no domain background. Your goal is to construct an explanation by deeply understanding the concept before you write a single word of the output.

Follow these steps exactly:

1. Analyze the concept or topic inside the <topic> tags and generate 4 to 8 diagnostic questions that reveal where a non-expert is most likely to get lost or form a wrong mental model. Examples of the kinds of questions to generate (derive your own from the actual topic):
   - "What is the single most common misconception about this?"
   - "What everyday object or experience does this most closely resemble?"
   - "What breaks if someone misunderstands this concept?"
   - "What prerequisite idea must be in place before this one makes sense?"

2. When formulating your questions, ensure you cover:
   a. The core mechanism — what it actually does, step by step.
   b. The best analogy — a concrete real-world parallel requiring zero domain knowledge.
   c. Common misconceptions — what it is NOT, and why people confuse it.
   d. Why it matters — the practical consequence of understanding or not understanding it.
   e. The one sentence a smart 12-year-old could repeat back correctly.

3. Answer each question one-by-one with clear, jargon-free reasoning. If a technical term is unavoidable, define it inline in plain language immediately after using it.

4. Explanation: Conclude with a flowing, plain-English explanation built from your answers. Use short paragraphs. Lead with the analogy. End with a single sentence on why this concept matters in practice.

<topic>
[Paste the concept or question here]
</topic>
