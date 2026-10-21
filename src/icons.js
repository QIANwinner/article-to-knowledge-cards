/**
 * icons.js — 内联 SVG 图标集
 *
 * 为什么不用 emoji：
 *   emoji 由系统字体渲染，同一个字符在 Windows / macOS / 手机上是不同的画风，
 *   且无法控制描边粗细与对齐。图标是路径，能被 CSS 精确控制
 *   （currentColor 继承、1.6 描边、24 网格对齐），缩放到任何尺寸都干净。
 *
 * 规范（照抄 Lucide 的做法，全站统一）：
 *   - 24×24 viewBox，图形内容占 20×20，四周留 2 的呼吸位
 *   - stroke 1.6，round linecap / linejoin，无填充
 *   - 颜色一律 currentColor，跟着文字走，不自己定义颜色
 *   - 名字用 kebab-case，函数返回可直接插入 innerHTML 的字符串
 */

const Icons = (() => {
  'use strict';

  const wrap = (paths, opts = {}) => {
    const size = opts.size || 20;
    const sw = opts.sw || 1.6;
    return `<svg class="icon${opts.cls ? ' ' + opts.cls : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
  };

  const P = {
    /* --- 导航 --- */
    // 生成：一支画笔加一道光
    wand: '<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M17.8 6.2 19 5"/><path d="M3 21 9.5 14.5"/><path d="m14 7 3 3"/>',
    // 卡片库：一叠卡片
    stack: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
    // 复习：时钟带箭头
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',

    /* --- 操作 --- */
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/>',
    eraser: '<path d="m4 15 6-6 8 8-4 4H8Z"/><path d="M9 21h11"/><path d="m8 7 4-4 8 8-4 4"/>',
    arrowRight: '<path d="M4 12h16"/><path d="m14 6 6 6-6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    quote: '<path d="M9 7H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a2 2 0 0 1-2 2"/><path d="M19 7h-4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a2 2 0 0 1-2 2"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
    file: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h4"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 14 9 5 9-5"/>',
    braces: '<path d="M8 4H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1"/><path d="M16 4h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2Z"/><path d="M19 17H6a2 2 0 0 0-2 2"/><path d="M8 7h7"/>',
    code: '<path d="m9 18-6-6 6-6"/><path d="m15 6 6 6-6 6"/>',
    monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
    inbox: '<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z"/>',
    flag: '<path d="M5 21V4"/><path d="M5 5h11l-1.5 3L16 11H5"/>',
    sparkline: '<path d="M3 16 8 10l4 4 7-8"/><path d="M17 6h2v2"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6.5 6.5 2.5 2.5M15 15l2.5 2.5M17.5 6.5 15 9M9 15l-2.5 2.5"/>',
    cards: '<rect x="6" y="3" width="13" height="17" rx="2"/><path d="M4 6v12a3 3 0 0 0 3 3h9"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    rotate: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'
  };

  /**
   * 取图标。
   * @param {string} name 图标名
   * @param {{size?:number, sw?:number, cls?:string}} opts
   */
  function icon(name, opts = {}) {
    const p = P[name];
    if (!p) {
      // 缺图标时返回空占位，而不是抛错把整个面板炸掉
      return `<svg class="icon" width="${opts.size || 20}" height="${opts.size || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"></svg>`;
    }
    return wrap(p, opts);
  }

  return { icon, names: Object.keys(P) };
})();

if (typeof window !== 'undefined') window.Icons = Icons;
if (typeof module !== 'undefined' && module.exports) module.exports = Icons;