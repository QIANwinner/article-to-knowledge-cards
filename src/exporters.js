/**
 * exporters.js — 四种导出格式
 *
 * 拆成独立模块的原因：导出格式是最容易长出 bug 的地方（编码、转义、字段对齐），
 * 每个格式都值得有自己的单元测试，而不是混在 UI 事件里靠手点。
 *
 * 格式一览：
 *   markdown  → 人读 / 笔记软件粘贴（默认，行为与 v0.1.4 保持一致）
 *   anki      → Anki 导入 CSV（tab 分隔，含文件头，UTF-8 BOM 防 Excel 乱码）
 *   json      → 机器读，含溯源锚点与调度状态，可再导入本应用
 *   obsidian  → Obsidian 双链笔记，tags 用 frontmatter
 */

const Exporters = (() => {
  'use strict';

  /**
   * 把卡片正文压成 Anki 正面：核心知识 + 解释。
   * 口径提示不进正面——它是元信息，塞进正面会让复习时噪音盖住知识点。
   */
  function ankiFront(card) {
    const parts = [card.core || '', card.plain ? `解释：${card.plain}` : ''];
    return parts.filter(Boolean).join('\n');
  }

  function ankiBack(card) {
    const parts = [];
    if (card.caveat) parts.push(`口径提示：${card.caveat}`);
    parts.push(`${card.exampleLabel || '例子'}：${card.example || ''}`);
    if (card.section) parts.push(`来源小节：${card.section}`);
    return parts.join('\n');
  }

  /** CSV 字段转义：tab / 引号 / 换行是 Anki 解析器的雷区 */
  function csvField(v) {
    const s = String(v == null ? '' : v);
    if (/[\t"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function toAnkiCsv(cards, meta = {}) {
    const header = [
      '#separator:tab',
      '#html:true',
      '#notetype:Basic',
      `#deck:${meta.deck || '知识卡片'}`,
      '#tags column:1',
      ''
    ].join('\n');
    const rows = cards
      .map((c) =>
        [
          csvField((c.tags || []).join(' ')),
          csvField(ankiFront(c)),
          csvField(ankiBack(c))
        ].join('\t')
      )
      .join('\n');
    return `${header}\n${rows}\n`;
  }

  /**
   * Markdown 导出。与 v0.1.4 的行为保持一致（分组、footer、来源声明、解释来源行），
   * 新增：库模式下带上复习状态。
   */
  function toMarkdown(cards, meta = {}) {
    const lines = [];
    if (meta.sourceName) {
      lines.push(`> 来源：${meta.sourceName}`);
      if (meta.stats) {
        lines.push(
          `> 小节 ${meta.stats.sections} · 候选 ${meta.stats.candidates} · ` +
            `通过判定 ${meta.stats.qualified} · 合并重复 ${meta.stats.merged}`
        );
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    const group = meta.groupBySection && cards.length > 25;
    let currentSection = null;
    for (const c of cards) {
      if (group && c.section !== currentSection) {
        if (currentSection !== null) lines.push('');
        lines.push(`## ${c.section}`);
        lines.push('');
        currentSection = c.section;
      }
      lines.push(`### 卡片 ${c.index} / Card ${c.index}. ${c.title}`);
      lines.push('');
      lines.push('**核心知识 / Core knowledge**');
      lines.push(c.core);
      lines.push('');
      lines.push('**简明解释 / Plain explanation**');
      lines.push(c.plain);
      lines.push(`_解释来源：${c.plainSource || '原文未提供'}_`);
      lines.push('');
      if (c.caveat && c.caveat.trim()) {
        lines.push('**口径提示 / Caveat**');
        lines.push(c.caveat);
        lines.push('');
      }
      lines.push(`**${c.exampleLabel || '例子 / Example'}**`);
      lines.push(c.example || '');
      lines.push('');
    }

    lines.push('---');
    lines.push(`**卡片数 / Cards**: ${cards.length}`);
    lines.push(`**来源 / Source**: ${meta.sourceName || '粘贴的文本'}`);
    lines.push(
      `**未收录 / Omitted**: ${meta.stats && meta.stats.rejected ? `${meta.stats.rejected} 段未通过资格判定（计划、框架句或无实质内容）` : '无'}`
    );
    if (meta.stats && meta.stats.merged) {
      lines.push(`**去重 / Deduplicated**: 合并 ${meta.stats.merged} 处重复论述`);
    }
    if (meta.disclaimers && meta.disclaimers.length) {
      lines.push(`**来源声明 / Source disclaimer**: ${meta.disclaimers.join(' ')}`);
    }
    if (meta.stats && meta.stats.plainGaps) {
      lines.push(
        `**解释缺口 / Gaps**: ${meta.stats.plainGaps} 张卡片的解释在原文中没有可引用的推导，已逐张标注「原文未提供」`
      );
    }
    lines.push('');
    lines.push('> 由 article-to-knowledge-cards 本地生成');
    return lines.join('\n');
  }

  /** JSON 导出：完整保留字段与调度状态，可原样导入回来 */
  function toJson(cards, meta = {}) {
    return JSON.stringify(
      {
        generator: 'article-to-knowledge-cards',
        version: 1,
        exportedAt: new Date().toISOString(),
        source: meta.sourceName || null,
        cards: cards.map((c) => ({
          index: c.index,
          title: c.title,
          section: c.section,
          core: c.core,
          plain: c.plain,
          plainSource: c.plainSource,
          plainGap: !!c.plainGap,
          caveat: c.caveat || '',
          exampleLabel: c.exampleLabel,
          example: c.example,
          tags: c.tags || [],
          schedule: {
            status: c.status,
            due: c.due,
            interval: c.interval,
            ease: c.ease,
            reps: c.reps,
            lapses: c.lapses,
            streak: c.streak,
            lastReview: c.lastReview,
            reviewCount: c.reviewCount
          }
        }))
      },
      null,
      2
    );
  }

  /** Obsidian 双链笔记：frontmatter tags + 指向来源的反链 */
  function toObsidian(cards, meta = {}) {
    const tagList = (meta.tags || []).join(' ');
    const sourceLink = meta.sourceName ? `\n\n来源：[[${meta.sourceName.replace(/\.[^.]+$/, '')}]]` : '';
    const blocks = cards.map((c) => {
      const lines = [];
      lines.push(`## ${c.title || '未命名卡片'}`);
      lines.push('');
      lines.push(c.core || '');
      lines.push('');
      if (c.plain) {
        lines.push(`> 解释：${c.plain}`);
        lines.push('');
      }
      if (c.caveat) {
        lines.push(`> [!warning] 口径提示`);
        lines.push(`> ${c.caveat}`);
        lines.push('');
      }
      lines.push(`**${c.exampleLabel || '例子'}**`);
      lines.push('');
      lines.push('```');
      lines.push(c.example || '');
      lines.push('```');
      lines.push('');

      // 卡片自己的标签必须落进正文，否则 Obsidian 里等于没有标签体系
      const own = (c.tags || [])
        .filter(Boolean)
        .map((t) => '#' + String(t).replace(/\s+/g, '-'))
        .join(' ');
      const parts = ['#知识卡片'];
      if (c.section) parts.push('#' + String(c.section).replace(/\s+/g, '-'));
      if (own) parts.push(own);
      lines.push(
        `---\n标签: ${parts.join(' ')} · 解释来源: ${c.plainSource || '原文未提供'}`
      );
      return lines.join('\n');
    });

    const header = [
      '---',
      `来源: ${meta.sourceName || '粘贴的文本'}`,
      `生成时间: ${new Date().toLocaleString('zh-CN')}`,
      `卡片数: ${cards.length}`,
      tagList ? `标签: [${tagList}]` : null,
      '---',
      ''
    ]
      .filter((x) => x !== null)
      .join('\n');

    return `${header}\n${blocks.join('\n---\n\n')}${sourceLink}\n`;
  }

  return { toMarkdown, toAnkiCsv, toJson, toObsidian, ankiFront, ankiBack, csvField };
})();

if (typeof window !== 'undefined') window.Exporters = Exporters;
if (typeof module !== 'undefined' && module.exports) module.exports = Exporters;