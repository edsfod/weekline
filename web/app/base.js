/*
 * 周时间轴 · 界面层 · 基础
 * 建立共享命名空间 WeekApp（下称 A），放入常量、界面元素、状态和通用工具。
 *
 * 界面层由 src/app/ 下的多个文件组成，build.sh 按固定顺序拼接：
 *   base → state → page → render → textview → edit → input → menus → files → main
 * 每个文件是一个自执行函数，把自己的函数挂到 A 上。文件开头可以直接取用
 * 排在它前面的文件提供的函数；调用排在后面的文件的函数时写作 A.xxx()。
 * 计划文档的所有变化都经由 WeekCore（src/core.js）的纯函数计算。
 */
(function () {
  'use strict';
  var C = window.WeekCore;
  var A = window.WeekApp = {};

  A.C = C;
  A.SLOT = C.SLOT;
  A.HEAD_W = 172;                  // 与 app.css 的 --head-w 相同
  A.MIN_CW = 24;
  A.HISTORY_LIMIT = 500;
  A.EDGE_PX = 6;
  A.DBL_MS = 450;
  A.LS_VIEW = 'weekline.view';
  A.IS_MAC = /Mac/.test(navigator.platform);

  /** 当前日期（本地时区），'YYYY-MM-DD'；不经过区域设置格式化 */
  A.todayStr = function () {
    var d = new Date();
    return d.getFullYear() + '-' + C.pad2(d.getMonth() + 1) + '-' + C.pad2(d.getDate());
  };

  /** 计划文件不存在时新建用的示例（需求 7.4 节、FR-7.13）；起始日取当前日期所在周的第一天 */
  A.seedText = function (today) {
    return [
      '# 本周时间安排', '范围 07:00-22:30', '一周起始 周日', '起始日 ' + C.weekFirst(today, 0), '',
      '## 唯一模板', '08:00-12:00', '14:00-17:00', '18:30-20:30 ~浮动', '',
      '## 周一', '08:00-12:30 [上课]', '14:00-17:00', '18:30-20:30 ~浮动', '',
      '## 周二', '08:00-12:00', '14:00-17:00', '18:30-21:00 [活动]', '21:00-22:30 家务', '',
      '## 周三', '08:00-11:00', '13:00-15:00 [上课]', '15:00-17:00', '18:30-20:30 ~浮动', '',
      '## 周四', '09:30-12:30 [上课]', '14:00-17:00', '18:30-21:00 [上课]', '21:00-22:30 家务', '',
      '## 周五', '09:30-12:30 [上课]', '12:30-13:30 外卖', '13:30-18:00 [上课]', '18:30-20:30 ~浮动', '',
      '## 笔记', '一天理论上应然的最高工作时长是 4+3+2=9 小时。', '早上的 4h 是最为关键和高质量的。', ''
    ].join('\n');
  };

  A.gen = C.makeIdGen('r' + Date.now().toString(36) + '_');

  function $(id) { return document.getElementById(id); }
  A.$ = $;
  var el = A.el = {
    title: $('title'), fileName: $('fileName'), saveState: $('saveState'),
    tabTpl: $('tabTpl'), tabDays: $('tabDays'),
    btnImport: $('btnImport'), btnExport: $('btnExport'),
    btnUndo: $('btnUndo'), btnRedo: $('btnRedo'), btnTv: $('btnTv'), btnSettings: $('btnSettings'), btnHelp: $('btnHelp'),
    diskBanner: $('diskBanner'), diskText: $('diskText'), diskLoad: $('diskLoad'), diskOverwrite: $('diskOverwrite'), diskRetry: $('diskRetry'),
    banner: $('banner'), bannerTv: $('bannerTv'), pagebar: $('pagebar'), zoomHint: $('zoomHint'),
    editor: $('editor'), grid: $('grid'), rows: $('rows'), editInput: $('editInput'),
    selKind: $('selKind'), selDesc: $('selDesc'), msg: $('msg'),
    tvPanel: $('tvPanel'), tvState: $('tvState'), tvGutter: $('tvGutter'), tvText: $('tvText'), tvErrors: $('tvErrors'),
    tvApply: $('tvApply'), tvDiscard: $('tvDiscard'), tvCopy: $('tvCopy'),
    menu: $('menu'), dlg: $('dlg'), dlgTitle: $('dlgTitle'), dlgBody: $('dlgBody'), dlgErr: $('dlgErr'), dlgBtns: $('dlgBtns'),
    fileInput: $('fileInput')
  };

  /* ---------- 状态 ---------- */
  var S = A.S = A.state = {
    doc: null,
    today: A.todayStr(),
    page: 'tpl',             // tpl 模板页 | days 日程页
    view: { baseOpen: true, refBase: true, refWeekly: true },   // 唯一模板区展开；日程页两种参照行可见
    model: null,             // 当前页的页面模型（page.js）
    order: [],               // 当前页可编辑行的行键序列；选区中的行号指这里的下标
    preview: null,           // 拖动调整端点时的预览文档
    past: [], future: [],
    co: null,                // 正在合并的撤销步骤 {key, timer}
    sel: { type: 'none' },   // none | cells{rows,start,end,anchor,head} | intervals{refs,primary}
    anchor: null,            // {r, t}：r 为 order 中的下标
    clip: null,
    // 计划文件（需求 7.6 节，files.js）：rev 为文件内容的 SHA-256；text 为与文件内容对应的规范文本
    // state：loading | saved | saving | failed | conflict | broken（文件解析失败，改好并应用前不写）
    disk: { path: '', name: '', rev: null, text: null, state: 'loading', error: '', conflictRev: null },
    tv: { open: false, dirty: false, errors: [], fromFile: false },
    editing: null,           // {refs, key}
    drag: null,
    lastClick: null,
    cw: 30,
    msg: { text: '', kind: '' }
  };

  /* ---------- 通用工具 ---------- */
  A.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  A.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  A.nCells = function (d) { d = d || S.doc; return (d.range.end - d.range.start) / A.SLOT; };
  A.viewDoc = function () { return S.preview || S.doc; };
  /** 有没有尚未写入计划文件的修改 */
  A.isDirty = function () { return C.serialize(S.doc) !== S.disk.text; };   // disk.text 为 null：文件不存在或内容有错，总要写
  A.sameRef = function (a, b) { return a.key === b.key && a.id === b.id; };
  A.hasRef = function (refs, r) { for (var i = 0; i < refs.length; i++) if (A.sameRef(refs[i], r)) return true; return false; };
  A.refsKey = function (refs) { return refs.map(function (r) { return r.key + '/' + r.id; }).join(','); };
  A.cssEsc = function (s) { return window.CSS && CSS.escape ? CSS.escape(s) : s; };
  A.mod = function (k) { return (A.IS_MAC ? '⌘' : 'Ctrl+') + k; };
  /** 与键盘布局、大小写、输入法状态无关的字母键 */
  A.keyLetter = function (e) {
    if (e.code && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
    return (e.key || '').toLowerCase();
  };

  A.setMsg = function (text, kind) {
    S.msg = { text: text || '', kind: kind || '' };
    el.msg.textContent = S.msg.text;
    el.msg.className = S.msg.kind;
  };
  A.fail = function (text) { A.setMsg(text, 'error'); return false; };

  /** 编辑区、笔记、标题是否只读：文本视图有未应用的修改（FR-7.10），或计划文件没有读入 */
  A.locked = function () { return S.tv.dirty || S.disk.state === 'loadfail' || S.disk.state === 'loading'; };
  A.guard = function () {
    if (S.disk.state === 'loadfail' || S.disk.state === 'loading') return A.fail('计划文件没有读入，编辑区为只读。');
    if (!S.tv.dirty) return true;
    return A.fail('文本视图有未应用的修改，编辑区为只读。请先在文本视图中点击“应用”或“放弃修改”。');
  };

  /* 页面与显示开关（只是本浏览器里的查看偏好，不写入计划文档） */
  try {
    var v = JSON.parse(localStorage.getItem(A.LS_VIEW) || 'null');
    if (v) {
      if (v.page === 'tpl' || v.page === 'days') S.page = v.page;
      ['baseOpen', 'refBase', 'refWeekly'].forEach(function (k) { if (typeof v[k] === 'boolean') S.view[k] = v[k]; });
    }
  } catch (e) { /* 忽略 */ }
  A.saveView = function () {
    try { localStorage.setItem(A.LS_VIEW, JSON.stringify({ page: S.page, baseOpen: S.view.baseOpen, refBase: S.view.refBase, refWeekly: S.view.refWeekly })); } catch (e) { /* 忽略 */ }
  };

  A.copyText = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  };
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
})();
