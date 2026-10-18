---
name: meeting-insights
display_name: Meeting Transcript Insights
description: Use when the user has a meeting transcript and wants it turned into a polished document — executive summary, action items, decisions, risks, and progress tracking — tailored to a specific audience.
version: 1.0.0
author: built-in
tags: [meeting, transcript, summary, action-items, notes, minutes, executive-summary]
score_threshold: 0.70
---

You are turning a raw meeting transcript into a structured, audience-ready document. A flat transcript summary loses the things that actually matter to a reader who wasn't in the room — decisions, owners, deadlines, risks, and open questions. Work through the transcript inside the <transcript> tags using the variables below, and produce one cohesive document, not a series of disconnected notes.

MEETING_TYPE=[Type of meeting, e.g., project update, brainstorming session, board meeting]
AUDIENCE=[Intended audience for the final document, e.g., senior management, project stakeholders, the team itself]

Work through these steps in order, in full, without skipping any:

1. **Orient** — Identify the main participants and their roles from the TRANSCRIPT. Note the overall structure and flow of the meeting (agenda items, order of topics, who drove which parts).
2. **Extract** — Pull out the key discussion points, decisions made, and action items. Organize these into a logical structure grouped by topic, not by chronological order of speech.
3. **Objectives** — Summarize the meeting's stated objectives and how each was actually addressed (fully resolved, partially addressed, deferred).
4. **Insights & data** — Identify critical insights, innovative ideas, or important data points mentioned. Flag anything that would otherwise get buried in a chronological transcript.
5. **Executive summary** — Write a concise summary of the meeting's essence, outcomes, and next steps, tailored in tone and depth to AUDIENCE (e.g., a board gets strategic framing; the working team gets tactical detail).
6. **Action items** — Build a table of action items: task, owner, deadline, and source discussion point. If a transcript doesn't state an owner or deadline explicitly, mark it "unassigned" / "no deadline" rather than inventing one.
7. **Metrics & KPIs** — Extract any quantitative data, metrics, or KPIs mentioned. Present as a table or bullet list, not prose.
8. **Risks & concerns** — Summarize risks, challenges, or concerns raised, paired with any mitigation strategies discussed. Note explicitly if a risk was raised but left unaddressed.
9. **Decisions & rationale** — List key decisions made and the reasoning behind them, so a reader can see *why*, not just *what*.
10. **Resources requested** — Compile any tools, resources, or follow-up information mentioned or requested during the meeting.
11. **Next steps** — Outline the immediate actions following the meeting, distinct from the full action-item table (this is the short "what happens this week" view).
12. **Progress tracking** — If the meeting touched ongoing projects or initiatives, add a section tracking status against prior milestones.
13. **Sensitivity pass** — Review the draft for clarity and relevance to AUDIENCE. Redact or generalize anything confidential or sensitive that shouldn't appear in a document with this audience's distribution.
14. **Assemble** — Add a table of contents, then output the sections in this order: Executive Summary, Objectives & Outcomes, Key Decisions, Action Items, Metrics & Data, Risks & Mitigations, Resources Requested, Next Steps, Progress Tracking, Appendix (participants, full discussion notes).
15. **Close** — End with a one-paragraph note on what this document gives AUDIENCE that the raw transcript didn't.

<transcript>
[Paste the full meeting transcript here]
</transcript>
</content>
