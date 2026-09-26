/* 周时间轴 · 界面层 · 渲染（顶栏、页面工具条、编辑区、状态栏、笔记）与视口滚动 */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, el = A.el, SLOT = A.SLOT, HEAD_W = A.HEAD_W;
  var esc = A.esc, nCells = A.nCells, viewDoc = A.viewDoc;

  function computeCw() {
    var avail = el.editor.clientWidth - HEAD_W - 1;
    return Math.max(A.MIN_CW, Math.floor(avail / nCells()));
  }

  function render() {
    renderTop();
    renderPagebar();
    renderGrid();
    renderStatus();
    A.renderTv();
  }

  /* FR-5.2：保存状态；琥珀 = 提醒，绛红 = 错误，另有符号，不只靠颜色 */
  var DISK_LABEL = {
    loading: ['读取中…', ''], saved: ['已保存', 'ok'], saving: ['保存中…', ''],
    failed: ['保存失败', 'error'], conflict: ['文件在别处被修改', 'warn'], broken: ['文件有错误，未载入', 'warn'], loadfail: ['读取失败', 'error']
  };

  function renderDisk() {
    var dk = S.disk, lab = DISK_LABEL[dk.state] || ['', ''];
    el.fileName.lastElementChild.textContent = dk.name || 'plan.md';
    el.fileName.title = (dk.path || '计划文件') + '（单击：在资源管理器中显示、复制路径）';
    el.saveState.textContent = lab[0];
    el.saveState.className = 'savestate ' + lab[1];
    var t = '', load = false, over = false, retry = false;
    if (dk.state === 'failed') {
      t = '<strong>保存失败</strong>：' + A.esc(dk.error) + '。修改仍在本页中，每 5 秒自动重试；服务停止时，双击工具目录中的“周时间轴.bat”重新启动即可。';
      retry = true;
    } else if (dk.state === 'conflict') {
      t = '<strong>计划文件在别处被修改</strong>，本页也有尚未写入的修改。请二选一：';
      load = over = true;
    } else if (dk.state === 'broken') {
      t = '<strong>计划文件有错误</strong>：没有载入，也不会被改写。在文本视图中改好后点“应用”' + (dk.placeholder ? '。' : '；或者：');
      over = !dk.placeholder;
    } else if (dk.state === 'loadfail') {
      t = '<strong>读不到计划文件</strong>：' + A.esc(dk.error) + '。编辑区为只读。';
      retry = true;
    }
    el.diskBanner.hidden = !t;
    el.diskBanner.className = 'banner' + (dk.state === 'failed' || dk.state === 'loadfail' ? ' error' : '');
    el.diskText.innerHTML = t;
    el.diskLoad.hidden = !load;
    el.diskOverwrite.hidden = !over;
    el.diskRetry.hidden = !retry;
  }

  function renderTop() {
    var d = S.doc, locked = A.locked();
    var dirty = A.isDirty() && !/^(loading|loadfail|broken)$/.test(S.disk.state);   // 这几种状态下页面里只是占位，不算修改
    // 正在输入标题时不改写输入框（输入中的首尾空格、暂时为空都属正常），撤销等外部变化除外
    var typing = document.activeElement === el.title && S.co && S.co.key === 'title';
    if (!typing && el.title.value !== d.title) el.title.value = d.title;
    el.title.readOnly = locked;
    renderDisk();
    el.tabTpl.setAttribute('aria-pressed', S.page === 'tpl' ? 'true' : 'false');
    el.tabDays.setAttribute('aria-pressed', S.page === 'days' ? 'true' : 'false');
    el.btnUndo.disabled = !S.past.length;
    el.btnRedo.disabled = !S.future.length;
    el.btnTv.setAttribute('aria-pressed', S.tv.open ? 'true' : 'false');
    document.title = (dirty ? '• ' : '') + d.title + ' · 周时间轴';
    document.body.classList.toggle('locked', locked);
    el.banner.hidden = !S.tv.dirty;
    el.bannerTv.hidden = S.tv.open;
  }

  /** 页面工具条：模板页的唯一模板区开关；日程页的两种参照行开关、回到本周 */
  function renderPagebar() {
    var d = S.doc, h = '';
    var info = '范围 ' + C.fmtSpan(d.range.start, d.range.end) + ' · 一周起始' + C.WEEK_NAMES[d.weekStart];
    function toggle(name, label) {
      return '<button class="btn btn-sm" type="button" data-toggle="' + name + '" aria-pressed="' + (S.view[name] ? 'true' : 'false') + '">' + label + '</button>';
    }
    if (S.page === 'tpl') {
      h += '<span class="pb-title">模板页</span>' + toggle('baseOpen', '唯一模板区：' + (S.view.baseOpen ? '展开' : '已折叠'));
    } else {
      var days = C.listDays(d, S.today);
      h += '<span class="pb-title">日程页</span>' + toggle('refBase', '唯一模板参照') + toggle('refWeekly', '周模板参照');
      h += '<button class="btn btn-sm" type="button" data-action="today">回到本周</button>';
      info += ' · ' + C.fmtDateMd(days[0]) + ' 至 ' + C.fmtDateMd(days[days.length - 1]) + '，' + days.length + ' 天';
    }
    h += '<span class="spacer"></span><span class="pb-info">' + esc(info) + '</span>';
    el.pagebar.innerHTML = h;
  }

  function barHtml(key, iv, selected) {
    var R = viewDoc().range, cw = S.cw;
    var left = (iv.start - R.start) / SLOT * cw + 1.5;
    var width = (iv.end - iv.start) / SLOT * cw - 3;
    var cls = 'bar ' + iv.kind + (iv.float ? ' float' : '') + (selected ? ' sel' : '');
    var h = '<div class="' + cls + '" data-key="' + esc(key) + '" data-id="' + esc(iv.id) + '" style="left:' + left + 'px;width:' + width + 'px" title="' + esc(C.describeInterval(key, iv)) + '">';
    h += '<span class="dur">' + C.fmtDur(iv.end - iv.start) + '</span>';
    // FR-5.13：浮动区间显示它的文字，文字为空时显示“浮动”
    if (iv.text) h += '<span class="' + (iv.kind === 'external' ? 'pill-t' : 'txt') + '">' + esc(iv.text) + '</span>';
    else if (iv.float) h += '<span class="flt">浮动</span>';
    return h + '</div>';
  }

  /** FR-4.13：行头用文字标明跟随 / 已编辑 */
  function stateText(d, key) {
    if (key === C.BASE) return '第一级 · 不继承';
    return C.isFollow(d, key) ? '<b>跟随</b>' + (C.keyType(key) === 'weekly' ? '唯一模板' : C.rowName(C.parentKey(key)) + '模板') : '<b>已编辑</b>';
  }

  function editRowHtml(item, r, d, trackW) {
    var key = item.key, R = d.range, cw = S.cw, sel = S.sel;
    var cellRow = sel.type === 'cells' && sel.rows.indexOf(r) >= 0;
    var cls = 'line row ' + C.keyType(key) + (cellRow ? ' rsel' : '') + (item.today ? ' today' : '');
    var name = C.rowName(key);
    var h = '<div class="' + cls + '" data-row="' + r + '" data-key="' + esc(key) + '">';
    h += '<div class="head" data-row="' + r + '"><span class="mark"></span><span class="rtext"><span class="rname">' + esc(name) + '</span><span class="rstate">' + stateText(d, key) + '</span></span>';
    h += '<button class="rowmenu" type="button" tabindex="-1" data-row="' + r + '" aria-label="' + esc(name) + '行菜单" title="' + esc(name) + '行菜单"><svg class="ico" aria-hidden="true"><use href="#i-more"/></svg></button></div>';
    h += '<div class="track" data-row="' + r + '" style="width:' + trackW + 'px">';
    if (cellRow) {
      var spans = [[sel.start, sel.end]];
      if (S.anchor && S.anchor.r === r) spans = [[sel.start, S.anchor.t], [S.anchor.t + SLOT, sel.end]];
      spans.forEach(function (sp) {
        if (sp[1] > sp[0]) h += '<div class="cellfill" style="left:' + ((sp[0] - R.start) / SLOT * cw) + 'px;width:' + ((sp[1] - sp[0]) / SLOT * cw) + 'px"></div>';
      });
      var edge = (sel.rows.indexOf(r - 1) < 0 ? ' st' : '') + (sel.rows.indexOf(r + 1) < 0 ? ' sb' : '');
      h += '<div class="cellsel' + edge + '" style="left:' + ((sel.start - R.start) / SLOT * cw) + 'px;width:' + ((sel.end - sel.start) / SLOT * cw) + 'px"></div>';
    }
    var refs = sel.type === 'intervals' ? sel.refs : [];
    C.eff(d, key).forEach(function (iv) { h += barHtml(key, iv, A.hasRef(refs, { key: key, id: iv.id })); });
    return h + eventsHtml(d, key, trackW) + '</div></div>';
  }

  /** 参照行：只读，没有 data-row，鼠标与键盘都不作用于它（FR-5.25） */
  function refRowHtml(item, d, trackW) {
    var key = item.key;
    var name = key === C.BASE ? '唯一模板' : C.rowName(key) + '模板';
    var lv = key === C.BASE ? 'lv1' : 'lv2';                  // 第几级，见 FR-5.32
    var h = '<div class="line row ref ' + lv + '" data-ref="' + esc(key) + '" aria-readonly="true">';
    h += '<div class="head"><span class="rtext"><span class="rname">' + esc(name) + '</span><span class="rstate">参照 · 只读</span></span></div>';
    h += '<div class="track ref-track" style="width:' + trackW + 'px">';
    C.eff(d, key).forEach(function (iv) { h += barHtml(key, iv, false); });
    return h + eventsHtml(d, key, trackW) + '</div></div>';
  }

  /**
   * 时刻事件（FR-5.29～FR-5.31）：铜色竖线加标签，只显示、不能选中；起床之前、就寝之后铺暗色。
   * 竖线与暗色不接收鼠标，单击落到下面的格或区间；标签接收鼠标只为悬停提示，单击同样按所在时刻处理。
   */
  var EVT_W = 4, EVT_WS_W = 6;                    // 时刻事件竖线的宽度；起床、就寝更粗
  function eventsHtml(d, key, trackW) {
    var evs = C.rowEvents(d, key);                  // 起床、就寝单独继承（需求 3.5 节）
    if (!evs.length) return '';
    var R = d.range, cw = S.cw, ws = C.wakeSleep(evs), h = '';
    function x(t) { return (t - R.start) / SLOT * cw; }
    if (ws.wake != null && ws.wake > R.start) h += '<div class="asleep" style="left:0;width:' + x(ws.wake) + 'px"></div>';
    if (ws.sleep != null && ws.sleep < R.end) h += '<div class="asleep" style="left:' + x(ws.sleep) + 'px;width:' + (trackW - x(ws.sleep)) + 'px"></div>';
    evs.forEach(function (e) {
      var from = e.from === key ? '' : '沿用' + (e.from === C.BASE ? '唯一模板' : C.keyType(e.from) === 'weekly' ? C.rowName(e.from) + '模板' : C.rowName(e.from)) + '，';
      // 竖线整条收在轨道之内，两端的线不被行头遮住一半，粗细处处相同（FR-5.29）
      var w = C.eventRole(e.text) ? EVT_WS_W : EVT_W, left = Math.min(Math.max(x(e.t) - w / 2, 0), trackW - w);
      var X = x(e.t), tip = C.rowName(key) + '，' + C.fmtTime(e.t) + '，' + e.text + '（' + from + '时刻事件，在文本中修改）';
      h += '<div class="evt" style="left:' + left + 'px;width:' + w + 'px">' +
        '<span class="evt-l' + (trackW - X < 80 ? ' flip' : '') + '" title="' + esc(tip) + '">' + esc(e.text) + '</span></div>';
    });
    return h;
  }

  function rulerHtml(d, trackW) {
    var R = d.range, cw = S.cw, ticks = '';
    for (var m = R.start; m <= R.end; m += SLOT) {
      if (m % 60 !== 0) continue;
      // 只标整点；恰在两端的标注对齐到轨道之内（FR-5.9）
      var cls = m === R.start ? 'first' : m === R.end ? 'last' : '';
      ticks += '<span class="tick ' + cls + '" style="left:' + ((m - R.start) / SLOT * cw) + 'px">' + C.fmtTimeShort(m) + '</span>';
    }
    return '<div class="line ruler"><div class="head" aria-hidden="true"></div><div class="ruler-track" style="width:' + trackW + 'px">' + ticks + '</div></div>';
  }

  function itemHtml(item, d, trackW) {
    switch (item.type) {
      case 'ruler': return rulerHtml(d, trackW);
      case 'level':
        return '<div class="line lvl" style="width:' + (HEAD_W + trackW) + 'px"><div class="lvl-text"><strong>' + esc(item.title) + '</strong><span>' + esc(item.sub) + '</span></div></div>';
      case 'group':
        return '<div class="line group" data-week="' + item.week + '" style="width:' + (HEAD_W + trackW) + 'px"><div class="group-text"><strong>' +
          esc(C.fmtDateMd(item.from) + ' – ' + C.fmtDateMd(item.to)) + '</strong>' + (item.tag ? '<span class="tag">' + item.tag + '</span>' : '') + '</div></div>';
      case 'ref': return refRowHtml(item, d, trackW);
      default: return editRowHtml(item, S.order.indexOf(item.key), d, trackW);
    }
  }

  /**
   * FR-5.24：日程页只在有选区时显示一个周模板参照行，取选中那天所属星期的周模板。
   * 格选区按锚点所在行，区间选区按主区间所在行；没有选区时返回 null。
   */
  function weeklyRefKey() {
    if (S.page !== 'days' || !S.view.refWeekly) return null;
    var sel = S.sel, key = null;
    if (sel.type === 'cells') key = S.order[sel.anchor.r];
    else if (sel.type === 'intervals') key = sel.primary.key;
    return key && C.keyType(key) === 'day' ? C.parentKey(key) : null;
  }

  var lastRefShown = false, lastPage = null;
  function renderGrid() {
    var d = viewDoc(), R = d.range, m = S.model;
    S.cw = computeCw();
    var cw = S.cw, trackW = nCells(d) * cw;
    el.grid.style.setProperty('--cw', cw + 'px');
    el.grid.style.setProperty('--gx', (R.start % 60 ? -cw : 0) + 'px');
    el.grid.dataset.page = S.page;
    var old = el.rows.querySelector('.sticky-top'), oldH = old ? old.offsetHeight : 0, oldTop = el.editor.scrollTop;
    var sticky = m.sticky.slice(), refKey = weeklyRefKey();
    if (refKey) sticky.push({ type: 'ref', key: refKey });
    // 标尺以外固定在顶部的部分是上面一层（FR-5.10、FR-5.24）
    var h = '<div class="sticky-top">' + itemHtml(sticky[0], d, trackW);
    if (sticky.length > 1) h += '<div class="layer">' + sticky.slice(1).map(function (item) { return itemHtml(item, d, trackW); }).join('') + '</div>';
    h += '</div>';
    m.rows.forEach(function (item) { h += itemHtml(item, d, trackW); });
    el.rows.innerHTML = h;
    fitBars();
    // 周模板参照行出现或消失时，按固定表头高度的变化调整滚动位置，下面的行在屏幕上不动
    if (lastPage === S.page && lastRefShown !== !!refKey) keepRowsInPlace(el.rows.querySelector('.sticky-top').offsetHeight - oldH, oldTop);
    lastRefShown = !!refKey;
    lastPage = S.page;
  }
  function keepRowsInPlace(delta, oldTop) {
    if (!delta) return;
    var ed = el.editor;
    ed.scrollTop = oldTop + delta;     // 以重画前的位置为准：内容变矮时浏览器可能已先收回过 scrollTop
    if (delta < 0) return;
    // 刚选中的行若被变高的表头盖住，往下露出来
    var r = S.sel.type === 'cells' ? S.sel.anchor.r : S.order.indexOf(S.sel.primary.key);
    var line = el.rows.querySelector('.line.row[data-row="' + r + '"]');
    var sb = el.rows.querySelector('.sticky-top').getBoundingClientRect().bottom;
    if (line && line.getBoundingClientRect().top < sb) ed.scrollTop -= sb - line.getBoundingClientRect().top;
  }

  /**
   * FR-5.15：文字优先。文字被截断的横条整个隐藏时长（nodur）；文字连横条的整个内宽都放不下时折成两行（wrap）。
   * 先统一读出，再统一写，只触发一次排版。
   */
  function fitBars() {
    var marks = [];
    el.rows.querySelectorAll('.bar').forEach(function (b) {
      var t = b.querySelector('.txt, .pill-t, .flt');
      if (!t || t.scrollWidth <= t.clientWidth) return;
      var inner = b.clientWidth - 12;                       // 横条左右内边距各 6px
      var need = t.scrollWidth + (t.classList.contains('pill-t') ? 3 : 0);   // 圈注的边框不计入 scrollWidth
      marks.push([b, need > inner]);
    });
    marks.forEach(function (m) { m[0].classList.add('nodur'); if (m[1]) m[0].classList.add('wrap'); });
  }

  function renderStatus() {
    var sel = S.sel;
    if (sel.type === 'cells') {
      el.selKind.textContent = '格选区';
      el.selKind.className = 'badge cells';
      el.selDesc.textContent = C.describeCells(A.selKeys(), sel.start, sel.end);
    } else if (sel.type === 'intervals') {
      var list = A.selIntervals();
      el.selKind.textContent = list.length > 1 ? '区间选区 ×' + list.length : '区间选区';
      el.selKind.className = 'badge intervals';
      el.selDesc.textContent = list.map(function (f) { return C.describeInterval(f.key, f.iv); }).join('；');
    } else {
      el.selKind.textContent = '无选区';
      el.selKind.className = 'badge';
      el.selDesc.textContent = '单击格或区间开始，拖动选择多格；Alt+1、Alt+2 切换页面；按 ? 查看快捷键';
    }
    renderZoom();
  }

  /** NFR-11：浏览器缩放不是 100% 时提示；悬停显示本机显示参数（web-kit） */
  function renderZoom() {
    var D = window.WebKit && WebKit.display;
    if (!D) return;
    el.zoomHint.hidden = !D.zoomOff;
    if (D.zoomOff) el.zoomHint.textContent = '浏览器缩放 ' + Math.round(D.zoomOff * 100) + '%，按 Ctrl+0 复原';
    el.zoomHint.title = D.text || '';
  }


  /* ---------- 视口：键盘操作后让目标格或区间可见 ---------- */
  function ensureVisible(r, s, e) {
    var R = S.doc.range, cw = S.cw, ed = el.editor;
    var left = HEAD_W + (s - R.start) / SLOT * cw, right = HEAD_W + (e - R.start) / SLOT * cw;
    if (left - HEAD_W < ed.scrollLeft) ed.scrollLeft = left - HEAD_W;
    else if (right > ed.scrollLeft + ed.clientWidth) ed.scrollLeft = Math.min(left - HEAD_W, right - ed.clientWidth + 8);
    var line = el.rows.querySelector('.line.row[data-row="' + r + '"]');
    var sticky = el.rows.querySelector('.sticky-top');
    if (!line || !sticky || sticky.contains(line)) return;
    var top = line.offsetTop;
    var bottom = line.offsetTop + line.offsetHeight, sh = sticky.offsetHeight;
    if (top - sh < ed.scrollTop) ed.scrollTop = top - sh;
    else if (bottom > ed.scrollTop + ed.clientHeight) ed.scrollTop = bottom - ed.clientHeight;
  }
  function ensureVisibleSel() {
    var sel = S.sel;
    if (sel.type === 'cells' && S.anchor) ensureVisible(S.anchor.r, S.anchor.t, S.anchor.t + SLOT);
    else if (sel.type === 'intervals') {
      var p = sel.primary, iv = C.findInRow(S.doc, p.key, p.id);
      if (iv) ensureVisible(S.order.indexOf(p.key), iv.start, iv.end);
    }
  }

  A.computeCw = computeCw;
  A.render = render;
  A.renderTop = renderTop;
  A.renderZoom = renderZoom;
  A.renderGrid = renderGrid;
  A.fitBars = fitBars;
  A.renderStatus = renderStatus;
  A.ensureVisible = ensureVisible;
  A.ensureVisibleSel = ensureVisibleSel;
})(window.WeekApp);
