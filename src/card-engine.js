/**
 * card-engine.js — 卡片生成引擎
 *
 * 实现 SKILL.md 的核心判定规则（前端本地版本）：
 *   - 资格判据：能否被原文反驳（待办、计划、预测、未决问题不做卡）
 *   - 单知识点：一个 claim 一张卡，重复论述合并
 *   - 不编造：所有内容可回溯到原文句子
 *   - 不凑数：原文支持几张就出几张
 *
 * 说明：此引擎做的是「结构化抽取 + 规则筛选」，不含LLM。
 * 语义层面的取舍（原文哪句值得成卡）仍由 Skill / 模型完成；
 * 本引擎负责把候选切分、过滤、去重、编号、渲染，并强制执行硬约束。
 */

const Engine = (() => {
  'use strict';

  const CEILING = 128;

  /* ---------- 文本切分 ---------- */

  // 去掉 markdown 标题符号、列表符号、引用符号。
  // 注意：不清除行内强调标记（** * `），因为删除它们会改变原文字符序列，
  // 破坏「卡片内容可逐字回溯」这一硬约束。强调标记保留不影响可读性。
  function stripMarkdown(line) {
    return line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim();
  }

  function isHeading(line) {
    return /^\s{0,3}#{1,6}\s+/.test(line);
  }

  // 代码块标记，用于跳过
  function isFence(line) {
    return /^\s*```/.test(line);
  }

  /**
   * 把原文切成候选段落。保留 section 归属，供后续分组与去重。
   */
  function segment(text) {
    const lines = text.split(/\r?\n/);
    const sections = [];
    let current = { title: '正文', lines: [] };
    let inFence = false;

    for (const line of lines) {
      if (isFence(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      if (isHeading(line)) {
        if (current.lines.some((l) => stripMarkdown(l))) sections.push(current);
        current = { title: stripMarkdown(line), lines: [] };
        continue;
      }
      current.lines.push(line);
    }
    if (current.lines.some((l) => stripMarkdown(l))) sections.push(current);

    const candidates = [];
    sections.forEach((sec, si) => {
      // 段落级切分：空行或短句聚为一组
      let buf = [];
      const flush = () => {
        // 用空串拼接而非空格：原文换行处不应插入原文没有的字符，
        // 否则卡片内容无法逐字回溯到原文（可溯源性硬约束）。
        const text = buf.join('').trim();
        buf = [];
        if (text.length < 12) return; // 太短，撑不起一张卡
        candidates.push({
          id: candidates.length,
          text,
          section: sec.title,
          sectionIndex: si
        });
      };
      for (const line of sec.lines) {
        const clean = stripMarkdown(line);
        if (!clean) {
          // 原文空行是段落边界：若当前块已有内容，先切一刀再 flush，
          // 否则「小标题式换行」（如「下滑的原因有两层。」独立成行）
          // 会与其后的正文糊成一张多句卡。
          if (buf.length) flush();
          continue;
        }
        buf.push(clean);

        // 切分点1：句数超限（>3 句）即断
        const joined = buf.join('');
        const parts = joined.split(/(?<=[。！？])/);
        if (parts.filter((s) => s.trim()).length > 3) {
          // 保留到第3 句结束，其余留作下一个候选（不丢内容）
          const head = [];
          let count = 0;
          for (const p of parts) {
            head.push(p);
            if (p.trim()) count++;
            if (count === 3) break;
          }
          const rest = parts.slice(head.length);
          buf = [];
          const headText = head.join('').trim();
          if (headText.length >= 12) {
            candidates.push({ id: candidates.length, text: headText, section: sec.title, sectionIndex: si });
          }
          buf.push(...rest);
          continue;
        }
        if (clean.length > 200) flush();
      }
      flush();
    });

    return { sections: sections.map((s) => s.title), candidates };
  }

  /* ---------- 资格判定 ---------- */

  const NON_CARD_PATTERNS = [
    { re: /^(待办|todo|to-do)\b|^(下周|下个月|明天|待办事项)/i, why: '计划' },
    { re: /还没定|尚未确定|待确认|还没想好|暂时没有|暂无/, why: '未决问题' },
    { re: /^(预计|预测|将会|未来会|估计会)/, why: '预测' },
    { re: /^作者(认为|指出)|^本文将|^接下来我们|^下面我们|^In this (article|post|note)/i, why: '框架句' }
  ];

  const CARD_SIGNALS = [
    /因为|所以|因此|导致|原因|使得/,
    /是\s|即为|等于|意味着|相当于/,
    /规则|要求|必须|不能|禁止|允许|默认/,
    /\d+\s*(%|倍|万|亿|毫秒|秒|分钟|小时|天|GB|MB|KB|次|个|台|人)/,
    /如果.*那么|一旦|只要.*就|当.*时/,
    /\bis\b|\bare\b|\bmust\b|\brequires?\b|\bcauses?\b|\bmeans\b|\benables?\b/i
  ];

  /**
   * 判定候选是否可成卡。
   * 硬规则优先：命中排除模式直接排除；再要求有实质内容信号。
   */
  function qualify(candidate) {
    const t = candidate.text;

    for (const { re, why } of NON_CARD_PATTERNS) {
      if (re.test(t)) return { ok: false, why };
    }
    if (t.length < 24) return { ok: false, why: '过短，无实质内容' };

    const signals = CARD_SIGNALS.filter((re) => re.test(t)).length;
    if (signals === 0) return { ok: false, why: '无内容信号（无因果/规则/数字/条件）' };

    return { ok: true, signals };
  }

  /* ---------- 去重 ---------- */

  function normalize(t) {
    return t.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '');
  }

  /** 词级 Jaccard 相似度，用于识别重复论述 */
  function similarity(a, b) {
    // 中文按 2-gram、英文按词切分，避免中文单字 Jaccard 失真
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
      const dup = kept.find((k) => similarity(k.norm, norm) > 0.72);
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

  const NO_DEFINITION = '原文未定义该术语，本卡只用它在原文中的具体表现';
  const NO_FIGURE = '原文未给出具体数值';

  /** 抽取原文中的数字，作为例子的素材 */
  function findFigures(text) {
    const m = text.match(/\d+(?:\.\d+)?\s*(?:%|倍|万|亿|毫秒|秒|分钟|小时|天|次|GB|MB|KB)/gi);
    return m ? m.slice(0, 4) : [];
  }

  function buildCard(cand, index) {
    // core 必须是原文的连续片段（可溯源），不做任何改写
    const core = cand.text.length > 200 ? cand.text.slice(0, 198) + '…' : cand.text;

    // 标题取 core 内第一个完整短句，保证是原文子串
    const firstSentence = core.split(/[。；;！!？?]/)[0].trim();
    const title = (firstSentence || core).slice(0, 42);

    const text = core;
    const figures = findFigures(text);

    let plain = '';
    if (/因为|所以|因此|导致|使得/.test(text)) {
      const idx = text.search(/因为|所以|因此|导致|使得/);
      plain = text.slice(Math.max(0, idx), idx + 150).replace(/^[，。；、]/, '');
    } else if (/如果.*那么|一旦|只要/.test(text)) {
      const idx = text.search(/如果.*那么|一旦|只要/);
      plain = text.slice(idx, idx + 150);
    } else {
      plain = '原文直接给出该结论，未展开推导过程。本卡只复述原文主张，不补充原文之外的解释。';
    }
    if (!plain) plain = NO_DEFINITION;

    // 例vs 自测：原文有数字就用例，否则用自测题
    let fieldName, fieldBody;
    if (figures.length > 0) {
      fieldName = '例子 / Example';
      fieldBody = `原文出现的数值：${figures.join('、')}。直接取自原文，未做外推。`;
    } else {
      fieldName = '自测题 / Self-test';
      fieldBody = `问：${title}，原文是怎么说的？\n答案：${core}`;
    }

    return {
      index,
      title,
      section: cand.section,
      core,
      plain,
      exampleLabel: fieldName,
      example: fieldBody,
      mergedFrom: cand.mergedFrom || 1,
      raw: text
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

    const { sections, candidates } = segment(text);
    const qualified = [];
    const rejected = [];

    for (const cand of candidates) {
      const v = qualify(cand);
      if (v.ok) qualified.push({ ...cand, signals: v.signals });
      else rejected.push({ ...cand, why: v.why });
    }

    const deduped = dedupe(qualified);
    const selected = deduped.slice(0, CEILING);
    const overCeiling = deduped.slice(CEILING);

    const cards = selected.map((c, i) => buildCard(c, i + 1));

    // 无可成卡内容时给出可执行的下一步
    let note = '';
    if (cards.length === 0) {
      note = rejected.length
        ? `原文共${candidates.length} 个段落，全部未通过资格判定（多为计划、框架句或无实质内容）。原文信息不足，无法生成卡片。`
        : '原文太短，未找到可独立成卡的知识点。';
    }

    const t1 = (typeof performance !== 'undefined' ? performance : Date).now();

    return {
      cards,
      stats: {
        ...emptyStats(note),
        sections: sections.length,
        candidates: candidates.length,
        qualified: qualified.length,
        rejected: rejected.length,
        merged: qualified.length - deduped.length,
        overCeiling: overCeiling.length,
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
      elapsed: 0
    };
  }

  return { generate, segment, qualify, CEILING };
})();

// 浏览器 / Tauri 环境导出
if (typeof window !== 'undefined') window.Engine = Engine;
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;