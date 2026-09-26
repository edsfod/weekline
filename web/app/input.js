/* 周时间轴 · 界面层 · 键盘（需求 6.2 节）与鼠标（6.1 节）
   行号一律指 S.order（当前页可编辑行）中的下标；参照行、层级标题、分组标题不参与（FR-5.25）。 */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, el = A.el, SLOT = A.SLOT;
  var setMsg = A.setMsg, fail = A.fail, guard = A.guard, clamp = A.clamp;
  var commit = A.commit, render = A.render, renderGrid = A.renderGrid, renderStatus = A.renderStatus;
  var rectSel = A.rectSel, ivSel = A.ivSel, setSel = A.setSel, clearSel = A.clearSel, clampCell = A.clampCell;
  var ensureVisible = A.ensureVisible;

  /* ---------- 键盘 ---------- */
  function onEditorKey(e) {
    if (e.target !== el.editor || e.isComposing) return;
    var ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey, alt = e.altKey;
    var k = e.key, letter = A.keyLetter(e), sel = S.sel;
    var handled = true;

    if (alt && !ctrl && (e.code === 'Digit1' || e.code === 'Digit2' || k === '1' || k === '2')) {
      A.setPage(e.code === 'Digit2' || k === '2' ? 'days' : 'tpl');
      e.preventDefault();
      return;
    }
    if (!S.order.length) {
      if (k === '?' || (k === '/' && shift)) { A.showHelp(); e.preventDefault(); }
      else if (/^Arrow/.test(k)) { setMsg('这一页没有可编辑的行（唯一模板区已折叠？）'); e.preventDefault(); }
      return;
    }

    if (ctrl && !alt) {
      if (letter === 'z' && !shift) A.undo();
      else if ((letter === 'z' && shift) || letter === 'y') A.redo();
      else if (letter === 's') A.save();
      else if (letter === 'c') A.doCopy(false);
      else if (letter === 'x') A.doCopy(true);
      else if (letter === 'v') { if (guard()) A.doPaste(); }
      else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        // Ctrl + ← →：区间选区时移动开始端点；格选区时不生效
        if (sel.type === 'intervals' && guard()) A.doShift(k === 'ArrowLeft' ? -SLOT : SLOT, 0);
      } else if (k === 'ArrowUp' || k === 'ArrowDown') { /* 不生效 */ }
      else handled = false;
      if (handled) e.preventDefault();
      return;
    }

    if (k === 'Escape') { clearSel(); setMsg(''); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') onHorizontal(k === 'ArrowLeft' ? -SLOT : SLOT, shift, alt);
    else if (k === 'ArrowUp' || k === 'ArrowDown') onVertical(k === 'ArrowUp' ? -1 : 1, shift, alt);
    else if (k === 'Tab') {
      if (sel.type === 'intervals') A.tabInterval(shift ? -1 : 1);
      else handled = false;       // 不生效：保留浏览器默认的焦点移动
    } else if (alt) {
      handled = false;
    } else if (k === 'Enter') {
      if (sel.type === 'intervals') A.startEdit(sel.refs);
      else if (sel.type === 'cells') setMsg('Enter 用于编辑区间文字，请先选中区间（Space 选中锚点所在的区间）');
    } else if (k === ' ') {
      if (sel.type === 'cells' || sel.type === 'none') A.selectIntervalAtAnchor();
    } else if (k === 'Delete' || k === 'Backspace') {
      if (sel.type !== 'none' && guard()) A.doDelete();
    } else if (letter === 'e' || letter === 's' || letter === 'd') {
      // 只读时先提示只读（AC-12），再检查选区
      var kind = { e: 'external', s: 'self', d: 'daily' }[letter];
      if (!guard()) { /* 已提示 */ }
      else if (sel.type === 'none') fail('请先选中格或区间');
      else if (sel.type === 'cells') A.cellsCreate(kind);
      else A.doSetKind(kind);
    } else if (letter === 'f') {
      if (!guard()) { /* 已提示 */ }
      else if (sel.type !== 'intervals') fail('F 用于切换区间的浮动属性，请先选中区间');
      else A.doToggleFloat();
    } else if (k === '?' || (k === '/' && shift)) {
      A.showHelp();
    } else if (k === 'ContextMenu' || (k === 'F10' && shift)) {
      A.openContextMenuForSel();
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  }

  /** ← →：格选区移动锚点或扩展时间段；区间选区平移或移动结束端点 */
  function onHorizontal(dx, shift, alt) {
    var sel = S.sel;
    if (alt) return;                                   // 不生效
    if (sel.type === 'intervals') {
      if (guard()) { if (shift) A.doShift(0, dx); else A.doShift(dx, dx); }
    } else if (sel.type === 'cells' && shift) {
      var hd = clampCell({ r: sel.head.r, t: sel.head.t + dx });
      setSel(rectSel(sel.anchor, hd));
      ensureVisible(hd.r, hd.t, hd.t + SLOT);
    } else if (!shift) {
      moveAnchor(0, sel.type === 'none' ? 0 : dx);
    }
  }

  /** ↑ ↓：格选区移动锚点或扩展行；区间选区转为相邻行的格选区，或（Alt）移到相邻行 */
  function onVertical(dy, shift, alt) {
    var sel = S.sel;
    if (sel.type === 'intervals') {
      if (alt) { if (guard()) A.doMoveRow(dy); return; }
      if (shift) return;                               // 不生效
      var list = A.selIntervals();
      var rows = list.map(function (f) { return f.idx; });
      var tr = dy < 0 ? Math.min.apply(null, rows) - 1 : Math.max.apply(null, rows) + 1;
      if (tr < 0 || tr >= S.order.length) { fail(dy < 0 ? '上方没有可编辑的行了' : '下方没有可编辑的行了'); return; }
      var s0 = Math.min.apply(null, list.map(function (f) { return f.iv.start; }));
      var e0 = Math.max.apply(null, list.map(function (f) { return f.iv.end; }));
      S.anchor = { r: tr, t: s0 };
      setSel(rectSel(S.anchor, { r: tr, t: e0 - SLOT }));
      ensureVisible(tr, s0, e0);
    } else if (alt) {
      return;                                          // 不生效
    } else if (sel.type === 'cells' && shift) {
      var hd = clampCell({ r: sel.head.r + dy, t: sel.head.t });
      setSel(rectSel(sel.anchor, hd));
      ensureVisible(hd.r, hd.t, hd.t + SLOT);
    } else if (!shift) {
      moveAnchor(sel.type === 'none' ? 0 : dy, 0);
    }
  }

  /** 选区变为锚点移动后的单个格；没有锚点时从第一行第一格开始（日程页从今天开始） */
  function moveAnchor(dy, dx) {
    var a;
    if (S.anchor) a = clampCell({ r: S.anchor.r + dy, t: S.anchor.t + dx });
    else {
      var ti = S.order.indexOf(C.dayKey(S.today));
      a = { r: ti >= 0 ? ti : 0, t: S.doc.range.start };
    }
    S.anchor = a;
    setSel(rectSel(a, a));
    ensureVisible(a.r, a.t, a.t + SLOT);
  }

  /* ---------- 鼠标 ---------- */

  /** 指针所在的可编辑行：跳过参照行、标题行和被固定表头遮住的行；落在它们上面时取最近的可编辑行 */
  function rowFromY(y) {
    var sticky = el.rows.querySelector('.sticky-top');
    var sb = sticky ? sticky.getBoundingClientRect().bottom : -Infinity;
    var lines = el.rows.querySelectorAll('.line.row[data-row]');
    var best = 0, bestDist = Infinity;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], rc = ln.getBoundingClientRect();
      var inSticky = sticky && sticky.contains(ln);
      var top = inSticky ? rc.top : Math.max(rc.top, sb);
      if (!inSticky && rc.bottom <= sb) continue;      // 滚到固定表头下面，看不见
      var dist = y < top ? top - y : (y >= rc.bottom ? y - rc.bottom + 1 : 0);
      if (dist < bestDist) { bestDist = dist; best = +ln.dataset.row; }
      if (!dist) break;
    }
    return best;
  }
  /** FR-4.1：取指针所在的格，不四舍五入 */
  function tFromX(x) {
    var tr = el.rows.querySelector('.track').getBoundingClientRect();
    var idx = clamp(Math.floor((x - tr.left) / S.cw), 0, A.nCells() - 1);
    return S.doc.range.start + idx * SLOT;
  }
  function cellFromEvent(e) { return { r: rowFromY(e.clientY), t: tFromX(e.clientX) }; }

  function barRef(bar) { return bar ? { key: bar.dataset.key, id: bar.dataset.id } : null; }

  /** FR-6.6：已选中区间左右边缘 6 像素以内 */
  function edgeAt(e) {
    if (S.sel.type !== 'intervals') return null;
    var bar = e.target.closest && e.target.closest('.track[data-row] .bar');
    var ref = barRef(bar);
    if (!ref || !A.hasRef(S.sel.refs, ref)) return null;
    var b = bar.getBoundingClientRect();
    if (e.clientX - b.left <= A.EDGE_PX) return { ref: ref, edge: 'start' };
    if (b.right - e.clientX <= A.EDGE_PX) return { ref: ref, edge: 'end' };
    return null;
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (S.editing && e.target !== el.editInput) A.cancelEdit(false);
    if (e.target === el.editInput) return;
    if (e.target.closest('.rowmenu')) return;
    if (e.target.closest('.row.ref')) {                // 参照行只读，操作不生效
      e.preventDefault();
      el.editor.focus({ preventScroll: true });
      setMsg('参照行是只读的；要修改它，请到模板页编辑' + (e.target.closest('.row.ref').dataset.ref === C.BASE ? '唯一模板' : '对应的周模板'));
      return;
    }
    var track = e.target.closest('.track[data-row]');
    if (!track) {
      var head = e.target.closest('.head[data-row]');
      if (head && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        el.editor.focus({ preventScroll: true });
        A.rowToggle(+head.dataset.row);
      } else {
        clearSel();       // FR-6.8
      }
      return;
    }
    e.preventDefault();
    el.editor.focus({ preventScroll: true });
    var c = { r: +track.dataset.row, t: tFromX(e.clientX) };
    var edge = edgeAt(e);
    if (edge) {
      if (!guard()) return;
      S.lastClick = null;
      S.drag = { mode: 'resize', ref: edge.ref, edge: edge.edge, t0: c.t, base: S.doc, last: S.doc, lastRefs: [edge.ref] };
    } else {
      S.drag = { mode: 'pending', r: c.r, t: c.t, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    }
    try { el.editor.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  }

  function onPointerMove(e) {
    var d = S.drag;
    if (!d) {
      el.editor.classList.toggle('resize-cursor', !!edgeAt(e));
      return;
    }
    if (d.mode === 'resize') {
      // 拖动时预览最后一个合法位置；冲突时在状态栏说明（FR-4.5）
      var delta = tFromX(e.clientX) - d.t0;
      var res = C.shiftIntervals(d.base, [d.ref], d.edge === 'start' ? delta : 0, d.edge === 'end' ? delta : 0, A.gen);
      if (res.ok) {
        d.last = res.doc; d.lastRefs = res.refs;
        S.preview = res.doc === d.base ? null : res.doc;
        if (S.preview) S.sel = ivSel(res.refs);
        setMsg('');
      } else setMsg(res.error, 'error');
      renderGrid();
      return;
    }
    var c = cellFromEvent(e);
    // FR-6.2：越过至少一条格边界后才算拖动
    if (d.mode === 'pending' && (c.r !== d.r || c.t !== d.t)) { d.mode = 'select'; S.lastClick = null; }
    if (d.mode === 'select') {
      S.anchor = { r: d.r, t: d.t };
      S.sel = rectSel(S.anchor, c);
      renderGrid();
      renderStatus();
    }
  }

  function onPointerUp(e) {
    var d = S.drag;
    if (!d) return;
    S.drag = null;
    try { el.editor.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    if (d.mode === 'resize') {
      S.preview = null;
      if (d.last !== d.base) {
        var r0 = d.lastRefs[0], iv = C.findInRow(d.last, r0.key, r0.id);
        commit(d.last, { msg: '已调整为 ' + C.describeInterval(r0.key, iv) });
        S.sel = ivSel(d.lastRefs);
        render();
      } else {
        S.sel = ivSel([d.ref]);
        render();
      }
      return;
    }
    if (d.mode === 'select') { setSel(S.sel); return; }
    clickCell(d.r, d.t, d);
  }

  function onPointerCancel() {
    if (S.drag && S.drag.mode === 'resize') S.sel = ivSel([S.drag.ref]);
    S.drag = null;
    S.preview = null;
    render();
  }

  /** FR-6.1、FR-6.3、FR-6.5、FR-6.7 */
  function clickCell(r, t, mods) {
    var sel = S.sel;
    if (!mods.shift && !mods.ctrl && sel.type === 'cells' && sel.rows.indexOf(r) >= 0 && t >= sel.start && t < sel.end) {
      S.lastClick = null;
      clearSel();          // FR-6.1：再次单击格选区之内的格，取消选区
      return;
    }
    var key = S.order[r], iv = C.intervalAt(S.doc, key, t);
    var ref = iv ? { key: key, id: iv.id } : null;
    if (mods.shift && S.anchor) { setSel(rectSel(S.anchor, { r: r, t: t })); return; }
    if (mods.ctrl && ref) {
      var refs = S.sel.type === 'intervals' ? S.sel.refs.slice() : [];
      var i = -1;
      for (var k = 0; k < refs.length; k++) if (A.sameRef(refs[k], ref)) i = k;
      if (i >= 0) refs.splice(i, 1); else refs.push(ref);
      S.anchor = { r: r, t: t };
      setSel(refs.length ? ivSel(refs, i >= 0 ? refs[refs.length - 1] : ref) : { type: 'none' });
      return;
    }
    S.anchor = { r: r, t: t };
    if (ref) {
      // 双击自行计时：每次单击都会重建区间元素，浏览器的 dblclick 不可靠
      var now = Date.now(), lc = S.lastClick;
      S.lastClick = { ref: ref, time: now };
      setSel(ivSel([ref]));
      if (lc && A.sameRef(lc.ref, ref) && now - lc.time < A.DBL_MS) { S.lastClick = null; A.startEdit([ref]); }
    } else {
      S.lastClick = null;
      setSel(rectSel(S.anchor, S.anchor));
    }
  }

  /** FR-6.9：位置不在当前选区内时先按单击选中，再弹出菜单 */
  function onContextMenu(e) {
    e.preventDefault();
    if (S.editing) A.cancelEdit(false);
    if (e.target.closest('.row.ref')) return;          // 参照行只读
    var track = e.target.closest('.track[data-row]');
    if (track) {
      el.editor.focus({ preventScroll: true });
      var r = +track.dataset.row, t = tFromX(e.clientX);
      if (!A.inSelection(r, t)) clickCell(r, t, {});
      A.openContextMenu(e.clientX, e.clientY);
      return;
    }
    var head = e.target.closest('.head[data-row]');
    if (head) A.openRowMenu(+head.dataset.row, e.clientX, e.clientY);
  }

  A.onEditorKey = onEditorKey;
  A.onPointerDown = onPointerDown;
  A.onPointerMove = onPointerMove;
  A.onPointerUp = onPointerUp;
  A.onPointerCancel = onPointerCancel;
  A.onContextMenu = onContextMenu;
})(window.WeekApp);
