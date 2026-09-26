/* 周时间轴 · 界面层 · 菜单（上下文菜单、行菜单）与对话框（文档设置、快捷键）。配色在 web-kit 的显示设置面板里 */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, el = A.el, SLOT = A.SLOT;
  var esc = A.esc, clamp = A.clamp, mod = A.mod, guard = A.guard;

  /* ---------- 菜单 ---------- */
  var menuReturn = null;

  /** items：{label, key?, action} 或分隔线 '-' */
  function openMenu(items, x, y, title) {
    closeMenu(false);
    var m = el.menu;
    m.innerHTML = '';
    if (title) {
      var hd = document.createElement('div');
      hd.className = 'mhead';
      hd.textContent = title;
      m.appendChild(hd);
    }
    items.forEach(function (it) {
      if (it === '-') { m.appendChild(document.createElement('hr')); return; }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mi';
      b.setAttribute('role', 'menuitem');
      b.innerHTML = '<span>' + esc(it.label) + '</span>' + (it.key ? '<kbd>' + esc(it.key) + '</kbd>' : '');
      b.addEventListener('click', function () {
        closeMenu(true);
        it.action();
      });
      m.appendChild(b);
    });
    // 去掉首尾和连续的分隔线
    var kids = Array.prototype.slice.call(m.children);
    kids.forEach(function (k, i) {
      if (k.tagName === 'HR' && (i === 0 || i === kids.length - 1 || (kids[i + 1] && kids[i + 1].tagName === 'HR') || kids[i - 1].className === 'mhead')) k.remove();
    });
    menuReturn = document.activeElement;
    m.hidden = false;
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = clamp(x, 8, window.innerWidth - w - 8) + 'px';
    m.style.top = clamp(y, 8, Math.max(8, window.innerHeight - h - 8)) + 'px';
    var first = m.querySelector('.mi');
    if (first) first.focus();
  }

  function closeMenu(refocus) {
    if (el.menu.hidden) return;
    el.menu.hidden = true;
    if (refocus) {
      if (menuReturn && menuReturn !== document.body && document.contains(menuReturn)) menuReturn.focus({ preventScroll: true });
      else el.editor.focus({ preventScroll: true });
    }
  }

  function onMenuKey(e) {
    var items = Array.prototype.slice.call(el.menu.querySelectorAll('.mi'));
    var i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { items[(i + 1) % items.length].focus(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length].focus(); e.preventDefault(); }
    else if (e.key === 'Home') { items[0].focus(); e.preventDefault(); }
    else if (e.key === 'End') { items[items.length - 1].focus(); e.preventDefault(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { closeMenu(true); e.preventDefault(); }
    e.stopPropagation();
  }

  /** 行菜单的条目（FR-6.19）；上下文菜单里也放一份，作为键盘入口（NFR-4） */
  function rowItems(r, prefix) {
    var key = S.order[r], items = [];
    prefix = prefix || '';
    if (key !== C.BASE && !C.isFollow(S.doc, key)) items.push({ label: prefix + '重置为模板（恢复跟随）', action: function () { A.rowReset(key); } });
    items.push({ label: prefix + '清空此行', action: function () { A.rowClear(key); } });
    items.push({ label: prefix + '选中整行', action: function () { A.rowSelect(r); } });
    return items;
  }

  /** FR-6.9：列出当前选区可用的全部操作及其快捷键 */
  function contextItems() {
    var sel = S.sel, items = [];
    var guarded = function (fn) { return function () { if (guard()) fn(); }; };
    if (sel.type === 'cells') {
      items.push({ label: '设为外部固定安排', key: 'E', action: guarded(function () { A.cellsCreate('external'); }) });
      items.push({ label: '设为自主安排', key: 'S', action: guarded(function () { A.cellsCreate('self'); }) });
      items.push({ label: '设为日常事务', key: 'D', action: guarded(function () { A.cellsCreate('daily'); }) });
      items.push({ label: '清除', key: 'Delete', action: guarded(A.doDelete) });
      items.push('-');
      items.push({ label: '复制', key: mod('C'), action: function () { A.doCopy(false); } });
      items.push({ label: '剪切', key: mod('X'), action: function () { A.doCopy(true); } });
      if (S.clip) items.push({ label: '粘贴', key: mod('V'), action: guarded(A.doPaste) });
      if (S.anchor && C.intervalAt(S.doc, S.order[S.anchor.r], S.anchor.t)) {
        items.push('-');
        items.push({ label: '选中锚点所在的区间', key: 'Space', action: A.selectIntervalAtAnchor });
      }
      var ar = S.anchor ? S.anchor.r : sel.rows[0];
      items.push('-');
      items = items.concat(rowItems(ar, C.rowName(S.order[ar]) + '：'));
    } else if (sel.type === 'intervals') {
      items.push({ label: '改为外部固定安排', key: 'E', action: guarded(function () { A.doSetKind('external'); }) });
      items.push({ label: '改为自主安排', key: 'S', action: guarded(function () { A.doSetKind('self'); }) });
      items.push({ label: '改为日常事务', key: 'D', action: guarded(function () { A.doSetKind('daily'); }) });
      items.push({ label: '切换浮动', key: 'F', action: guarded(A.doToggleFloat) });
      items.push({ label: '编辑文字', key: 'Enter', action: function () { A.startEdit(S.sel.refs); } });
      items.push({ label: '删除', key: 'Delete', action: guarded(A.doDelete) });
      items.push('-');
      items.push({ label: '左移一格', key: '←', action: guarded(function () { A.doShift(-SLOT, -SLOT); }) });
      items.push({ label: '右移一格', key: '→', action: guarded(function () { A.doShift(SLOT, SLOT); }) });
      items.push({ label: '结束端点左移', key: 'Shift+←', action: guarded(function () { A.doShift(0, -SLOT); }) });
      items.push({ label: '结束端点右移', key: 'Shift+→', action: guarded(function () { A.doShift(0, SLOT); }) });
      items.push({ label: '开始端点左移', key: mod('←'), action: guarded(function () { A.doShift(-SLOT, 0); }) });
      items.push({ label: '开始端点右移', key: mod('→'), action: guarded(function () { A.doShift(SLOT, 0); }) });
      items.push({ label: '移到上一行', key: 'Alt+↑', action: guarded(function () { A.doMoveRow(-1); }) });
      items.push({ label: '移到下一行', key: 'Alt+↓', action: guarded(function () { A.doMoveRow(1); }) });
      items.push('-');
      items.push({ label: '复制', key: mod('C'), action: function () { A.doCopy(false); } });
      items.push({ label: '剪切', key: mod('X'), action: function () { A.doCopy(true); } });
      if (S.clip) items.push({ label: '粘贴', key: mod('V'), action: guarded(A.doPaste) });
    }
    items.push('-');
    items.push({ label: '切换到' + (S.page === 'tpl' ? '日程页' : '模板页'), key: S.page === 'tpl' ? 'Alt+2' : 'Alt+1', action: function () { A.setPage(S.page === 'tpl' ? 'days' : 'tpl'); } });
    items.push({ label: '撤销', key: mod('Z'), action: A.undo });
    items.push({ label: '重做', key: mod('Y'), action: A.redo });
    if (sel.type !== 'none') items.push({ label: '清空选区', key: 'Esc', action: A.clearSel });
    return items;
  }

  function openContextMenu(x, y) {
    var title = S.sel.type === 'cells' ? '格选区' : S.sel.type === 'intervals' ? '区间选区' : '';
    openMenu(contextItems(), x, y, title);
  }

  /** 键盘打开上下文菜单（Shift+F10 或菜单键）：定位在选区旁边 */
  function openContextMenuForSel() {
    var target;
    if (S.sel.type === 'intervals') {
      var p = S.sel.primary;
      target = el.rows.querySelector('.bar[data-key="' + A.cssEsc(p.key) + '"][data-id="' + A.cssEsc(p.id) + '"]');
    } else target = el.rows.querySelector('.anchor') || el.rows.querySelector('.cellsel');
    var b = (target || el.editor).getBoundingClientRect();
    openContextMenu(b.left + 8, b.bottom + 4);
  }

  /** FR-6.19：行头菜单 */
  function openRowMenu(r, x, y) {
    var items = rowItems(r);
    if (S.sel.type === 'cells') {
      var inSel = S.sel.rows.indexOf(r) >= 0;
      items.push('-');
      items.push({ label: inSel ? '移出格选区' : '加入格选区', key: mod('单击行头'), action: function () { A.rowToggle(r); } });
    }
    openMenu(items, x, y, C.rowName(S.order[r]) + (C.isFollow(S.doc, S.order[r]) ? '（跟随）' : ''));
  }

  /* ---------- 对话框 ---------- */

  /**
   * 模态对话框，返回 Promise，值为所点按钮的 value（Esc 为 null）。
   * opts.onConfirm 在点 value 为 'ok' 的按钮时调用，返回错误说明则对话框保持打开。
   */
  function showDialog(opts) {
    return new Promise(function (resolve) {
      var d = el.dlg;
      el.dlgTitle.textContent = opts.title;
      el.dlgBody.innerHTML = opts.body || '';
      el.dlgErr.hidden = true;
      el.dlgBtns.innerHTML = '';
      var ret = document.activeElement;
      function close(v) {
        d.oncancel = null;
        if (d.open) d.close();
        if (ret && document.contains(ret) && ret !== document.body) ret.focus({ preventScroll: true });
        else el.editor.focus({ preventScroll: true });
        resolve(v);
      }
      var primaryBtn = null;
      (opts.buttons || [{ label: '确定', value: 'ok', primary: true }]).forEach(function (bt) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn' + (bt.primary ? ' primary' : '');
        b.textContent = bt.label;
        b.addEventListener('click', function () {
          if (bt.value === 'ok' && opts.onConfirm) {
            var err = opts.onConfirm();
            if (err) { el.dlgErr.textContent = err; el.dlgErr.hidden = false; return; }
          }
          close(bt.value);
        });
        if (bt.primary) primaryBtn = b;
        el.dlgBtns.appendChild(b);
      });
      d.oncancel = function (ev) { ev.preventDefault(); close(null); };
      d.showModal();
      if (opts.onOpen) opts.onOpen(d);
      var f = opts.focus ? d.querySelector(opts.focus) : primaryBtn;
      if (f) f.focus();
    });
  }

  /** 下拉选项；不用系统时间、日期控件（NFR-5） */
  function options(list, selected) {
    return list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === selected ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function timeList(from, to) { var a = []; for (var m = from; m <= to; m += SLOT) a.push([m, C.fmtTime(m)]); return a; }
  function numList(from, to, suffix) { var a = []; for (var n = from; n <= to; n++) a.push([n, n + suffix]); return a; }

  /** FR-5.28：文档设置（显示范围、一周起始日、起始日），一次提交作为一个撤销步骤 */
  function editSettings() {
    if (!guard()) return;
    var d = S.doc, R = d.range;
    var sd = d.startDate.split('-').map(Number), ty = +S.today.slice(0, 4);
    var years = numList(Math.min(sd[0], ty) - 2, Math.max(sd[0], ty) + 1, ' 年');
    var body =
      '<div class="form-grid">' +
      '<span>显示范围</span><div class="form-row"><select id="stStart" aria-label="显示范围起点">' + options(timeList(0, 1380), R.start) + '</select>–' +
      '<select id="stEnd" aria-label="显示范围终点">' + options(timeList(60, 1440), R.end) + '</select></div>' +
      '<span>一周起始</span><div class="form-row"><select id="stWeek" aria-label="一周起始日">' + options(C.WEEK_NAMES.map(function (n, i) { return [i, n]; }), d.weekStart) + '</select></div>' +
      '<span>起始日</span><div class="form-row"><select id="stY" aria-label="起始日年">' + options(years, sd[0]) + '</select>' +
      '<select id="stM" aria-label="起始日月">' + options(numList(1, 12, ' 月'), sd[1]) + '</select>' +
      '<select id="stD" aria-label="起始日日">' + options(numList(1, 31, ' 日'), sd[2]) + '</select>' +
      '<button class="btn btn-sm" type="button" id="stThisWeek">本周第一天</button></div>' +
      '</div>' +
      '<p class="hint" id="stHint" style="margin-top:10px"></p>';
    function readDate() { return A.$('stY').value + '-' + C.pad2(+A.$('stM').value) + '-' + C.pad2(+A.$('stD').value); }
    function hint() {
      var ws = +A.$('stWeek').value, sdate = readDate();
      var txt = '日程页显示到 ' + C.loadEnd(S.today, ws) + '（今天 ' + S.today + ' 所在周的下一周最后一天）。';
      if (!C.isDate(sdate)) txt = '起始日 ' + sdate + ' 不是有效的日期。';
      A.$('stHint').textContent = txt + '修改一周起始日不会改变任何安排的内容。';
    }
    showDialog({
      title: '文档设置',
      body: body,
      buttons: [{ label: '取消', value: null }, { label: '应用', value: 'ok', primary: true }],
      focus: '#stStart',
      onOpen: function (dlg) {
        dlg.addEventListener('change', hint);
        A.$('stThisWeek').onclick = function () {
          var f = C.weekFirst(S.today, +A.$('stWeek').value).split('-').map(Number);
          A.$('stY').value = f[0]; A.$('stM').value = f[1]; A.$('stD').value = f[2];
          hint();
        };
        hint();
      },
      onConfirm: function () {
        var res = C.setSettings(S.doc, {
          range: { start: +A.$('stStart').value, end: +A.$('stEnd').value },
          weekStart: +A.$('stWeek').value,
          startDate: readDate()
        }, S.today);
        if (!res.ok) return res.error;
        A.commit(res.doc, { msg: res.unchanged ? '文档设置没有变化' : '已更新文档设置' });
        return null;
      }
    });
  }

  function showHelp() {
    var mouse = [
      ['单击', '选中格；格属于区间时选中该区间'], ['拖动', '选中矩形格选区（可跨行，跳过参照行）'], ['Shift+单击', '以锚点为对角扩展格选区'],
      [mod('单击行头'), '把该行加入或移出格选区'], [mod('单击区间'), '把区间加入或移出区间选区'],
      ['拖动选中区间的左右边缘', '调整端点'], ['双击区间', '编辑文字'], ['右键', '上下文菜单；右键行头为行菜单']
    ];
    var keys = [
      ['Alt+1 / Alt+2', '切换到模板页 / 日程页'],
      ['E', '格选区：设为外部固定安排并编辑文字；区间：改为外部固定安排'], ['S', '格选区：设为自主安排；区间：改为自主安排'],
      ['D', '格选区：设为日常事务并编辑文字；区间：改为日常事务'],
      ['F', '区间：切换浮动'], ['Enter', '区间：编辑文字'], ['Space', '格选区：选中锚点所在的区间'],
      ['Delete / Backspace', '清除格 / 删除区间'], ['← →', '格：移动锚点；区间：平移一格'],
      ['Shift+← →', '格：扩展时间段；区间：移动结束端点'], [mod('← →'), '区间：移动开始端点'],
      ['↑ ↓', '格：移动锚点；区间：变为相邻行的同时段格选区'], ['Shift+↑ ↓', '格：扩展行'], ['Alt+↑ ↓', '区间：移到相邻行'],
      ['Tab / Shift+Tab', '区间：选中下一个 / 上一个区间'], [mod('C') + ' / ' + mod('X') + ' / ' + mod('V'), '复制 / 剪切 / 粘贴（可跨页）'],
      [mod('Z') + ' / ' + mod('Y'), '撤销 / 重做'], [mod('S'), '立即写入计划文件'], ['Esc', '清空选区'], ['Shift+F10 或菜单键', '上下文菜单'], ['?', '本帮助']
    ];
    function table(list) {
      return '<table><tbody>' + list.map(function (r) { return '<tr><th><kbd>' + esc(r[0]) + '</kbd></th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>';
    }
    var legend = '<div class="legend">' +
      '<div class="bar external"><span class="dur">4h</span><span class="pill-t">上课</span></div>' +
      '<div class="bar self"><span class="dur">3h</span><span class="txt">家务</span></div>' +
      '<div class="bar daily"><span class="dur">1h</span><span class="txt">吃饭</span></div>' +
      '<div class="bar self float"><span class="dur">2h</span><span class="flt">浮动</span></div>' +
      '<div class="bar self sel"><span class="dur">4h</span><span class="txt">已选中</span></div></div>' +
      '<p class="hint" style="margin-top:6px">外部固定安排：实底、文字加圆角圈注；自主安排：浅底描边、文字无框；日常事务：浅绿半透明、无描边；时刻事件：蜂蜜黄竖线加标签，只能在文本视图里写（如“10:00 吃药”），“起床”“睡觉”的线外铺暗色；浮动：虚线边框，没有文字时显示“浮动”；选中：外圈粗描边。</p>' +
      '<p class="hint">行头写“跟随”的行随上级变化；第一次改动它时会先复制上级的内容，之后写“已编辑”，不再跟随。行菜单里的“重置为模板”可以恢复跟随。</p>';
    showDialog({
      title: '快捷键与图例',
      body: '<div class="help"><h3>图例</h3>' + legend + '<h3>鼠标</h3>' + table(mouse) + '<h3>键盘（焦点在编辑区时）</h3>' + table(keys) + '</div>',
      buttons: [{ label: '关闭', value: 'ok', primary: true }]
    });
  }

  A.openMenu = openMenu;
  A.closeMenu = closeMenu;
  A.onMenuKey = onMenuKey;
  A.openContextMenu = openContextMenu;
  A.openContextMenuForSel = openContextMenuForSel;
  A.openRowMenu = openRowMenu;
  A.showDialog = showDialog;
  A.editSettings = editSettings;
  A.showHelp = showHelp;
})(window.WeekApp);
