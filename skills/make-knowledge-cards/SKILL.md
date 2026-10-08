---
name: make-knowledge-cards
description: Convert a pasted article or a local Markdown/TXT file into at most 8 knowledge cards, each carrying exactly one idea with a title, the core knowledge, a plain explanation, and either a concrete example drawn from the source or a self-test question. This skill should be used when the user asks to turn an article, blog post, report, documentation, or reading notes into knowledge cards, flashcards, 知识卡片, 读书卡片, or asks to "make cards out of this article", "做成一组卡片", "生成知识卡". Applies to text pasted in the conversation and to .md or .txt files on disk. It does not fetch web pages, does not process PDF or office documents, does not export to Anki, and does not build graphical interfaces.
---

# Make Knowledge Cards

## Overview

Turn one source text into a small deck of knowledge cards. Each card carries exactly one idea, states only what the source supports, and is self-verifying through an example or a self-test question.

The hard part is not formatting. It is selection: deciding what is worth remembering, and refusing to invent what the source does not contain. **The deck length follows the source.** A rich article yields 5 to 8 cards; a thin note may yield 2. Never add a card to make the deck look complete.

## Scope

**In scope**

- Text pasted directly into the conversation
- Local `.md` / `.markdown` / `.txt` files the user points to
- Deciding what to keep, how to split it, and in what order to present it

**Out of scope** — name the unsupported part and stop; do not improvise a workaround

- Web page fetching or URL scraping
- PDF, DOCX, XLSX, PPTX, image, or audio input
- Export to Anki or any flashcard-app format (`.apkg`, import CSV)
- Graphical interfaces, web pages, or interactive apps

When the input is out of scope, name the limitation and ask the user to paste the text or point to a Markdown/TXT file instead.

## What Counts as a Knowledge Point

A candidate qualifies only if it can be **disputed on its own** — a reader could point at the source and say "that part is wrong." This admits claims, mechanisms, procedures, rules, and hard numbers. It excludes:

| Source element | Card-eligible | Why |
|---|---|---|
| A stated fact, mechanism, rule, or figure | Yes | Can be checked against the source |
| A conclusion the source argues for | Yes | Same test as any claim |
| A plan, to-do, or intention ("next week we will add...") | No | Nothing is asserted yet, so nothing can be disputed |
| An open question with no answer in the source | No | Same reason |
| A promise or forecast about the future | No | Not yet true or false |
| Author framing, transitions, background padding | No | Carries no information |

Plans and open questions are not dropped silently. Mention them in the footer's `未收录 / Omitted` line so the reader knows they were seen and why they produced no card.

## Workflow

### Step 1: Obtain the source and judge whether it qualifies

If the user pasted the text, use it. If the user gave a file path, read it with the Read tool; if the path does not exist, ask rather than guessing. Read long files in full before selecting — never choose cards from a partial read.

If the user described an article but did not provide it, ask for the text. Do not generate cards from a description of an article.

Then check two things before selecting anything:

1. **Is there at least one disputable claim?** If the source is only plans and open questions, say so, produce no cards, and ask for material with actual content.
2. **Does the source carry its own disclaimers?** Fiction markers ("this article is fictional"), "data as of" notices, "for reference only" lines, and sourcing notes must survive into the output. Do not drop them as scaffolding — a deck stripped of its disclaimer reads as fact.

When a disclaimer exists, it applies to **every card that carries any figure from the source**, which is usually all of them. Put it in each such card's Caveat field as the caveat's first sentence, and repeat it verbatim in the footer's disclaimer line. Cards that carry no figures need only the footer line.

### Step 2: Survey before selecting

Read the whole source once and build an internal candidate list. This list is a working note for Step 2 rules and Step 5 — it is **not** part of the delivered output. For each candidate record:

- Where it appears (heading or paragraph)
- Its type: claim, mechanism, procedure, rule, number, or anecdote
- Whether it repeats an earlier candidate
- Whether the source's own disclaimer qualifies it

Then pick the candidates worth cards, using these rules **in this order**:

1. **Load-bearing first.** Claims the rest of the source depends on: definitions, core mechanisms, stated conclusions, rules the source operates by.
2. **Consequences over trivia.** What changes if the reader acts on this.
3. **Specific over general.** A concrete number, mechanism, or procedure beats a vague summary sentence.
4. **Drop the scaffolding.** Skip author framing, transitions, background padding, and self-promotion unless they carry content themselves. Keep the source's disclaimers — see Step 1.
5. **Merge duplicates.** See the merge test below.

Rule 1 is a filter, rules 2 and 3 rank within what survives it. A candidate is **strong** when rule 1 or rule 2 keeps it and rule 3 finds something concrete in it. When two strong candidates tie, break the tie in this order:

1. Prefer the one other candidates depend on.
2. Prefer the one the source itself flags as a conclusion or a rule.
3. Prefer the one carrying more of the source's own specific figures or conditions.
4. If still tied, keep the earlier one in source order and list the other in the footer's Omitted line.

**The merge test.** Two candidates are one card when either holds:

- They restate the same claim, even in different words.
- One is meaningless without the other's sentence to make sense of it.

Two candidates that **share a sentence but each carry a payload the other lacks** stay as two cards. Shared material may appear in both, unexpanded; each card states only its own payload. Examples of payloads that keep cards apart: a distinct figure, a distinct conclusion, a distinct mechanism step. If either card has no payload of its own after the split, they must merge.

**Enumerations.** A list under one sentence ("three numbers decide...", "the causes are A, B, and C") splits into separate candidates — each item is independently disputable. Keep it as one card only when no item stands on its own without the others, such as a rule whose parts define each other.

### Step 3: Set the card count

The ceiling is 8. There is no floor and no quota. Count only the candidates that passed the Step 2 rules, and pick the number the source supports:

- **8 or more strong candidates** — keep the best 8 using the Step 2 tie-break order, and name the omitted ideas in the footer.
- **4 to 7 strong candidates** — one card each, no comment needed.
- **1 to 3 strong candidates** — one card each, plus a footer note that the source is thin and the deck is short by necessity.
- **0 candidates** — produce no cards. Say the source contains only plans or open questions and ask for material with actual content.

Never invent a card to reach any number. A fabricated card is a worse failure than a short deck.

### Step 4: Write each card

A card has four required fields and one conditional field, in this order:

```markdown
### 卡片 N / Card N. <specific title>

**核心知识 / Core knowledge**
<One to three sentences. The claim itself, with the source's own numbers, names, and conditions.>

**简明解释 / Plain explanation**
<Two to four sentences, or fewer when the source supports no more. Unpack the mechanism or define terms the core knowledge uses. No new facts.>

**口径提示 / Caveat** *(optional, only when needed)*
<Source contradictions, inconsistent measurement scope, or the source's own uncertainty. Omit the field entirely when there is nothing to flag.>

**例子 / Example** *or* **自测题 / Self-test** *(exactly one)*
<Example: a case, code snippet, log line, command, or worked calculation taken from the source.>
<Self-test: a question answerable from this card alone, answer on the next line.>
```

**Card grammar**

- `### 卡片 N / Card N.` — keep the bilingual prefix so numbering is scannable across languages.
- Field labels stay bilingual in every language.
- Use the self-test answer prefix `Answer:` for English cards and `答案：` for Chinese cards.
- The Caveat field is the only sanctioned place for contradiction flags. When a source disagrees with itself, keep both statements and put the disagreement here — never reconcile them silently.

**Field rules**

- **Title** names the specific idea ("Cold start kills collaborative filtering"), not the topic area ("Recommendation systems").
- **Core knowledge** is testable on its own: a reader who disputes it can point at the source sentence. Keep it to the source's own facts. Keep the source's own time references ("上周", "today") rather than converting them to calendar dates, unless the source supplies the date. Identifiers, error codes, and commands that belong inside the claim appear here as inline code — see the artifact rule below for when an artifact moves to the Example slot instead.
- **Plain explanation** unpacks the mechanism; it never restates the core knowledge in different words. Readability means the reader can follow the reasoning, not that they master every term — see the term rule below.
- **Caveat** appears only when needed. Use it for source-internal disagreement, mismatched measurement scope, or an unresolved alternative the source leaves open.
- **Example** and **Self-test** are mutually exclusive. One artifact per card. When the source offers both a snippet and a question, keep the snippet and drop the question.

**Where non-prose artifacts go**

Two placements, decided in this order:

1. **Default — Example**, as a fenced block, verbatim: code snippets, commands, config fragments, log lines, error messages, and figures that are themselves the clearest case.
2. **Core knowledge, inline code — only when the Example slot is already taken** by a snippet, or when the artifact is error/terminal output that appears immediately after the claim it proves and is what makes the claim checkable.

That order is absolute: check slot availability before choosing a placement. When both slots are free, the artifact goes to the Example. When the source's only concrete artifact is a code snippet, it is the Example and the card then has no self-test.

Compiler error codes and terminal output that prove a claim are the common case for placement 2 — they are evidence, not illustration.

**The term rule**

The source often does not define its own jargon. The test for whether a word is a term: a reader who knows the source's other content would still be blocked by this word. Apply the rule only to words that pass that test — ordinary words, and words the source itself defines or uses self-explanatorily, are left alone.

1. Ground it with the source's own usage — quote or paraphrase how the source uses the term elsewhere in the text, including a different section. A fact that exists in the source only to make this term usable is explanatory material for this card, not a card of its own.
2. If the source gives nothing, do not supply a textbook definition. Explain by unpacking the concrete facts the source does give. Close the explanation with the gap marker as its last sentence: "原文未定义 X，本卡只用它在原文中的具体表现" (or "The source does not define X; this card uses only how it shows up concretely"). When the source does supply enough to unpack, no marker is needed.
3. Reaching outside the source for a definition breaks the anti-fabrication rule and is not allowed, even when the definition is textbook-correct.

Readability is judged as "the reader can follow what this claim is doing," not "the reader could pass an exam on the jargon."

**Quoting figures from an omitted candidate.** A candidate dropped for the 8-card ceiling may still have its figures quoted inside another card's explanation, under the same rules as any other source material — stated inline, not expanded, and never as a derived calculation. This is how a merged or trimmed idea still reaches the reader.

**Derived figures**

Arithmetic on the source's own figures is allowed, because a shown calculation is auditable:

- Permitted: sums, differences, ratios, percentages, and unit conversions over figures present in the source.
- Show the calculation inline (`1850 − 1540 = 310`).
- Not permitted: introducing a figure the source does not contain and extrapolating from it, or chaining calculations into an estimate the source never makes.

Derived figures belong in the Example field, never in the core knowledge.

### Step 5: Run the fidelity check

Before delivering, check each card against these. Any "no" means rewrite or cut the card; do not ship it.

1. Is every factual statement traceable to a specific line in the source?
2. Did any number, date, name, or causal claim appear that the source does not contain? (Derived figures shown with their calculation are exempt; see the rule above.)
3. Does the card cover one idea, or did two get fused?
4. Does another card say substantially the same thing — sharing a claim, not merely a topic?
5. Can a reader follow the reasoning in the plain explanation without the original article?
6. Does the Example or the self-test answer point back into this same card?
7. Did any term get a definition the source does not supply?
8. Did the source's disclaimer survive into the output?

**Cutting a card.** When the core knowledge survives but the plain explanation cannot be written without inventing facts, do not pad and do not fabricate. Cut the card and lower the count, then note it in the footer. A deck of 4 honest cards beats a deck of 6 with 2 invented explanations.

This check is an internal step. Do not show it to the user unless they ask.

### Step 6: Deliver

Output the cards in Markdown as rendered text, not wrapped in a code fence, with no extra top-level heading. Order them by the source's own section order; within one section, order by importance.

Follow with a footer of at most four lines:

```markdown
---
**卡片数 / Cards**: N
**来源 / Source**: <file name or "pasted text">
**未收录 / Omitted**: <ideas dropped as duplicates, and ideas dropped because the count hit 8 — name them; write "无" only when nothing was dropped at all>
**来源声明 / Source disclaimer**: <verbatim disclaimer — this line is included only when the source carries one, and is omitted entirely otherwise>
```

Write the footer in the card language. Omit the disclaimer line when there is no disclaimer; do not write 无. When the source is thin, say so in the `未收录` line. Distinguish the two omission reasons when both apply:

```
**未收录 / Omitted**: 合并——C 与 D 讲同一机制，保留 C。超上限——E、F 未收录，因为候选超过 8 张。
```

## Anti-Fabrication Rules

Hard constraints, not preferences.

- **No outside knowledge.** Every fact comes from the source. Do not add the textbook explanation of a concept, real-world statistics, or names the source omitted. If the source is thin on a point, the card is thin.
- **No invented examples.** Examples come from the source, or are shown calculations over the source's figures.
- **No invented authority.** Do not attribute claims to researchers, standards bodies, or papers the source does not cite.
- **No reclassification.** Repackaging a plan, a to-do, or an open question as a card adds no false fact yet still inflates the deck. See the eligibility table.
- **No filling the count.** Short output with an honest note beats padded output.
- **Mark the gaps.** When something is missing, name it. Non-numeric gaps use the term rule's phrasing; numeric gaps use `原文未给出具体数值` / `The source gives no figure for this`.
- **Keep contradictions.** Two conflicting statements stay, with the conflict flagged in the Caveat field.
- **Keep disclaimers.** Fiction markers and sourcing notices reach the footer verbatim.

## Language

Match the source's language: a Chinese source produces Chinese cards, an English source produces English cards, a mixed source follows the majority language. Field labels stay bilingual in every case. The self-test answer prefix and the gap-marker phrases follow the card language, not the label language.

## Anti-Patterns

| Symptom | Cause | Fix |
|---|---|---|
| 8 cards, all vague | Vague candidates selected | Re-select from the Step 2 candidate list |
| Two cards covering one idea | Splitting happened before merging | Apply the merge test |
| Examples with numbers absent from the source | A plausible case was invented | Delete it; use a self-test instead |
| Core knowledge is a specific number the source never states | A figure was extrapolated | Delete it, or show the calculation over source figures |
| Explanation restates the core knowledge | Paraphrase written instead of unpacking | Explain the mechanism or ground the term |
| A textbook definition appears in the explanation | Term rule ignored | Ground it in the source's own usage, or name the gap |
| Titles like "Introduction to X" | Topic instead of specific claim | Name the claim |
| "The author argues that..." framing | Scaffolding leaked in | State the knowledge directly |
| Plans and open questions became cards | Eligibility table ignored | Move them to the footer's Omitted line |
| Padding to reach a target number | Count treated as a quota | Cut to the real count and note it |
| Disclaimer dropped as scaffolding | Step 1 check skipped | Carry it into the footer verbatim |
| Disagreement silently resolved | Caveat field skipped | Keep both, flag in the Caveat field |