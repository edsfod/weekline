/* 周时间轴 · 界面层 · 事件绑定与启动（最后加载） */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, el = A.el;
  var setMsg = A.setMsg, fail = A.fail, commit = A.commit, endCoalesce = A.endCoalesce;

  function bindEditor() {
    el.editor.addEventListener('keydown', A.onEditorKey);
    el.editor.addEventListener('pointerdown', A.onPointerDown);
    el.editor.addEventListener('pointermove', A.onPointerMove);
    el.editor.addEventListener('pointerup', A.onPointerUp);
    el.editor.addEventListener('pointercancel', A.onPointerCancel);
    el.editor.addEventListener('contextmenu', A.onContextMenu);
    // FR-6.8：单击编辑区之外的地方清空选区；菜单、对话框、显示设置面板里的单击不算
    document.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || S.sel.type === 'none' || el.editor.contains(e.target)) return;
      if (e.target.closest('#menu, dialog, #disp')) return;
      A.clearSel();
    });
    el.editor.addEventListener('click', function (e) {
      var b = e.target.closest('.rowmenu');
      if (!b) return;
      var r = b.getBoundingClientRect();
      A.openRowMenu(+b.dataset.row, r.left, r.bottom + 4);
    });

    // 文字编辑框：输入法组字时的 Enter 不算确认
    el.editInput.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); A.commitEdit(); }
      else if (e.key === 'Escape') { e.preventDefault(); A.cancelEdit(true); }
      e.stopPropagation();
    });
    el.editInput.addEventListener('blur', function () {
      setTimeout(function () { if (S.editing && document.activeElement !== el.editInput) A.cancelEdit(false); }, 0);
    });

    el.menu.addEventListener('keydown', A.onMenuKey);
    document.addEventListener('pointerdown', function (e) {
      if (!el.menu.hidden && !el.menu.contains(e.target)) A.closeMenu(false);
    }, true);
    window.addEventListener('blur', function () { A.closeMenu(false); });
  }

  /** 标题（FR-6.22：连续输入合并为一步）；笔记只在文本视图中修改（FR-5.19 已取消） */
  function bindTitle() {
    el.title.addEventListener('input', function () {
      if (A.locked()) return;
      var res = C.setTitle(S.doc, el.title.value);
      if (!res.ok) return fail(res.error);
      if (!res.unchanged) commit(res.doc, { coalesce: 'title', idle: 1000 });
    });
    el.title.addEventListener('blur', function () {
      if (S.co && S.co.key === 'title') endCoalesce();
      el.title.value = S.doc.title;
    });
    el.title.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); el.editor.focus(); }
    });
  }

  function bindTextView() {
    el.tvText.addEventListener('input', function () {
      if (!S.tv.dirty) { S.tv.dirty = true; A.render(); setMsg('文本视图有未应用的修改，编辑区暂为只读'); }
      A.renderGutter();
    });
    el.tvText.addEventListener('scroll', function () { el.tvGutter.scrollTop = el.tvText.scrollTop; });
    el.tvApply.addEventListener('click', A.tvApply);
    el.tvDiscard.addEventListener('click', A.tvDiscard);
    el.tvCopy.addEventListener('click', function () {
      A.copyText(el.tvText.value).then(function (ok) { if (ok) setMsg('已复制文本视图的内容', 'ok'); else fail('复制失败，请手动全选复制'); });
    });
    el.tvErrors.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      var m = b && /^第 (\d+) 行/.exec(b.textContent);
      if (m) A.jumpToLine(+m[1]);
    });
  }

  function bindTopBar() {
    el.tabTpl.addEventListener('click', function () { A.setPage('tpl'); });
    el.tabDays.addEventListener('click', function () { A.setPage('days'); });
    el.fileName.addEventListener('click', A.openFileMenu);
    el.btnImport.addEventListener('click', A.importFile);
    el.btnExport.addEventListener('click', A.exportFile);
    el.diskLoad.addEventListener('click', A.loadFileVersion);
    el.diskOverwrite.addEventListener('click', A.overwriteFile);
    el.diskRetry.addEventListener('click', A.retrySave);
    el.btnUndo.addEventListener('click', A.undo);
    el.btnRedo.addEventListener('click', A.redo);
    el.btnTv.addEventListener('click', function () { A.toggleTv(); });
    el.bannerTv.addEventListener('click', function () { A.toggleTv(true); });
    el.btnSettings.addEventListener('click', A.editSettings);
    el.btnHelp.addEventListener('click', A.showHelp);
    // 页面工具条：显示开关与“回到本周”
    el.pagebar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.toggle) A.toggleView(b.dataset.toggle);
      else if (b.dataset.action === 'today') { A.scrollToToday(); el.editor.focus({ preventScroll: true }); }
    });
    // 导入（FR-7.16）
    el.fileInput.addEventListener('change', function () {
      var f = el.fileInput.files && el.fileInput.files[0];
      if (!f) return;
      f.text().then(function (text) { A.handleImported(text, f.name); });
    });
  }

  function bindWindow() {
    // 全局：Ctrl+S 立即写入；标题与笔记中的撤销走工具的撤销历史
    document.addEventListener('keydown', function (e) {
      var ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl || e.altKey) return;
      var letter = A.keyLetter(e);
      if (letter === 's') { e.preventDefault(); A.saveNow(); return; }
      if (e.target === el.title && (letter === 'z' || letter === 'y')) {
        e.preventDefault();
        if (letter === 'y' || e.shiftKey) A.redo(); else A.undo();
      }
    });

    // FR-7.18：有尚未写入计划文件的修改，或文本视图有未应用的修改
    window.addEventListener('beforeunload', function (e) {
      var st = S.disk.state;
      var risky = (st !== 'loading' && st !== 'loadfail' && st !== 'broken' && A.isDirty()) || (S.tv.dirty && (S.tv.fromFile === false || el.tvText.value !== S.tv.fromFile));
      if (risky) { e.preventDefault(); e.returnValue = ''; }
    });

    // FR-7.15：页面重新获得焦点时检查计划文件是否在别处被修改
    window.addEventListener('focus', A.checkExternal);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) A.checkExternal(); });

    // FR-5.7：格宽随编辑区宽度变化
    if (window.ResizeObserver) {
      var lastW = 0;
      new ResizeObserver(function () {
        var w = el.editor.clientWidth;
        if (w !== lastW) { lastW = w; if (A.computeCw() !== S.cw) A.renderGrid(); }
      }).observe(el.editor);
    } else {
      window.addEventListener('resize', function () { A.renderGrid(); });
    }
    if (document.fonts) document.fonts.ready.then(function () { A.renderGrid(); });   // 字体就绪后文字宽度会变（FR-5.15）
    // 显示设置换了字体或粗细（web-kit 改写 <head> 里的样式），文字宽度也会变，下一帧重画（FR-5.15）
    if (window.MutationObserver) {
      var refit = 0;
      new MutationObserver(function () {
        if (!refit) refit = requestAnimationFrame(function () { refit = 0; A.renderGrid(); });
      }).observe(document.head, { childList: true, subtree: true, characterData: true });
    }

    // FR-4.14：跨过零点时重算加载范围
    setInterval(function () {
      var t = A.todayStr();
      if (t === S.today) return;
      S.today = t;
      A.refreshModel();
      A.sanitizeSel();
      A.render();
      setMsg('日期已变为 ' + C.fmtDateCn(t) + '，已重新计算日程页的范围');
    }, 60000);

  }

  function init() {
    bindEditor();
    bindTitle();
    bindTextView();
    bindTopBar();
    bindWindow();
    // 配色、显示设置面板、本机显示参数、心跳：web-kit（NFR-6、NFR-10、NFR-11）
    WebKit.init({ header: 'X-Weekline', onDisplay: A.renderZoom, onError: function (m) { fail(m); } });
    S.doc = C.makeDoc({ startDate: C.weekFirst(S.today, 0) });      // 读入计划文件之前的占位，编辑区只读
    A.refreshModel();
    A.render();
    A.loadPlan().then(function (msg) {
      A.refreshModel();
      A.render();
      if (S.page === 'days') A.scrollToToday();
      if (msg) setMsg(msg);
      el.editor.focus({ preventScroll: true });
    });
  }

  init();
})(window.WeekApp);
