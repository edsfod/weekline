/* 周时间轴 · 界面层 · 文本视图（需求 7.5 节） */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, el = A.el;
  var esc = A.esc, setMsg = A.setMsg, fail = A.fail, commit = A.commit, render = A.render;

  function renderTv() {
    el.tvPanel.hidden = !S.tv.open;
    el.tvState.hidden = !S.tv.dirty;
    if (!S.tv.open) return;
    // FR-7.9：没有未应用的修改时，内容始终等于当前计划文档的规范文本
    if (!S.tv.dirty) {
      var text = C.serialize(S.doc);
      if (el.tvText.value !== text) el.tvText.value = text;
    }
    renderGutter();
    var errs = S.tv.errors;
    el.tvErrors.hidden = !errs.length;
    if (errs.length) {
      el.tvErrors.innerHTML = '<strong>' + errs.length + ' 处错误，未应用</strong>' + errs.map(function (e) {
        return '<button type="button">' + esc(e) + '</button>';
      }).join('');
    }
  }

  function errorLines() {
    var set = {};
    S.tv.errors.forEach(function (e) { var m = /^第 (\d+) 行/.exec(e); if (m) set[m[1]] = true; });
    return set;
  }

  /** 行号栏，出错的行加标记 */
  function renderGutter() {
    var n = el.tvText.value.split('\n').length, bad = errorLines(), h = '';
    for (var i = 1; i <= n; i++) h += '<div' + (bad[i] ? ' class="err"' : '') + '>' + i + '</div>';
    h += '<div>&nbsp;</div>';
    el.tvGutter.innerHTML = h;
    el.tvGutter.scrollTop = el.tvText.scrollTop;
  }

  function jumpToLine(line) {
    var lines = el.tvText.value.split('\n');
    var a = 0;
    for (var i = 0; i < line - 1 && i < lines.length; i++) a += lines[i].length + 1;
    var b = a + (lines[line - 1] || '').length;
    el.tvText.focus();
    el.tvText.setSelectionRange(a, b);
    el.tvText.scrollTop = Math.max(0, (line - 4) * 19);
    renderGutter();
  }

  function toggleTv(open) {
    S.tv.open = open == null ? !S.tv.open : open;
    render();
    if (S.tv.open) el.tvText.focus();
  }

  /**
   * FR-7.11：解析成功则整体替换计划文档（一个撤销步骤），失败则列出全部错误。
   * 计划文件有错误时（FR-7.13，S.tv.fromFile 为文件原文），应用成功后才恢复写入计划文件。
   */
  function tvApply() {
    var res = C.parse(el.tvText.value, A.gen, S.today);
    if (!res.ok) {
      S.tv.errors = res.errors;
      render();
      return fail('文本有 ' + res.errors.length + ' 处错误，计划文档没有改变');
    }
    var fromFile = S.tv.fromFile !== false;
    S.tv.dirty = false;
    S.tv.errors = [];
    S.tv.fromFile = false;
    if (fromFile && S.disk.state === 'broken') {
      S.disk.state = 'saving';              // 由 docChanged 安排写入：disk.text 为空，一定会写
      if (S.disk.placeholder) {             // 启动时文件就有错：页面里只是占位文档，直接换上，不进撤销历史
        S.disk.placeholder = false;
        S.doc = res.doc; S.past = []; S.future = [];
        A.docChanged();
        return setMsg('已应用，改好的内容正在写入计划文件', 'ok');
      }
    }
    if (C.docEquals(res.doc, S.doc)) { A.docChanged(); return setMsg('文本与当前计划文档相同', 'ok'); }
    commit(res.doc, { msg: fromFile ? '已应用，改好的内容正在写入计划文件' : '已应用文本视图的修改' });
  }

  /** FR-7.12；计划文件有错误时，恢复为文件原文，编辑区仍为只读 */
  function tvDiscard() {
    S.tv.errors = [];
    if (S.tv.fromFile !== false) {
      el.tvText.value = S.tv.fromFile;
      render();
      return fail('计划文件有错误，只能在文本视图中改好并应用；已恢复为文件原文');
    }
    S.tv.dirty = false;
    el.tvText.value = C.serialize(S.doc);
    render();
    setMsg('已放弃文本视图中的修改');
  }

  A.renderTv = renderTv;
  A.renderGutter = renderGutter;
  A.jumpToLine = jumpToLine;
  A.toggleTv = toggleTv;
  A.tvApply = tvApply;
  A.tvDiscard = tvDiscard;
})(window.WeekApp);
