/* 周时间轴 · 界面层 · 撤销历史与选区 */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, SLOT = A.SLOT;
  var setMsg = A.setMsg, fail = A.fail, guard = A.guard, clamp = A.clamp;

  /* ---------- 撤销历史（FR-6.21 至 FR-6.23） ---------- */
  function endCoalesce() {
    if (S.co) { clearTimeout(S.co.timer); S.co = null; }
  }

  /**
   * 提交新文档作为一个撤销步骤。opts.coalesce 为合并键：与上一次提交的键相同时并入同一步骤
   * （标题、笔记的连续输入；同一选区上连续的同类移动；E 创建后紧接的文字编辑）。
   */
  function commit(doc, opts) {
    opts = opts || {};
    if (!doc || doc === S.doc) { if (opts.msg) setMsg(opts.msg, 'ok'); return; }
    var key = opts.coalesce || null;
    if (key && S.co && S.co.key === key) {
      S.future = [];
    } else {
      endCoalesce();
      S.past.push(S.doc);
      if (S.past.length > A.HISTORY_LIMIT) S.past.shift();
      S.future = [];
      if (key) S.co = { key: key, timer: 0 };
    }
    if (key && opts.idle) {
      clearTimeout(S.co.timer);
      S.co.timer = setTimeout(endCoalesce, opts.idle);
    }
    S.doc = doc;
    docChanged();
    if (opts.msg) setMsg(opts.msg, 'ok');
  }

  /** 应用一个 core 操作结果：成功则提交，失败则在状态栏说明（FR-4.2） */
  function apply(res, opts) {
    if (!res.ok) { fail(res.error); return null; }
    commit(res.doc, opts);
    return res;
  }

  function undo() {
    if (!guard()) return;
    endCoalesce();
    if (!S.past.length) return setMsg('没有可以撤销的操作');
    S.future.push(S.doc);
    S.doc = S.past.pop();
    docChanged();
    setMsg('已撤销（还可撤销 ' + S.past.length + ' 步）');
  }
  function redo() {
    if (!guard()) return;
    endCoalesce();
    if (!S.future.length) return setMsg('没有可以重做的操作');
    S.past.push(S.doc);
    S.doc = S.future.pop();
    docChanged();
    setMsg('已重做');
  }

  /** 文档变化后：重算页面模型、修正选区、安排写入计划文件、重画 */
  function docChanged() {
    A.refreshModel();
    sanitizeSel();
    A.scheduleSave();
    A.render();
  }

  /* ---------- 选区 ---------- */
  /** 以锚点 a 与另一角 h 为对角的格选区；r 为 S.order 中的下标 */
  function rectSel(a, h) {
    var rows = [];
    for (var r = Math.min(a.r, h.r); r <= Math.max(a.r, h.r); r++) rows.push(r);
    return { type: 'cells', rows: rows, start: Math.min(a.t, h.t), end: Math.max(a.t, h.t) + SLOT, anchor: a, head: h };
  }
  /** 区间选区：refs 为 [{key, id}] */
  function ivSel(refs, primary) {
    return { type: 'intervals', refs: refs.slice(), primary: primary || refs[refs.length - 1] };
  }
  /** 改变选区（不计入撤销历史）；换到别的选区时结束“连续移动”的合并 */
  function setSel(sel) {
    var prev = S.sel;
    S.sel = sel;
    if (S.co && S.co.key.indexOf('move') === 0) {
      var same = prev.type === 'intervals' && sel.type === 'intervals' && A.refsKey(prev.refs) === A.refsKey(sel.refs);
      if (!same) endCoalesce();
    }
    A.render();
  }
  function clearSel() { setSel({ type: 'none' }); }

  function clampCell(p) {
    var R = S.doc.range;
    return { r: clamp(p.r, 0, Math.max(0, S.order.length - 1)), t: clamp(p.t, R.start, R.end - SLOT) };
  }

  /** 文档或页面变化后修正选区：去掉已不存在的区间，把格选区限制在显示范围与当前页的行内 */
  function sanitizeSel() {
    var R = S.doc.range, n = S.order.length;
    if (!n) { S.sel = { type: 'none' }; S.anchor = null; return; }
    if (S.anchor) S.anchor = clampCell(S.anchor);
    var sel = S.sel;
    if (sel.type === 'intervals') {
      var refs = sel.refs.filter(function (r) { return S.order.indexOf(r.key) >= 0 && C.findInRow(S.doc, r.key, r.id); });
      if (!refs.length) S.sel = { type: 'none' };
      else if (refs.length !== sel.refs.length) S.sel = ivSel(refs, A.hasRef(refs, sel.primary) ? sel.primary : refs[0]);
    } else if (sel.type === 'cells') {
      var rows = sel.rows.filter(function (r) { return r < n; });
      var s = clamp(sel.start, R.start, R.end - SLOT), e = clamp(sel.end, s + SLOT, R.end);
      if (!rows.length) S.sel = { type: 'none' };
      else if (s !== sel.start || e !== sel.end || rows.length !== sel.rows.length) {
        S.sel = { type: 'cells', rows: rows, start: s, end: e, anchor: clampCell(sel.anchor), head: clampCell(sel.head) };
      }
    }
  }

  /** 区间选区中仍然存在的区间：[{key, iv, idx}]，idx 为行在 S.order 中的下标 */
  function selIntervals() {
    if (S.sel.type !== 'intervals') return [];
    return S.sel.refs.map(function (r) {
      return { key: r.key, iv: C.findInRow(S.doc, r.key, r.id), idx: S.order.indexOf(r.key) };
    }).filter(function (f) { return f.iv && f.idx >= 0; });
  }

  /** 格选区的行键 */
  function selKeys() {
    return S.sel.type === 'cells' ? S.sel.rows.map(function (r) { return S.order[r]; }) : [];
  }

  function inSelection(r, t) {
    var sel = S.sel;
    if (sel.type === 'cells') return sel.rows.indexOf(r) >= 0 && sel.start <= t && t < sel.end;
    if (sel.type === 'intervals') {
      var key = S.order[r], iv = C.intervalAt(S.doc, key, t);
      return !!iv && A.hasRef(sel.refs, { key: key, id: iv.id });
    }
    return false;
  }

  A.endCoalesce = endCoalesce;
  A.commit = commit;
  A.apply = apply;
  A.undo = undo;
  A.redo = redo;
  A.docChanged = docChanged;
  A.rectSel = rectSel;
  A.ivSel = ivSel;
  A.setSel = setSel;
  A.clearSel = clearSel;
  A.clampCell = clampCell;
  A.sanitizeSel = sanitizeSel;
  A.selIntervals = selIntervals;
  A.selKeys = selKeys;
  A.inSelection = inSelection;
})(window.WeekApp);
