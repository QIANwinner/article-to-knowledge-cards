/**
 * card-engine.js — 卡片生成引擎
 *
 * 实现 SKILL.md 的核心判定规则（前端本地版本）：
 *   - 资格判据：能否被原文反驳（待办、计划、预测、未决问题不做卡）
 *   - 单知识点：一个 claim 一张卡，重复论述合并
 *   - 不编造：所有内容可回溯到原文句子
 *   - 不凑数：原文支持几张就出几张
 *
 * 说明：此引擎做的是「结构化抽取 + 规则筛选」，不含 LLM。
 * 语义层的取舍（原文哪句值得成卡、哪句算解释）仍由 Skill / 模型完成；
 * 本引擎负责把候选切分、过滤、去重、编号、渲染，并强制执行硬约束。
 *
 * 四条设计约束：
 *   1. 切分阈值只有一处来源 LIMITS，句数与字符数不会各切各的。
 *   2. 计划/未决句是硬边界，绝不与相邻断言粘进同一张卡。
 *   3. 解释字段不允许填模板句：能引到原文的因果句/相邻句就引，
 *      引不到就写明「原文未提供」并打 plainGap 标记，语义留给模型补。
 *   4. caveat 只搬运有原文证据的内容：原文自带声明、口径限定、紧邻的转折句。
 *      语义级矛盾（同一指标两个互斥数值且无任何标志词）规则引擎不判定，
 *      交由 Skill / 模型——宁可少标，不可凭空造冲突。
 */

const Engine = (() => {
  'use strict';

  const LIMITS = {
    ceiling: 128,          // 卡片总数上限
    maxSentences: 3,       // 单卡句数上限
    maxChars: 160,         // 单卡字符上限
    selfContained: 20,     // 达到此长度的句子自足成卡，不再与相邻句合并
    coreDisplay: 220,      // core 展示上限（超长单句截断，不改内容来源）
    minParaChars: 12,      // 段落短于此值不成候选
    minQualifyChars: 24,   // 候选短于此值不通过资格判定
    titleMax: 42,          // 标题截取长度
    dedupeThreshold: 0.72  // 2-gram Jaccard 去重阈值
  };

  /* ---------- 文本切分 ---------- */

  // 去掉 markdown 标题符号、列表符号、引用符号。
  // 注意：不清除行内强调标记（** * `），因为删除它们会改变原文字符序列，
  // 破坏「卡片内容可逐字回溯」这一硬约束。强调标记保留不影响可读性。
  function stripMarkdown(line) {
    return line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim();
  }

  function isHeading(line) {
    return /^\s{0,3}#{1,6}\s+/.test(line);
  }

  function isQuote(line) {
    return /^\s{0,3}>\s?/.test(line);
  }

  function isFence(line) {
    return /^\s*```/.test(line);
  }

  // 列表项各自成段：否则相邻多个 bullet 会被粘成一段，切出来的卡跨条目
  function isListItem(line) {
    return /^\s{0,3}([-*+]\s+|\d+[.)]\s+)/.test(line);
  }

  /**
   * 相邻两行的拼接。
   * 中文边界不插空格——原文换行处本就没有空格，插了会改变字符序列；
   * 英文字母/数字边界必须补一个空格，否则 "why the" + "default instinct"
   * 会粘成 "thedefault"，句子读不通，也不再是原文的样子。
   */
  function joinLines(parts) {
    let out = '';
    for (const p of parts) {
      if (!out) {
        out = p;
        continue;
      }
      const a = out[out.length - 1];
      const b = p[0];
      // ASCII 标点（句点、逗号）也算英文单词边界：断句后
      // "Eviction is cheap." + "Writing is not." 必须补空格，不能粘成 "cheap.Writing"
      const leftBoundary = /[A-Za-z0-9.,;:!?)\]]/.test(a);
      out += leftBoundary && /[A-Za-z0-9]/.test(b) ? ` ${p}` : p;
    }
    return out;
  }

  /**
   * 断句。句末标点保留在句子里；句点只在后接空白或结束时才断，
   * 小数点与缩写不断。
   */
  function splitSentences(para) {
    const out = [];
    let buf = '';
    for (let i = 0; i < para.length; i++) {
      const ch = para[i];
      buf += ch;
      if ('。！？；!?;'.includes(ch)) {
        out.push(buf);
        buf = '';
        continue;
      }
      if (ch === '.') {
        const next = para[i + 1];
        if (next === undefined || /[\s。！？；!?;"'”’)\]]/.test(next)) {
          out.push(buf);
          buf = '';
        }
      }
    }
    if (buf.trim()) out.push(buf);
    return out.map((s) => s.trim()).filter(Boolean);
  }

  /**
   * 把原文切成候选。
   * 切分规则只有一处来源：句数 ≤ LIMITS.maxSentences 且字符数 ≤ LIMITS.maxChars。
   * 三种硬边界，候选一律不跨越：
   *   - 段落边界
   *   - 计划/未决/预测句（NON_CARD_PATTERNS），这类句子独立成候选后被资格判定否掉
   *   - 自足句（长度 ≥ LIMITS.selfContained），单独成卡，不与邻句熔合
   * 每个候选带上前一句 / 后一句，供解释字段引用原文相邻句。
   */
  function segment(text) {
    const lines = text.split(/\r?\n/);
    const sections = [];
    const disclaimers = [];
    let current = { title: '正文', lines: [] };
    let inFence = false;
    let seenProse = false;

    const closeSection = () => {
      if (current.lines.some((l) => stripMarkdown(l))) sections.push(current);
    };

    for (const raw of lines) {
      if (isFence(raw)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      if (isHeading(raw)) {
        closeSection();
        current = { title: stripMarkdown(raw), lines: [] };
        continue;
      }

      if (isQuote(raw)) {
        const quoted = stripMarkdown(raw);
        // 正文开始前的引用块是原文自带的声明（虚构标记、时效声明、样本说明），
        // 整段搬进 footer 与 caveat，不参与候选抽取。
        if (!seenProse) {
          if (quoted.length >= LIMITS.minParaChars) disclaimers.push(quoted);
          continue;
        }
        current.lines.push(raw);
        continue;
      }

      if (!stripMarkdown(raw)) {
        current.lines.push('');
        continue;
      }

      seenProse = true;
      current.lines.push(raw);
    }
    closeSection();

    const candidates = [];

    function pushCandidate(sentences, units, from, to, sec, si) {
      // 用 joinLines 而非 join('')：断句后相邻句在英文里需要补一个空格，
      // 否则 "Eviction is cheap." + "Writing is not." 会粘成 "cheap.Writing"
      const text = joinLines(sentences);
      if (!text.trim()) return;
      candidates.push({
        id: candidates.length,
        text,
        sentences,
        prev: from > 0 ? units[from - 1] : null,
        next: to < units.length ? units[to] : null,
        section: sec.title,
        sectionIndex: si
      });
    }

    sections.forEach((sec, si) => {
      // 段落级切分：空行、列表项、超过段落上限都断
      const paras = [];
      let buf = [];
      const flushPara = () => {
        const t = joinLines(buf).trim();
        buf = [];
        if (t.length >= LIMITS.minParaChars) paras.push(t);
      };
      for (const line of sec.lines) {
        const clean = stripMarkdown(line);
        if (!clean) {
          flushPara();
          continue;
        }
        if (isListItem(line)) flushPara();
        buf.push(clean);
        if (joinLines(buf).length > LIMITS.maxChars * 2) flushPara();
      }
      flushPara();

      // 段落展开成句子，段落边界记为硬边界
      const units = [];
      for (const p of paras) {
        for (const s of splitSentences(p)) units.push(s);
        units.push(null); // 段落哨兵
      }
      if (units[units.length - 1] === null) units.pop();

      let start = null;
      let chars = 0;

      const flushChunk = (end) => {
        pushCandidate(units.slice(start, end), units, start, end, sec, si);
        start = null;
        chars = 0;
      };

      for (let i = 0; i < units.length; i++) {
        const u = units[i];

        // 段落边界
        if (u === null) {
          if (start !== null) flushChunk(i);
          continue;
        }

        // 计划/未决/预测句：独立成候选，随后由资格判定否掉
        if (nonCardReason(u)) {
          if (start !== null) flushChunk(i);
          pushCandidate([u], units, i, i + 1, sec, si);
          continue;
        }

        const len = u.length;

        // 自足句：单独成卡，不与前后句熔合
        if (start !== null && i > start && len >= LIMITS.selfContained) {
          flushChunk(i);
        }

        if (start === null) start = i;
        const count = i - start + 1;
        if (i > start && (count > LIMITS.maxSentences || chars + len > LIMITS.maxChars)) {
          flushChunk(i);
          start = i;
          chars = 0;
        }
        chars += len;
      }
      if (start !== null) flushChunk(units.length);
    });

    return { sections: sections.map((s) => s.title), candidates, disclaimers };
  }

  /* ---------- 资格判定 ---------- */

  const NON_CARD_PATTERNS = [
    { re: /^(待办|todo|to-do)\b|^(下周|下个月|明天|待办事项)/i, why: '计划' },
    { re: /还没定|尚未确定|待确认|还没想好|暂时没有|暂无/, why: '未决问题' },
    { re: /^(预计|预测|将会|未来会|估计会)/, why: '预测' },
    { re: /^作者(认为|指出)|^本文将|^接下来我们|^下面我们|^In this (article|post|note)/i, why: '框架句' }
  ];

  function nonCardReason(sentence) {
    for (const { re, why } of NON_CARD_PATTERNS) {
      if (re.test(sentence)) return why;
    }
    return '';
  }

  const CARD_SIGNALS = [
    /因为|所以|因此|导致|原因|使得|意味着|之所以/,
    /是\s|即为|等于|意味着|相当于|就是/,
    /规则|要求|必须|不能|禁止|允许|默认|只能|除非/,
    /\d+\s*(%|倍|万|亿|元|毫秒|秒|分钟|小时|天|GB|MB|KB|次|个|台|条|家|项|人)/,
    // 中文数量词也算实质信号：「重启了两次」「那次」同样是可被反驳的事实
    /[一二三四五六七八九十百千万两那这每]\s*(次|个|台|条|家|项|人|天|周|月|年|小时|分钟|秒|倍|成|部分)/,
    /都是|均为|全部是|只有|仅有|唯一|并非|而不是/,
    /如果.*那么|一旦|只要.*就|当.*时|除非/,
    /\bis\b|\bare\b|\bmust\b|\brequires?\b|\bcauses?\b|\bmeans\b|\benables?\b|\bthe only\b/i
  ];

  /** 命中多少条内容信号 */
  function signalCount(t) {
    return CARD_SIGNALS.filter((re) => re.test(t)).length;
  }

  /**
   * 判定候选是否可成卡。
   * 硬规则优先：命中排除模式直接排除；再要求有实质内容信号。
   */
  function qualify(candidate) {
    const t = candidate.text;

    const why = nonCardReason(t);
    if (why) return { ok: false, why };
    if (t.length < LIMITS.minQualifyChars) return { ok: false, why: '过短，无实质内容' };
    if (signalCount(t) === 0) return { ok: false, why: '无内容信号（无因果/规则/数字/条件）' };

    return { ok: true, signals: signalCount(t) };
  }

  /* ---------- 去重 ---------- */

  function normalize(t) {
    return t.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '');
  }

  /** 2-gram（中文）/ 词级（英文）Jaccard 相似度，用于识别重复论述 */
  function similarity(a, b) {
    const grams = (s) => {
      const out = new Set();
      if (/[一-龥]/.test(s)) {
        for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
      } else {
        for (const w of s.toLowerCase().split(/[^a-z0-9]+/)) if (w) out.add(w);
      }
      return out;
    };
    const ta = grams(a);
    const tb = grams(b);
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const g of ta) if (tb.has(g)) inter++;
    return inter / (ta.size + tb.size - inter);
  }

  function dedupe(qualified) {
    const kept = [];
    for (const cand of qualified) {
      const norm = normalize(cand.text);
      // 阈值 0.72：2-gram 下同义改写通常落在 0.5-0.7，主题相近的两句
      // 才会超过 0.72。原先 0.62 在中文语料上过于激进（9 条合并成 1 条）。
      const dup = kept.find((k) => similarity(k.norm, norm) > LIMITS.dedupeThreshold);
      if (dup) {
        dup.mergedFrom = (dup.mergedFrom || 1) + 1;
        continue;
      }
      cand.norm = norm;
      kept.push(cand);
    }
    return kept;
  }

  /* ---------- 卡片构建 ---------- */

  const UNIT_RE =
    /\d+(?:\.\d+)?\s*(?:%|倍|万|亿|元|毫秒|秒|分钟|小时|天|次|GB|MB|KB|条|家|项|个百分点)/gi;

  const CAUSAL_RE = /(?:因为|由于|所以|因此|导致|使得|之所以|原因是|代价是|取舍是)[^。；;]{4,}/;

  const MECHANISM_RE =
    /因为|由于|所以|因此|导致|使得|之所以|原因是|代价|取舍|取决于|前提是|意味着|换来|换不来|区别在于|\bbecause\b|\btherefore\b|\bso that\b|\bwhich means\b|\bthe reason\b|\bat the cost of\b|\binstead\b|\bwhereas\b|\bthe only\b/i;

  const SCOPE_RE =
    /统计口径|口径|样本量|数据来源|截至|仅覆盖|适用范围|只统计|\bdata as of\b|\bsample of\b|\bscope\b/i;

  // 「不过」必须独立成词——「编译不过」不是转折
  const CONTRAST_RE =
    /(?:^|[，,。；;：:!?！？\s])(?:但是|然而|不过|相反地|并非如此|反过来说)|\bbut\b|\bhowever\b|\bin contrast\b|\bconversely\b|\bwhereas\b/i;

  // 专名：书名号/引号内的名称，或大写英文词。用于判断原文声明是否适用这张卡。
  const ENTITY_RE = /[《「【][^》」】]{2,}[》」】]|\b[A-Z][A-Za-z]{2,}\b/;

  // 句首大写词与常见虚词不算术语
  const FUNCTION_WORDS = new Set([
    'The', 'This', 'That', 'These', 'Those', 'If', 'When', 'But', 'And', 'It', 'In',
    'On', 'For', 'With', 'To', 'Of', 'Is', 'Are', 'Be', 'Do', 'Does', 'So', 'Then',
    'There', 'Here', 'What', 'Why', 'How', 'Every', 'Never', 'Not', 'One', 'Two',
    'Three', 'They', 'Their', 'Its', 'As', 'By', 'At', 'We', 'You', 'Our', 'Read'
  ]);

  /** 抽取原文中的数字，作为例子的素材 */
  function findFigures(text) {
    const m = text.match(UNIT_RE);
    return m ? m.slice(0, 4) : [];
  }

  /**
   * 抽取原文里没有自解释的术语：引号内的名称，或非句首大写词。
   * 出现在句首的词是主语（原文正在解释的对象），不算「未定义术语」。
   */
  function findTerm(text) {
    const quoted = text.match(/[《「【]([^》」】]{2,12})[》」】]/);
    if (quoted) return quoted[1];
    // 允许全大写与多词专名：「OOM Killer」整体算一个术语，不该只取 OOM
    const re = /\b[A-Z][A-Za-z0-9]*(?:[ -][A-Z][A-Za-z0-9]*)+\b|\b[A-Z][A-Za-z]{2,}\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index === 0) continue;
      if (FUNCTION_WORDS.has(m[0])) continue;
      return m[0];
    }
    return '';
  }

  /**
   * 标题：只取本候选自己的第一句，长了就在句读或空格处收尾，
   * 不切断单词，也不会跨到上一段的残句。
   */
  function deriveTitle(cand) {
    const t = (cand.sentences[0] || cand.text).trim().replace(/[；;，,、]+$/, '');
    if (t.length <= LIMITS.titleMax) return t;

    const head = t.slice(0, LIMITS.titleMax);
    let cut = Math.max(
      head.lastIndexOf('，'),
      head.lastIndexOf(','),
      head.lastIndexOf('、'),
      head.lastIndexOf('：'),
      head.lastIndexOf(' ')
    );
    let body = cut > LIMITS.titleMax * 0.55 ? head.slice(0, cut) : head;

    // 截断点落在未闭合的括号里，回退到括号之前
    const open = Math.max(body.lastIndexOf('('), body.lastIndexOf('（'));
    if (open !== -1) {
      const tail = body.slice(open);
      const opened = (tail.match(/[（(]/g) || []).length;
      const closed = (tail.match(/[）)]/g) || []).length;
      if (opened > closed) body = body.slice(0, open);
    }

    return body.replace(/[\s，,、：:]+$/, '') + '…';
  }

  /**
   * 解释字段。三级取源，全部落在原文上：
   *   1. 候选内部的因果/机制子句
   *   2. 原文相邻句——带机制标志的，或同段里本身不成卡的承接句
   *   3. 都取不到 → 写明缺口并打 plainGap 标记，绝不填固定模板句
   */
  function derivePlain(cand) {
    const text = cand.text;

    const inText = text.match(CAUSAL_RE);
    if (inText && normalize(inText[0]) !== normalize(text)) {
      return { plain: inText[0], plainSource: '原文因果句', plainGap: false };
    }

    for (const nb of [cand.next, cand.prev]) {
      if (!nb || nb.length < 12) continue;
      if (similarity(normalize(nb), normalize(text)) > 0.5) continue;
      const hasMechanism = MECHANISM_RE.test(nb);
      const isCarry = !nonCardReason(nb) && signalCount(nb) === 0;
      if (hasMechanism || isCarry) {
        return { plain: nb, plainSource: '原文相邻句', plainGap: false };
      }
    }

    const figs = findFigures(text);
    const term = findTerm(text);
    if (figs.length) {
      return {
        plain: `原文给出「${figs[figs.length - 1]}」这一数值，但没有说明它的来源与统计口径，本卡不代为补足。`,
        plainSource: '原文未提供',
        plainGap: true
      };
    }
    if (term) {
      return {
        plain: `原文未定义「${term}」，也未展开该结论的推导，本卡只用它在原文中的具体表现。`,
        plainSource: '原文未提供',
        plainGap: true
      };
    }
    return {
      plain: '原文在此处直接给出结论，没有可展开的推导；本卡不补充原文之外的解释。',
      plainSource: '原文未提供',
      plainGap: true
    };
  }

  /**
   * 口径提示字段。只搬运有原文证据的内容，逐字引用：
   *   1. 原文自带声明（虚构标记 / 时效声明）——按 SKILL.md 只给带数字或专名的卡
   *   2. 相邻句里的口径限定语
   *   3. 紧邻的转折/相反表述
   */
  function deriveCaveat(cand, figures, disclaimers) {
    const parts = [];

    if (disclaimers && disclaimers.length) {
      // SKILL.md Step 1：声明适用于「带任何数字或专名」的卡，不限于带单位的数字
      const carries = /\d/.test(cand.text) || ENTITY_RE.test(cand.text);
      if (carries) parts.push(disclaimers[0]);
    }

    for (const nb of [cand.next, cand.prev]) {
      if (nb && nb.length >= 12 && SCOPE_RE.test(nb)) {
        parts.push(nb);
        break;
      }
    }

    if (cand.next && CONTRAST_RE.test(cand.next)) parts.push(cand.next);

    const uniq = [];
    for (const p of parts) {
      if (p && !uniq.some((u) => normalize(u) === normalize(p))) uniq.push(p);
    }
    return uniq.join(' ');
  }

  /** 例子与自测题二选一：原文有数字就用例，否则出题 */
  function deriveExample(cand, core, title, figures) {
    if (figures.length > 0) {
      return {
        exampleLabel: '例子 / Example',
        example: `原文出现的数值：${figures.join('、')}。直接取自原文，未做外推。`
      };
    }
    const term = findTerm(cand.text);
    const stem = term
      ? `问：原文如何解释「${term}」？`
      : `问：${title}，原文是怎么说的？`;
    return {
      exampleLabel: '自测题 / Self-test',
      example: `${stem}\n答案：${core}`
    };
  }

  function buildCard(cand, index, disclaimers) {
    // core 必须是原文的连续片段（可溯源），不做任何改写
    const core =
      cand.text.length > LIMITS.coreDisplay
        ? cand.text.slice(0, LIMITS.coreDisplay) + '…'
        : cand.text;

    const title = deriveTitle(cand);
    const figures = findFigures(cand.text);
    const { exampleLabel, example } = deriveExample(cand, core, title, figures);

    return {
      index,
      title,
      section: cand.section,
      core,
      ...derivePlain(cand),
      caveat: deriveCaveat(cand, figures, disclaimers),
      exampleLabel,
      example,
      mergedFrom: cand.mergedFrom || 1,
      raw: cand.text
    };
  }

  /* ---------- 主流程 ---------- */

  /**
   * 生成卡片。
   * @param {string} text 原文
   * @returns {{cards: Array, stats: Object}}
   */
  function generate(text) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();

    if (!text || !text.trim()) {
      return { cards: [], stats: emptyStats('原文为空') };
    }

    const { sections, candidates, disclaimers } = segment(text);
    const qualified = [];
    const rejected = [];

    for (const cand of candidates) {
      const v = qualify(cand);
      if (v.ok) qualified.push({ ...cand, signals: v.signals });
      else rejected.push({ ...cand, why: v.why });
    }

    const deduped = dedupe(qualified);
    const selected = deduped.slice(0, LIMITS.ceiling);
    const overCeiling = deduped.slice(LIMITS.ceiling);

    const cards = selected.map((c, i) => buildCard(c, i + 1, disclaimers));

    // 无可成卡内容时给出可执行的下一步
    let note = '';
    if (cards.length === 0) {
      note = rejected.length
        ? `原文切出 ${candidates.length} 个候选，全部未通过资格判定（多为计划、框架句或无实质内容）。原文信息不足，无法生成卡片。`
        : '原文太短，未找到可独立成卡的知识点。';
    } else if (cards.every((c) => c.plainGap)) {
      note = '全部卡片在原文中都没有可引用的推导，已逐张标注「原文未提供」。语义解释需交给模型补全。';
    }

    const t1 = (typeof performance !== 'undefined' ? performance : Date).now();

    return {
      cards,
      disclaimers,
      stats: {
        ...emptyStats(note),
        sections: sections.length,
        candidates: candidates.length,
        qualified: qualified.length,
        rejected: rejected.length,
        merged: qualified.length - deduped.length,
        overCeiling: overCeiling.length,
        caveats: cards.filter((c) => c.caveat).length,
        plainGaps: cards.filter((c) => c.plainGap).length,
        disclaimers: disclaimers.length,
        elapsed: Math.round(t1 - t0)
      }
    };
  }

  function emptyStats(note) {
    return {
      note,
      sections: 0,
      candidates: 0,
      qualified: 0,
      rejected: 0,
      merged: 0,
      overCeiling: 0,
      caveats: 0,
      plainGaps: 0,
      disclaimers: 0,
      elapsed: 0
    };
  }

  return { generate, segment, qualify, CEILING: LIMITS.ceiling, LIMITS };
})();

// 浏览器 / Tauri 环境导出
if (typeof window !== 'undefined') window.Engine = Engine;
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;