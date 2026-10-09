# make-knowledge-cards

Turn an article — or a local Markdown / TXT file — into **up to 128 knowledge cards**. Each card carries exactly one idea, with a title, the core knowledge, a plain explanation, and either a concrete example drawn from the source or a self-test question.

This is an Agent Skill: it outputs one Markdown document, with no interface, no dependencies, and no network access. The repository also ships a local GUI and a 2.5 MB Windows executable.

[中文说明](README.md) · **Live demo**: <https://qianwinner.github.io/article-to-knowledge-cards/> (runs in the browser, nothing to download)

---

## 1. The problem it solves

The expensive part of reading an article is not the reading — it is forgetting afterwards. The real failure of "just summarize this into key points" is not length but **contamination**: the model tends to complete the source into a well-formed article, so the output contains sentences the source never said. Card counts are equally unreliable — a two-point note still comes back as five bullets.

The judgement standard here is a single question: **can this be disputed against the source?** Plans, to-dos, forecasts and open questions assert nothing yet, so they are not cards.

| Common failure | How this Skill handles it |
|---|---|
| True and false mixed together | Every point must point back to a specific line; if it cannot, it is not written |
| Repetition and padding | Restatements of one claim collapse into a single card |
| Inflated counts | A source with one point produces one card |
| Quietly completed content | No definitions, figures or examples from outside the source |
| Jargon left unexplained | Terms are explained only from the source's own usage, or marked as undefined |
| Disclaimers stripped away | Fiction markers and "data as of" notices are carried into the output |
| Contradictions smoothed over | Conflicts are preserved and flagged, never reconciled |

---

## 2. Card anatomy

Four required fields plus one conditional field:

| Field | Required | Content |
|---|---|---|
| Title | Yes | The specific idea (`Cold start kills collaborative filtering`), not the topic area |
| Core knowledge | Yes | One to three sentences — the claim itself, with the source's own figures and conditions |
| Plain explanation | Yes | Unpacks the mechanism or defines terms. **No new facts.** |
| Caveat | Conditional | Only when the source contradicts itself, mixes measurement scopes, or carries its own disclaimer |
| Example *or* Self-test | Yes (exactly one) | Never both |

Field labels stay bilingual in every language; card body language follows the source.

### Deduplication

Candidates that restate the same claim, or where one is meaningless without the other's sentence, merge into one card. Candidates that **share a sentence but each carry a payload the other lacks** (a different figure, a different conclusion, a different step of the mechanism) stay as two cards.

### No fabrication

Hard constraints, not preferences: no outside definitions, no real-world statistics, no names the source omitted, no invented authority. Examples come from the source, or are shown calculations over the source's own figures. Terminated claims ("as of last week") are never converted into calendar dates.

### No padding, no splitting

**128 is a ceiling, not a target.** A thin source produces a thin deck. A large ceiling never justifies splitting one idea across two cards.

| Strong candidates | Output |
|---|---|
| ≤ 128 | One card each, nothing omitted |
| > 128 | The excess is deferred or omitted, noted in the footer |
| 0 | No cards; the source contains only plans or open questions |

### Long-source batching

| Total cards | Delivery |
|---|---|
| 1 to 25 | One deck |
| 26 to 60 | One deck, grouped under the source's own headings |
| 61 to 128 | **Themed batches**, numbering continuous across batches |

---

## 3. Not supported

| Not supported | Notes |
|---|---|
| Web page fetching | No network access; paste the text instead |
| PDF / Word / Excel / PPT | Pasted text and local `.md` / `.txt` only |
| Anki export | No `.apkg`, no import CSV |

---

## 4. Install

The Skill has no dependencies, needs no build step and no environment variables. Copy the directory.

```bash
git clone https://github.com/QIANwinner/article-to-knowledge-cards.git
cp -r article-to-knowledge-cards/skills/make-knowledge-cards ~/.workbuddy/skills/
```

Windows PowerShell:

```powershell
git clone https://github.com/QIANwinner/article-to-knowledge-cards.git
Copy-Item -Recurse article-to-knowledge-cards\skills\make-knowledge-cards "$env:USERPROFILE\.workbuddy\skills\"
```

Verify:

```bash
node scripts/check-skill.js
```

### The GUI (optional)

Needs only Node.js ≥ 18 — **no `npm install`**, the frontend has zero dependencies:

```bash
cd article-to-knowledge-cards
npm run serve        # http://127.0.0.1:5178
```

Or open the live demo. To build the Windows executable, `npm install` is required.

---

## 5. How to use it

No special syntax after installation — just describe the task:

```
Turn this article into knowledge cards:

<paste the text>
```

```
Use make-knowledge-cards on ./docs/notes.md
```

Triggers: 知识卡片, 读书卡片, 卡片化, 做成卡片, knowledge cards, flashcards, make cards.

---

## 6. Example

Input — a short duty note with three items:

```text
快速记录，三件事。

1. 服务器今天重启了两次，都是内存打满自动触发的 OOM Killer。
2. 值班的时候记得确认监控告警通道是否正常，上周那次是告警短信发不出去，我们才知道磁盘满了。
3. 下周把日志清理脚本加上自动删除 30 天前的文件。

另外客户又问了一次那个接口超时的事，我先记在这里，还没定方案。
```

Output — two cards, because the source supports two disputable claims:

```markdown
### 卡片 1 / Card 1. 服务器当天两次重启均由 OOM Killer 触发

**核心知识 / Core knowledge**
服务器"今天"重启了两次，两次都是内存打满后自动触发的 OOM Killer。

**简明解释 / Plain explanation**
原文未定义「OOM Killer」，也未展开该结论的推导，本卡只用它在原文中的具体表现。

**自测题 / Self-test**
问：原文记录的这台服务器当天重启了几次？触发原因是什么？
答案：两次，都是内存打满后自动触发的 OOM Killer。

### 卡片 2 / Card 2. 上周磁盘写满未被及时发现，直接原因是告警短信发不出去
...

---
**卡片数 / Cards**: 2
**来源 / Source**: notes.txt
**未收录 / Omitted**: 原文偏薄，卡片数由内容决定而非凑数——第 3 条是计划，末段接口超时是未决问题，二者都没有可被反驳的断言。
```

Note what did **not** happen: the deck was not padded to five, the to-do did not become a card, the mechanism of OOM Killer was not supplied from outside the source, and there is no "disclaimer: none" line — the line is omitted entirely.

---

## 7. Project layout

```
article-to-knowledge-cards/
├── LICENSE / README.md / README.en.md / CHANGELOG.md
├── .github/workflows/         # ci.yml (tests) + pages.yml (live demo)
├── src/                       # frontend source, also the Pages publish directory
│   ├── index.html
│   ├── styles.css
│   ├── card-engine.js         # the rule engine
│   └── app.js                 # UI layer
├── src-tauri/                 # Tauri 2 shell (Rust)
├── scripts/                   # tests, skill check, exe build, preview server
├── release/                   # build output (exe, ~2.5 MB)
├── skills/make-knowledge-cards/
│   ├── SKILL.md
│   └── agents/openai.yaml
└── tests/samples/             # fixtures (fictional data)
```

**Stack**: plain HTML + CSS + JavaScript (no framework, no build step) inside a Tauri 2 shell. React + Vite would add hundreds of `node_modules` and a build layer for an interface that does three things — text input, card rendering, Markdown export.

### The rule engine

`card-engine.js` enforces the hard constraints locally. Two fields are easy to fake, so they get explicit rules:

| Field | Source order | When nothing can be quoted |
|---|---|---|
| Plain explanation | ① causal clause inside the candidate → ② adjacent sentence from the source | States "not provided in the source", flagged with an orange badge and counted in the footer. **Never a fixed template sentence.** |
| Caveat | ① the source's own disclaimer (verbatim) → ② measurement-scope wording in an adjacent sentence → ③ an immediately following contrast | The whole line is omitted, never filled with "none" |

The engine only moves content that has evidence in the source. Semantic-level contradictions — one metric with two mutually exclusive figures and no marker words at all — are left to the model rather than guessed at. The **Copy prompt** button in the UI is the exit for exactly this division of labour: the engine handles structure and hard constraints, the model handles semantics.

The engine contains no LLM. It does structured extraction and rule filtering; deciding *which* sentence deserves a card stays with the Skill or the model.

---

## 8. Build the Windows executable

```bash
npm install
npm run build:exe          # release/knowledge-cards.exe (~2.5 MB)
```

Prerequisites on Windows: Node.js ≥ 18, a Rust toolchain, and **Visual Studio Build Tools 2022** (MSVC linker + Windows SDK). See the Chinese README for the exact `vs_BuildTools.exe` invocation.

The build **must** set `RUSTFLAGS="--cfg has_std"`, otherwise compilation fails with `error[E0107]`. `has_std` is not a built-in rustc flag — it is emitted by `indexmap`'s build script via `autocfg`, and the probe fails on Rust 1.99, pushing `indexmap` into a `no_std` branch whose `IndexMap` lacks a default type parameter that `schemars` relies on. `scripts/build-exe.sh` sets the flag internally. Full analysis is in the Chinese README.

---

## 9. Tests

```bash
npm test              # 61 engine assertions + skill structure check
npm run test:engine   # engine assertions only
```

No `npm install` needed. Four fictional fixtures × 13 constraints, plus dedicated blocks for anti-padding behaviour, disclaimer preservation, text joining and boundary handling. GitHub Actions runs the same assertions on every push and pull request.

---

## 10. Design constraints

- **Traceable** — every figure, date, name and causal claim points back to a specific line
- **No outside knowledge** — no textbook definitions, no real statistics, no names the source omitted
- **Examples from the source only**, or shown calculations over the source's figures
- **No invented authority** — claims are never attributed to researchers or papers the source does not cite
- **No reclassification** — repackaging a to-do as a card adds no false fact but still inflates the deck
- **No splitting to fill a quota**
- **Terms never cross the line** — undefined terms are explained from the source's own usage or marked
- **Disclaimers and contradictions survive** into the output
- **The source's own time references** are preserved ("last week", "today") unless it supplies a date

---

## 11. Known limits

| Case | Engine behaviour |
|---|---|
| The source offers no explanation | Flagged as "not provided in the source"; semantics are left to the model via **Copy prompt** |
| Semantic-level contradictions | No caveat is emitted — the engine would rather under-report than invent a conflict |
| Code block placement | Fenced blocks are skipped; the Skill's "code to Example, compiler errors to core knowledge" rule is executed by the model |

---

## License

[MIT](LICENSE) © 2026 make-knowledge-cards contributors