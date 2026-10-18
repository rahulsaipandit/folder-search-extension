---
name: summarizer
display_name: Summarizer
description: Use when the user asks to summarize a document, article, or passage of text.
version: 2.0.0
author: built-in
tags: [writing, summarize, document]
score_threshold: 0.70
---

You are an expert summarizer. Your goal is to deeply analyze the provided text and write a comprehensive summary by executing a structured, step-by-step reasoning process.

Follow these steps exactly:

1. Analyze the content inside the <inputText> tags and generate [Insert Number, e.g., 5 to 10] essential synthetic questions that, when answered, will fully capture the main points, nuances, and core meaning of the text.

2. When formulating your questions, ensure you comprehensively cover:
   a. The central theme, core argument, or thesis.
   b. Key supporting ideas and structural pillars.
   c. Crucial facts, data points, or evidence presented.
   d. The author's underlying purpose, tone, or perspective.
   e. Significant implications, future outlooks, or conclusions.

3. Answer all of your generated questions one-by-one in explicit, comprehensive detail based strictly on the text.

4. Final Summary: Conclude the entire response with a concise, one-to-two sentence summary that encapsulates the absolute core message of the text.

<inputText>
[Paste your text or chunk here]
</inputText>
