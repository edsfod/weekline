/*
 * 周时间轴 · 界面层 · 计划文件的读写（需求 7.6 节）
 * 计划文件由服务（weekline.py）按字节读写，页面负责解析与序列化：
 *   GET  /api/plan         → {path, name, exists, text, rev}
 *   POST /api/plan/save    {text, base} → {ok, rev} 或 {ok: false, conflict: true, rev}
 *   POST /api/plan/reveal  在资源管理器中显示
 * S.disk.rev 是页面最近一次读到或写入的文件内容的 SHA-256；S.disk.text 是与之对应的规范文本。
 * 二者不同步时（文件在别处被改过），服务拒绝写入，页面进入冲突状态，由用户二选一（FR-7.15）。
 */
(function (A) {
  'use strict';
  var C = A.C, S = A.S, el = A.el, gen = A.gen;
  var setMsg = A.setMsg, fail = A.fail, guard = A.guard, render = A.render, commit = A.commit;

  var HEADER = 'X-Weekline';
  var SAVE_DELAY = 300;     // 这段时间内的多次修改合并为一次写入
  var RETRY_MS = 5000;      // 写入失败后多久重试
  var saveTimer = 0, retryTimer = 0, inflight = false;

  function safeName(title) { return (title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '周时间轴') + '.md'; }

  /** 调服务；网络错误（服务已停止）与服务报的错都变成 Error(一句话) */
  function api(path, body) {
    var opt = body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opt.headers[HEADER] = '1';
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('服务返回 HTTP ' + r.status));
        return j;
      });
    }, function () { throw new Error('服务没有响应（可能已停止或空闲退出）'); });
  }

  function setDisk(state, error) {
    S.disk.state = state;
    S.disk.error = error || '';
    A.renderTop();
  }

  /* ---------- 读入 ---------- */

  /** 文件内容解析失败（FR-7.13）：不改写文件；文本视图显示原文和全部错误，改好并应用后才写入 */
  function enterBroken(text, errors, rev, placeholder) {
    A.endCoalesce();
    S.disk.rev = rev;
    S.disk.text = null;
    S.disk.placeholder = placeholder;
    S.tv.open = true;
    S.tv.dirty = true;
    S.tv.fromFile = text;
    S.tv.errors = errors;
    el.tvText.value = text;
    setDisk('broken');
    render();
    fail(S.disk.name + ' 有 ' + errors.length + ' 处错误，没有载入，也不会被改写。已在文本视图中显示，改好后点击“应用”。');
  }

  /** 启动时读入计划文件；文件不存在则以示例新建（FR-7.13） */
  function load() {
    return api('/api/plan').then(function (r) {
      S.disk.path = r.path;
      S.disk.name = r.name;
      if (!r.exists) {
        S.doc = C.parse(A.seedText(S.today), gen, S.today).doc;
        S.disk.rev = null;
        S.disk.text = null;
        setDisk('saving');
        flush();
        return '计划文件不存在，已按示例新建：' + r.path;
      }
      var res = C.parse(r.text, gen, S.today);
      if (!res.ok) {
        S.doc = C.makeDoc({ startDate: C.weekFirst(S.today, 0) });
        enterBroken(r.text, res.errors, r.rev, true);
        return null;
      }
      S.doc = res.doc;
      S.disk.rev = r.rev;
      S.disk.text = C.serialize(res.doc);      // 旧格式的文件：原文不同于规范文本，但只在第一次修改后才写回
      setDisk('saved');
      return '已读入 ' + r.path;
    }, function (err) {
      S.doc = C.makeDoc({ startDate: C.weekFirst(S.today, 0) });
      S.disk.text = null;
      setDisk('loadfail', err.message);
      return null;
    });
  }

  /** 用文件的内容替换当前文档，作为一个撤销步骤（外部修改、冲突时选“载入文件的版本”） */
  function adopt(r, msg) {
    if (!r.exists) {                    // 文件在别处被删了：把本页内容重新写回去
      S.disk.rev = null;
      S.disk.text = null;
      setDisk('saving');
      flush();
      return setMsg('计划文件在别处被删除，已用本页的内容重新写入');
    }
    var res = C.parse(r.text, gen, S.today);
    if (!res.ok) return enterBroken(r.text, res.errors, r.rev, false);
    S.disk.rev = r.rev;
    S.disk.text = C.serialize(res.doc);
    S.disk.conflictRev = null;
    if (S.tv.fromFile !== false) { S.tv.fromFile = false; S.tv.dirty = false; S.tv.errors = []; }
    setDisk('saved');
    if (S.disk.placeholder) {           // 启动时文件就有错、页面里只是占位文档：直接换上，不进撤销历史
      S.disk.placeholder = false;
      S.doc = res.doc; S.past = []; S.future = [];
      A.docChanged();
      return setMsg(msg, 'ok');
    }
    if (C.docEquals(res.doc, S.doc)) { render(); return setMsg(msg, 'ok'); }
    commit(res.doc, { msg: msg });
  }

  /** FR-7.15：页面重新获得焦点时检查计划文件是否在别处被修改 */
  function checkExternal() {
    var st = S.disk.state;
    if (st === 'loading' || st === 'loadfail' || inflight) return;
    api('/api/plan').then(function (r) {
      if (r.rev === S.disk.rev || inflight) return;
      if (st === 'broken' || S.disk.state === 'broken') {
        // 文件原本有错：再读一次，改好了就载入
        if (!r.exists) return;
        var res = C.parse(r.text, gen, S.today);
        if (res.ok) return adopt(r, '计划文件已在别处改好，已载入');
        return enterBroken(r.text, res.errors, r.rev, S.disk.placeholder);
      }
      if (A.isDirty()) {
        S.disk.conflictRev = r.rev;
        return setDisk('conflict');
      }
      adopt(r, '已载入计划文件在别处的修改（可以撤销）');
    }, function () { /* 服务不在：等下次写入时再报 */ });
  }

  /* ---------- 自动保存（FR-7.14） ---------- */

  function blocked() {
    var st = S.disk.state;
    return st === 'loading' || st === 'loadfail' || st === 'broken' || st === 'conflict';
  }

  /** 文档变化后调用：安排一次写入 */
  function scheduleSave(now) {
    if (blocked()) return;
    clearTimeout(saveTimer);
    if (!A.isDirty()) {
      if (!inflight) { clearTimeout(retryTimer); if (S.disk.state !== 'saved') setDisk('saved'); }
      return;
    }
    if (S.disk.state === 'saved') setDisk('saving');
    saveTimer = setTimeout(flush, now ? 0 : SAVE_DELAY);
  }

  /** 把当前文档写入计划文件；同一时刻只有一个写请求，写完若文档又变了就再写 */
  function flush() {
    clearTimeout(saveTimer);
    if (inflight || blocked()) return;
    if (!A.isDirty()) { clearTimeout(retryTimer); if (S.disk.state !== 'saved') setDisk('saved'); return; }
    var text = C.serialize(S.doc);
    inflight = true;
    api('/api/plan/save', { text: text, base: S.disk.rev }).then(function (r) {
      inflight = false;
      clearTimeout(retryTimer);
      if (r.ok) {
        S.disk.rev = r.rev;
        S.disk.text = text;
        S.disk.placeholder = false;
        if (A.isDirty()) { setDisk('saving'); flush(); }
        else setDisk('saved');
      } else if (r.conflict) {
        S.disk.conflictRev = r.rev;
        setDisk('conflict');
      }
    }, function (err) {
      inflight = false;
      setDisk('failed', err.message);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, RETRY_MS);
    });
  }

  /** Ctrl+S：立即写入 */
  function saveNow() {
    var st = S.disk.state;
    if (st === 'conflict') return fail('计划文件在别处被修改，请先在上方的提示中二选一');
    if (st === 'broken') return fail('计划文件有错误，在文本视图中改好并应用后才会写入');
    if (st === 'loadfail') return fail('计划文件没有读入，不能写入');
    if (!A.isDirty() && !inflight) return setMsg('计划文件已是最新', 'ok');
    if (st === 'failed') setDisk('saving');
    flush();
  }

  /* ---------- 冲突与失败的处理（顶部提示条上的按钮） ---------- */

  function loadFileVersion() {
    api('/api/plan').then(function (r) { adopt(r, '已载入计划文件的版本；本页原来的修改可以用撤销找回'); },
      function (err) { fail('读取计划文件失败：' + err.message); });
  }
  function overwriteFile() {
    S.disk.rev = S.disk.conflictRev;
    S.disk.text = null;
    if (S.disk.state === 'broken') {           // 放弃文件里有错误的内容，改用本页的内容
      S.tv.fromFile = false; S.tv.dirty = false; S.tv.errors = [];
    }
    setDisk('saving');
    flush();
    setMsg('正在用本页的内容覆盖计划文件');
  }
  function retry() {
    if (S.disk.state === 'loadfail') return location.reload();
    saveNow();
  }

  /* ---------- 导入与导出（FR-7.16、FR-7.17） ---------- */

  function importFile() {
    if (!guard()) return;
    el.fileInput.value = '';
    el.fileInput.click();          // 选择后由 main.js 中的 change 事件调用 handleImported
  }

  function handleImported(text, name) {
    var res = C.parse(text, gen, S.today);
    if (res.ok) {
      if (C.docEquals(res.doc, S.doc)) return setMsg(name + ' 与当前内容相同', 'ok');
      commit(res.doc, { msg: '已导入 ' + name + '（可以撤销）' });
      return;
    }
    S.tv.open = true;
    S.tv.dirty = true;
    S.tv.errors = res.errors;
    el.tvText.value = text;
    render();
    fail(name + ' 有 ' + res.errors.length + ' 处错误，没有导入。已在文本视图中显示，修改后点击“应用”。');
  }

  function exportFile() {
    var text = C.serialize(S.doc), name = safeName(S.doc.title);
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    setMsg('已导出 ' + name + (S.tv.dirty ? '（文本视图中未应用的修改不在其中）' : ''), 'ok');
  }

  /** 顶栏的文件名：完整路径、在资源管理器中显示、复制路径 */
  function openFileMenu() {
    var b = el.fileName.getBoundingClientRect();
    A.openMenu([
      { label: '在资源管理器中显示', action: function () {
        api('/api/plan/reveal', {}).catch(function (err) { fail('打不开资源管理器：' + err.message); });
      } },
      { label: '复制路径', action: function () {
        A.copyText(S.disk.path).then(function (ok) { if (ok) setMsg('已复制计划文件的路径', 'ok'); else fail('复制失败'); });
      } }
    ], b.left, b.bottom + 4, S.disk.path || '计划文件');
  }

  A.loadPlan = load;
  A.checkExternal = checkExternal;
  A.scheduleSave = scheduleSave;
  A.saveNow = saveNow;
  A.loadFileVersion = loadFileVersion;
  A.overwriteFile = overwriteFile;
  A.retrySave = retry;
  A.importFile = importFile;
  A.handleImported = handleImported;
  A.exportFile = exportFile;
  A.openFileMenu = openFileMenu;
})(window.WeekApp);
