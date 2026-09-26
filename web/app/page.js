/*
 * 周时间轴 · 界面层 · 页面模型
 * 根据计划文档、当前日期与显示开关，算出当前页由哪些行组成：
 *   sticky：固定在编辑区顶部的行；rows：其余的行；order：可编辑行的行键序列。
 * 行的种类：ruler 时间标尺、level 层级标题、group 分组标题、edit 可编辑行、ref 参照行（只读）。
 */
(function (A) {
  'use strict';
  var C = A.C, S = A.S;

  function templatePage(d) {
    var sticky = [{ type: 'ruler' }], rows = [], order = [];
    // FR-5.3、FR-5.10：唯一模板区与周模板区，各有层级标题
    if (S.view.baseOpen) {
      sticky.push({ type: 'level', title: '唯一模板', sub: '第一级 · 默认的一天' });
      sticky.push({ type: 'edit', key: C.BASE });
      order.push(C.BASE);
    }
    rows.push({ type: 'level', title: '周模板', sub: '第二级 · 周日至周六各一个，默认跟随唯一模板' });
    C.weeklyOrder(d.weekStart).forEach(function (w) {
      var key = C.weeklyKey(w);
      rows.push({ type: 'edit', key: key });
      order.push(key);
    });
    return { sticky: sticky, rows: rows, order: order };
  }

  function daysPage(d, today) {
    var sticky = [{ type: 'ruler' }], rows = [], order = [];
    // FR-5.24：周模板参照行按选区出现，不在页面模型里，见 render.js 的 weeklyRefKey
    if (S.view.refBase) sticky.push({ type: 'ref', key: C.BASE });
    var thisWeek = C.weekFirst(today, d.weekStart);
    var nextWeek = C.addDays(thisWeek, 7);
    var lastWeek = null;
    C.listDays(d, today).forEach(function (day) {
      var wf = C.weekFirst(day, d.weekStart);
      if (wf !== lastWeek) {                                           // FR-5.23：按周分组
        lastWeek = wf;
        rows.push({ type: 'group', week: wf, from: wf, to: C.addDays(wf, 6), tag: wf === thisWeek ? '本周' : (wf === nextWeek ? '下周' : '') });
      }
      var key = C.dayKey(day);
      rows.push({ type: 'edit', key: key, today: day === today });
      order.push(key);
    });
    return { sticky: sticky, rows: rows, order: order };
  }

  /** 重算页面模型；可编辑行的顺序变了（换页、改一周起始日、改起始日、跨过零点）时清空选区 */
  function refreshModel() {
    var m = S.page === 'days' ? daysPage(S.doc, S.today) : templatePage(S.doc);
    var changed = S.order.join(',') !== m.order.join(',');
    S.model = m;
    S.order = m.order;
    if (changed) {
      S.sel = { type: 'none' };
      S.anchor = null;
      if (S.co && S.co.key.indexOf('move') === 0) A.endCoalesce();
    }
  }

  function setPage(page) {
    if (page === S.page) return;
    if (S.editing) A.cancelEdit(false);
    S.page = page;
    A.saveView();
    refreshModel();
    A.render();
    el().editor.scrollTop = 0;
    if (page === 'days') scrollToToday();
    A.setMsg(page === 'days' ? '日程页：编辑具体日子，上方为只读的参照行' : '模板页：编辑唯一模板和七个周模板');
  }

  /** 显示开关：baseOpen / refBase / refWeekly */
  function toggleView(name) {
    S.view[name] = !S.view[name];
    A.saveView();
    refreshModel();
    A.render();
  }

  /** FR-5.26：滚动到当前日期所在的周 */
  function scrollToToday() {
    var wf = C.weekFirst(S.today, S.doc.weekStart);
    var g = A.el.rows.querySelector('.line.group[data-week="' + wf + '"]');
    var sticky = A.el.rows.querySelector('.sticky-top');
    if (g) A.el.editor.scrollTop = Math.max(0, g.offsetTop - (sticky ? sticky.offsetHeight : 0));
  }

  function el() { return A.el; }

  A.refreshModel = refreshModel;
  A.setPage = setPage;
  A.toggleView = toggleView;
  A.scrollToToday = scrollToToday;
})(window.WeekApp);
