/* 周时间轴 · 界面层 · 编辑操作（写入、移动、复制粘贴、行操作、文字编辑）
   对跟随行的改动由 core 负责先复制上级内容再修改（FR-4.8）；这里负责提交、选区与提示。 */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, el = A.el, SLOT = A.SLOT, gen = A.gen;
  var setMsg = A.setMsg, fail = A.fail, guard = A.guard;
  var commit = A.commit, apply = A.apply, render = A.render, ensureVisibleSel = A.ensureVisibleSel;
  var rectSel = A.rectSel, ivSel = A.ivSel, setSel = A.setSel, clearSel = A.clearSel, selIntervals = A.selIntervals, selKeys = A.selKeys;

  /** 操作成功后，区间选区换成结果里的引用（跟随行变为已编辑时 id 会变） */
  function selectRefs(refs, primaryIdx) {
    if (!refs || !refs.length) return;
    S.sel = ivSel(refs, refs[Math.min(primaryIdx || 0, refs.length - 1)]);
    render();
  }
  function primaryIdx() {
    var sel = S.sel;
    if (sel.type !== 'intervals') return 0;
    for (var i = 0; i < sel.refs.length; i++) if (A.sameRef(sel.refs[i], sel.primary)) return i;
    return 0;
  }

  /* ---------- 写入类与属性 ---------- */

  /** E / S / D（格选区）：创建区间；E、D 随后进入文字编辑，创建与文字合并为一个撤销步骤 */
  function cellsCreate(kind) {
    var sel = S.sel, keys = selKeys();
    var res = C.createIntervals(S.doc, keys, sel.start, sel.end, kind, gen);
    if (!res.ok) return fail(res.error);
    var key = 'create:' + A.refsKey(res.refs);
    commit(res.doc, { coalesce: key, msg: '已在 ' + keys.length + ' 行创建' + C.KIND_LABEL[kind] + '区间' });
    selectRefs(res.refs, 0);
    if (kind !== 'self') startEdit(res.refs, key);
  }

  function doSetKind(kind) {
    var i = primaryIdx();
    var res = apply(C.setKind(S.doc, S.sel.refs, kind, gen), { msg: '已改为' + C.KIND_LABEL[kind] });
    if (res) selectRefs(res.refs, i);
  }

  function doToggleFloat() {
    var i = primaryIdx();
    var res = C.toggleFloat(S.doc, S.sel.refs, gen);
    if (apply(res, { msg: res.value ? '已设为浮动' : '已取消浮动' })) selectRefs(res.refs, i);
  }

  function doDelete() {
    var sel = S.sel;
    if (sel.type === 'cells') {
      var keys = selKeys();
      apply(C.clearCells(S.doc, keys, sel.start, sel.end, gen), { msg: '已清除 ' + C.describeCells(keys, sel.start, sel.end) });
    } else if (sel.type === 'intervals') {
      var n = sel.refs.length;
      if (apply(C.deleteIntervals(S.doc, sel.refs, gen), { msg: '已删除 ' + n + ' 个区间' })) {
        S.sel = { type: 'none' };
        render();
      }
    }
  }

  /* ---------- 移动类 ---------- */

  /**
   * dS、dE 以分钟计。同一选区上连续的同类移动合并为一个撤销步骤：合并键取操作后的引用，
   * 这样跟随行第一次移动（id 改变）之后的连续移动也能并入同一步。
   */
  function doShift(dS, dE) {
    var kind = dS === dE ? 'shift' : (dS ? 'start' : 'end');
    var msg = { shift: '已平移', start: '已调整开始端点', end: '已调整结束端点' }[kind];
    var i = primaryIdx();
    var res = C.shiftIntervals(S.doc, S.sel.refs, dS, dE, gen);
    if (!res.ok) return fail(res.error);
    commit(res.doc, { coalesce: 'move-' + kind + ':' + A.refsKey(res.refs), msg: msg });
    selectRefs(res.refs, i);
    ensureVisibleSel();
  }

  function doMoveRow(d) {
    var res = C.moveIntervalsRow(S.doc, S.sel.refs, S.order, d, gen);
    if (!res.ok) return fail(res.error);
    commit(res.doc, { coalesce: 'move-row:' + A.refsKey(res.refs), msg: d < 0 ? '已移到上一行' : '已移到下一行' });
    selectRefs(res.refs, primaryIdx());
    ensureVisibleSel();
  }

  /* ---------- 复制与粘贴（6.4 节，可以跨页） ---------- */
  function doCopy(cut) {
    var sel = S.sel, clip = null;
    if (sel.type === 'cells') clip = C.copyRect(S.doc, selKeys(), sel.start, sel.end);
    else if (sel.type === 'intervals') clip = C.copyIntervals(S.doc, sel.refs, S.order);
    if (!clip) return fail('没有选区，无法复制');
    if (cut && !guard()) return;
    S.clip = clip;
    A.copyText(C.clipToText(clip)).catch(function () {});   // FR-6.18
    var what = clip.rows.length + ' 行 × ' + C.fmtDur(clip.width);
    if (!cut) return setMsg('已复制 ' + what, 'ok');
    if (sel.type === 'cells') apply(C.clearCells(S.doc, selKeys(), sel.start, sel.end, gen), { msg: '已剪切 ' + what });
    else if (apply(C.deleteIntervals(S.doc, sel.refs, gen), { msg: '已剪切 ' + what })) { S.sel = { type: 'none' }; render(); }
  }

  /** FR-6.15：格选区的左上格，或区间选区中最上面一行、开始最早的区间的起点 */
  function pasteAnchor() {
    var sel = S.sel;
    if (sel.type === 'cells') return { r: sel.rows[0], t: sel.start };
    if (sel.type === 'intervals') {
      var list = selIntervals();
      if (!list.length) return null;
      var top = Math.min.apply(null, list.map(function (f) { return f.idx; }));
      var t = Math.min.apply(null, list.filter(function (f) { return f.idx === top; }).map(function (f) { return f.iv.start; }));
      return { r: top, t: t };
    }
    return null;
  }

  function doPaste() {
    if (!S.clip) return fail('还没有复制任何内容（只能粘贴在本工具中复制的内容）');
    var a = pasteAnchor();
    if (!a) return fail('请先选中粘贴位置');
    var res = C.pasteRect(S.doc, S.clip, S.order, a.r, a.t, gen);
    if (!res.ok) return fail('粘贴不生效：' + res.error);
    commit(res.doc, { msg: '已粘贴到 ' + C.describeCells(res.keys, res.start, res.end) });
    S.anchor = { r: a.r, t: res.start };
    S.sel = rectSel(S.anchor, { r: a.r + res.keys.length - 1, t: res.end - SLOT });
    render();
  }

  /* ---------- 选择区间 ---------- */

  /** Space：选中锚点格所在的区间 */
  function selectIntervalAtAnchor() {
    var a = S.anchor;
    var key = a && S.order[a.r];
    var iv = key && C.intervalAt(S.doc, key, a.t);
    if (!iv) return fail('锚点格不在任何区间内');
    setSel(ivSel([{ key: key, id: iv.id }]));
  }

  /** Tab / Shift+Tab：同一行的下一个 / 上一个区间，行尾时转到下一行 */
  function tabInterval(dir) {
    var all = [];
    S.order.forEach(function (key) { C.eff(S.doc, key).forEach(function (iv) { all.push({ key: key, id: iv.id, start: iv.start }); }); });
    if (!all.length) return fail('当前页还没有区间');
    var cur = S.sel.primary, i = -1;
    for (var k = 0; k < all.length; k++) if (A.sameRef(all[k], cur)) { i = k; break; }
    var n = all[(i + dir + all.length) % all.length];
    S.anchor = { r: S.order.indexOf(n.key), t: n.start };
    setSel(ivSel([{ key: n.key, id: n.id }]));
    ensureVisibleSel();
  }

  /* ---------- 行操作（FR-6.19、FR-4.12） ---------- */
  function rowReset(key) {
    if (!guard()) return;
    apply(C.resetRow(S.doc, key), { msg: C.rowName(key) + '已重置为模板，恢复跟随' });
  }
  function rowClear(key) {
    if (!guard()) return;
    apply(C.clearRow(S.doc, key), { msg: C.rowName(key) + '已清空' });
  }
  function rowSelect(r) {
    var R = S.doc.range;
    S.anchor = { r: r, t: R.start };
    setSel(rectSel(S.anchor, { r: r, t: R.end - SLOT }));
  }
  /** FR-6.4：把一行加入或移出格选区的行集合 */
  function rowToggle(r) {
    var sel = S.sel;
    if (sel.type !== 'cells') return rowSelect(r);
    var rows = sel.rows.slice(), i = rows.indexOf(r);
    if (i >= 0) rows.splice(i, 1); else rows.push(r);
    rows.sort(function (a, b) { return a - b; });
    if (!rows.length) return clearSel();
    setSel({ type: 'cells', rows: rows, start: sel.start, end: sel.end, anchor: sel.anchor, head: sel.head });
    setMsg((i >= 0 ? '已移出 ' : '已加入 ') + C.rowName(S.order[r]));
  }

  /* ---------- 文字编辑（6.3 节） ---------- */
  function startEdit(refs, coalesceKey) {
    if (!guard()) return;
    var found = refs.map(function (r) { return { ref: r, iv: C.findInRow(S.doc, r.key, r.id) }; }).filter(function (f) { return f.iv; });
    if (!found.length) return;
    S.editing = { refs: found.map(function (f) { return f.ref; }), key: coalesceKey || null };
    var texts = found.map(function (f) { return f.iv.text; });
    var same = texts.every(function (t) { return t === texts[0]; });
    ensureVisibleSel();
    var r0 = found[0].ref;
    var bar = el.rows.querySelector('.bar[data-key="' + A.cssEsc(r0.key) + '"][data-id="' + A.cssEsc(r0.id) + '"]');
    var g = el.grid.getBoundingClientRect();
    var b = bar ? bar.getBoundingClientRect() : g;
    var inp = el.editInput;
    inp.value = same ? texts[0] : '';
    inp.hidden = false;
    inp.style.left = (b.left - g.left) + 'px';
    inp.style.top = Math.max(0, b.top - g.top - 34) + 'px';
    inp.style.width = Math.max(180, b.width) + 'px';
    inp.focus();
    inp.select();
    setMsg('输入文字后按 Enter 确认，Esc 取消' + (found.length > 1 ? '（写入 ' + found.length + ' 个区间）' : ''));
  }

  /** FR-6.13：文字违反约束时不生效，输入框保持打开 */
  function commitEdit() {
    var ed = S.editing;
    if (!ed) return;
    var res = C.setText(S.doc, ed.refs, el.editInput.value, gen);
    if (!res.ok) { fail('文字不符合要求：' + res.error); el.editInput.focus(); return; }
    S.editing = null;
    el.editInput.hidden = true;
    commit(res.doc, { coalesce: ed.key, msg: '已设置文字' });
    selectRefs(res.refs, 0);
    el.editor.focus({ preventScroll: true });
  }

  function cancelEdit(refocus) {
    if (!S.editing) return;
    S.editing = null;
    el.editInput.hidden = true;
    setMsg('已取消文字编辑');
    if (refocus) el.editor.focus({ preventScroll: true });
  }

  A.cellsCreate = cellsCreate;
  A.doSetKind = doSetKind;
  A.doToggleFloat = doToggleFloat;
  A.doDelete = doDelete;
  A.doShift = doShift;
  A.doMoveRow = doMoveRow;
  A.doCopy = doCopy;
  A.doPaste = doPaste;
  A.selectIntervalAtAnchor = selectIntervalAtAnchor;
  A.tabInterval = tabInterval;
  A.rowReset = rowReset;
  A.rowClear = rowClear;
  A.rowSelect = rowSelect;
  A.rowToggle = rowToggle;
  A.startEdit = startEdit;
  A.commitEdit = commitEdit;
  A.cancelEdit = cancelEdit;
})(window.WeekApp);
