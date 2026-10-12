/**
 * ui.js — 共享 UI 工具
 *
 * 抽出这一层是为了让 library / review / app 三个面板共用同一套
 * 转义、toast、下载与弹窗逻辑——尤其是 escapeHtml：
 * 卡片正文全部来自用户粘贴的原文，任何一处漏转义就是一次 XSS。
 */

const UI = (() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /** 唯一的 HTML 转义入口：所有插入 innerHTML 的用户数据都必须过这里 */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 按钮上的临时文案反馈 */
  function flash(btn, msg, ms = 1600) {
    if (!btn) return;
    const old = btn.dataset.originalText || btn.textContent;
    btn.dataset.originalText = old;
    btn.textContent = msg;
    setTimeout(() => {
      btn.textContent = btn.dataset.originalText || old;
      delete btn.dataset.originalText;
    }, ms);
  }

  let toastTimer = null;
  function toast(msg, kind = 'info', action) {
    const slot = $('toast-slot');
    if (!slot) return;
    slot.hidden = false;
    slot.className = 'toast toast-' + kind;
    slot.innerHTML =
      `<span class="toast-msg">${escapeHtml(msg)}</span>` +
      (action ? `<button class="toast-action" type="button">${escapeHtml(action.label)}</button>` : '');
    if (action) {
      slot.querySelector('.toast-action').addEventListener('click', () => {
        action.onClick();
        hideToast();
      });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 6000 : 3200);
  }

  function hideToast() {
    const slot = $('toast-slot');
    if (!slot) return;
    slot.hidden = true;
    slot.innerHTML = '';
  }

  /** 触发浏览器下载（导出用） */
  function download(filename, content, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 立即 revoke 会让 Firefox 偶发下载失败，延迟一帧更稳
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 轻量确认：用原生 confirm，不自造弹窗。本地单机工具不值得为它写一套对话框 */
  function confirm(msg) {
    return typeof window !== 'undefined' && window.confirm(msg);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file, 'utf-8');
    });
  }

  function relativeTime(ts) {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.round(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)} 小时前`;
    return new Date(ts).toLocaleDateString('zh-CN');
  }

  /** 把 <br> 与段落安全地转成可注入的 HTML */
  function nl2br(s) {
    return escapeHtml(s).replace(/\n/g, '<br>');
  }

  return {
    $,
    escapeHtml,
    flash,
    toast,
    hideToast,
    download,
    copy,
    confirm,
    readFileAsText,
    relativeTime,
    nl2br
  };
})();

if (typeof window !== 'undefined') window.UI = UI;
if (typeof module !== 'undefined' && module.exports) module.exports = UI;