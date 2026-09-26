/*
 * 周时间轴 · 纯函数核心（NFR-9）
 * 不访问 DOM、不访问存储、不读系统时间（当前日期由调用方传入）。
 * 所有编辑操作返回 {ok, doc, error, ...}，失败时 doc 为原文档（FR-4.2）。计划文档是不可变对象。
 *
 * 计划文档：{ title, range: {start, end}, weekStart, startDate, objs, note }
 *   weekStart：一周起始日，0 至 6（0 为周日）。startDate：起始日，'YYYY-MM-DD'。
 *   objs：安排对象，按行键索引：
 *     'B'            唯一模板（总是已编辑）
 *     'W0' … 'W6'    周模板，W0 为周日（七个都在，用 follow 区分跟随 / 已编辑）
 *     'D2026-09-29'  具体日子（只存已编辑的；不在 objs 里的日子处于跟随状态）
 * 安排对象：{ follow, intervals, events }，跟随时 intervals、events 都为空（I-6、3.5 节）。
 * 时刻事件：{ t, text }，只由 parse 产生，编辑操作不改它。
 * 区间：{ id, start, end, kind: 'external' | 'self' | 'daily', text, float }
 * 有效内容 eff(doc, key)：沿上级链（D → 同星期的 W → B）找到第一个已编辑的对象，取它的区间。
 * 区间引用 ref = {key, id}：跟随行显示的是上级的区间对象，同一个 id 会出现在多行，必须带行键。
 */
(function (root) {
  'use strict';

  var SLOT = 30;
  var BASE = 'B';
  var WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var KIND_LABEL = { external: '外部固定安排', self: '自主安排', daily: '日常事务' };
  var DEFAULT_TITLE = '本周时间安排';
  var DEFAULT_RANGE = { start: 420, end: 1350 };
  var PAREN_RE = /^[(（][\s\S]*[)）]$/;   // 整段用圆括号括起来：日常事务
  var FLOAT_WORD = '浮动';   // 文字为空的浮动区间显示、写出的文字（FR-5.13、7.1 节）
  var FOLLOW = Object.freeze({ follow: true, intervals: Object.freeze([]), events: Object.freeze([]) });

  /* ---------- 格式化（不依赖区域设置，NFR-5） ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /** 规范写法 HH:MM */
  function fmtTime(m) { return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
  /** 标尺写法 H:MM */
  function fmtTimeShort(m) { return Math.floor(m / 60) + ':' + pad2(m % 60); }
  /** 界面显示用区间，en dash */
  function fmtSpan(s, e) { return fmtTime(s) + '–' + fmtTime(e); }
  /** md 文本用区间，连字符 */
  function fmtSpanMd(s, e) { return fmtTime(s) + '-' + fmtTime(e); }
  /** FR-4.6：小时，最多一位小数，末尾不补零 */
  function fmtDur(min) { return String(Math.round(min / 6) / 10) + 'h'; }
  function charLen(s) { return Array.from(s).length; }

  /* ---------- 日期（'YYYY-MM-DD'，按 UTC 天数手算，不受时区与区域设置影响） ---------- */

  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DAY_MS = 86400000;

  function isDate(s) {
    var m = DATE_RE.exec(s || '');
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return false;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }
  /** 自 1970-01-01 起的天数 */
  function dayNum(s) {
    var m = DATE_RE.exec(s);
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
  }
  function fromDayNum(n) {
    var dt = new Date(n * DAY_MS);
    return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
  }
  function addDays(s, n) { return fromDayNum(dayNum(s) + n); }
  /** 星期，0 为周日（1970-01-01 是周四） */
  function weekdayOf(s) { return ((dayNum(s) + 4) % 7 + 7) % 7; }
  /** s 所在周的第一天（周按 weekStart 划分） */
  function weekFirst(s, weekStart) { return addDays(s, -((weekdayOf(s) - weekStart + 7) % 7)); }
  /** FR-4.14：加载范围的最后一天 = 当前日期所在周的下一周的最后一天 */
  function loadEnd(today, weekStart) { return addDays(weekFirst(today, weekStart), 13); }
  /** 加载范围内的全部日期 */
  function listDays(doc, today) {
    var out = [], end = dayNum(loadEnd(today, doc.weekStart));
    for (var n = dayNum(doc.startDate); n <= end; n++) out.push(fromDayNum(n));
    return out;
  }
  /** “9月29日” */
  function fmtDateMd(s) { var m = DATE_RE.exec(s); return (+m[2]) + '月' + (+m[3]) + '日'; }
  /** FR-5.27：“9月29日 周二” */
  function fmtDateCn(s) { return fmtDateMd(s) + ' ' + WEEK_NAMES[weekdayOf(s)]; }

  /* ---------- 行键 ---------- */

  function weeklyKey(w) { return 'W' + w; }
  function dayKey(date) { return 'D' + date; }
  function keyType(key) { return key === BASE ? 'base' : (key.charAt(0) === 'W' ? 'weekly' : 'day'); }
  function keyDate(key) { return key.slice(1); }
  function keyWeekday(key) {
    var t = keyType(key);
    return t === 'weekly' ? +key.slice(1) : (t === 'day' ? weekdayOf(keyDate(key)) : -1);
  }
  function isKey(key) {
    if (key === BASE) return true;
    if (/^W[0-6]$/.test(key)) return true;
    return key.charAt(0) === 'D' && isDate(key.slice(1));
  }
  function parentKey(key) {
    var t = keyType(key);
    if (t === 'base') return null;
    if (t === 'weekly') return BASE;
    return weeklyKey(weekdayOf(keyDate(key)));
  }
  /** 行名：唯一模板 / 周二 / 9月29日 周二 */
  function rowName(key) {
    var t = keyType(key);
    if (t === 'base') return '唯一模板';
    if (t === 'weekly') return WEEK_NAMES[+key.slice(1)];
    return fmtDateCn(keyDate(key));
  }
  /** md 小节头 */
  function mdHeading(key) {
    var t = keyType(key);
    if (t === 'base') return '唯一模板';
    if (t === 'weekly') return WEEK_NAMES[+key.slice(1)];
    var d = keyDate(key);
    return d + ' ' + WEEK_NAMES[weekdayOf(d)];
  }
  /** 从一周起始日开始的星期顺序 */
  function weeklyOrder(weekStart) {
    var out = [];
    for (var i = 0; i < 7; i++) out.push((weekStart + i) % 7);
    return out;
  }

  /* ---------- 构造与读取 ---------- */

  function makeIdGen(prefix) {
    var n = 0;
    prefix = prefix || 'i';
    return function () { n += 1; return prefix + n.toString(36); };
  }

  function makeDoc(opts) {
    opts = opts || {};
    var objs = { B: { follow: false, intervals: opts.base || [], events: opts.baseEvents || [] } };
    for (var w = 0; w < 7; w++) objs[weeklyKey(w)] = FOLLOW;
    if (opts.objs) for (var k in opts.objs) objs[k] = opts.objs[k];
    return {
      title: opts.title != null ? opts.title : DEFAULT_TITLE,
      range: opts.range ? { start: opts.range.start, end: opts.range.end } : { start: DEFAULT_RANGE.start, end: DEFAULT_RANGE.end },
      weekStart: opts.weekStart != null ? opts.weekStart : 0,
      startDate: opts.startDate,
      objs: objs,
      note: opts.note != null ? opts.note : ''
    };
  }

  /** 3.3 节：浮动区间的文字为“浮动”时按空处理 */
  function floatText(text, float) { return float && text === FLOAT_WORD ? '' : text; }
  function mkInterval(gen, start, end, kind, text, float) {
    return { id: gen(), start: start, end: end, kind: kind || 'self', text: floatText(text || '', !!float), float: !!float };
  }
  function copyIv(iv, id) {
    return { id: id, start: iv.start, end: iv.end, kind: iv.kind, text: iv.text, float: iv.float };
  }

  function withObjs(doc, objs) {
    return { title: doc.title, range: doc.range, weekStart: doc.weekStart, startDate: doc.startDate, objs: objs, note: doc.note };
  }

  function sortRow(row) {
    return row.slice().sort(function (a, b) { return a.start - b.start; });
  }

  function getObj(doc, key) { return doc.objs[key] || FOLLOW; }
  function isFollow(doc, key) { return key !== BASE && getObj(doc, key).follow; }

  /** 有效内容（3.2 节） */
  function eff(doc, key) {
    for (var k = key; k; k = parentKey(k)) {
      var o = getObj(doc, k);
      if (!o.follow) return o.intervals;
    }
    return [];
  }

  /** 有效的时刻事件（3.5 节）：与有效区间取自同一个安排对象 */
  function effEvents(doc, key) {
    for (var k = key; k; k = parentKey(k)) {
      var o = getObj(doc, k);
      if (!o.follow) return o.events || [];
    }
    return [];
  }

  /**
   * 已编辑的安排对象：区间换成 intervals；时刻事件已编辑行保留自己的，
   * 跟随行复制上级的（FR-4.8），但起床、就寝除外，它们单独继承（3.5 节）
   */
  function editedObj(doc, key, intervals) {
    var o = getObj(doc, key);
    var events = o.follow ? effEvents(doc, key).filter(function (e) { return !eventRole(e.text); }) : (o.events || []);
    return { follow: false, intervals: intervals, events: events };
  }

  /** 起床、就寝（3.5 节）：按文字认出；eventRole 返回 'wake'、'sleep' 或 null */
  var WAKE_WORDS = ['起床'], SLEEP_WORDS = ['睡觉', '就寝'];
  function eventRole(text) {
    return WAKE_WORDS.indexOf(text) >= 0 ? 'wake' : SLEEP_WORDS.indexOf(text) >= 0 ? 'sleep' : null;
  }
  function wakeSleep(events) {
    var r = { wake: null, sleep: null };
    events.forEach(function (e) { var role = eventRole(e.text); if (role && r[role] == null) r[role] = e.t; });
    return r;
  }
  /**
   * 有效的起床、就寝（3.5 节）：两者分别沿上级链找第一个写了它的已编辑对象。
   * 返回 {wake, sleep}，各为 {t, text, from}（from 为写它的行键）或 null
   */
  function effWakeSleep(doc, key) {
    var r = { wake: null, sleep: null };
    for (var k = key; k && !(r.wake && r.sleep); k = parentKey(k)) {
      var o = getObj(doc, k);
      if (o.follow) continue;
      (o.events || []).forEach(function (e) {
        var role = eventRole(e.text);
        if (role && !r[role]) r[role] = { t: e.t, text: e.text, from: k };
      });
    }
    return r;
  }
  /** 一行要显示的时刻事件：普通事件取自有效对象，起床、就寝取自 effWakeSleep；按时刻排序，各带 from */
  function rowEvents(doc, key) {
    var src = key;
    for (var k = key; k; k = parentKey(k)) { if (!getObj(doc, k).follow) { src = k; break; } }
    var list = effEvents(doc, key).filter(function (e) { return !eventRole(e.text); })
      .map(function (e) { return { t: e.t, text: e.text, from: src }; });
    var ws = effWakeSleep(doc, key);
    if (ws.wake) list.push(ws.wake);
    if (ws.sleep) list.push(ws.sleep);
    return sortEvents(list);
  }
  /** 写它的行不是本行时，说明沿用自哪里 */
  function srcNote(key, from) {
    if (from === key) return '';
    return '（沿用' + (from === BASE ? '唯一模板' : keyType(from) === 'weekly' ? rowName(from) + '模板' : rowName(from)) + '）';
  }
  /** 有效的起床须早于有效的就寝，返回错误说明或 null */
  function checkWakeSleep(doc, key) {
    var ws = effWakeSleep(doc, key);
    if (!ws.wake || !ws.sleep || ws.wake.t < ws.sleep.t) return null;
    return rowName(key) + ' 的起床时刻 ' + fmtTime(ws.wake.t) + srcNote(key, ws.wake.from) +
      ' 必须早于就寝时刻 ' + fmtTime(ws.sleep.t) + srcNote(key, ws.sleep.from);
  }

  /** 按时刻排序，同一时刻保持原有先后 */
  function sortEvents(list) {
    return list.map(function (e, i) { return [e, i]; })
      .sort(function (a, b) { return a[0].t - b[0].t || a[1] - b[1]; })
      .map(function (x) { return x[0]; });
  }

  /** 一个安排对象的时刻事件是否合法（3.5 节），返回错误说明或 null */
  function checkEvents(list, range, key) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i], at = rowName(key) + ' ' + fmtTime(e.t);
      if (e.t % SLOT !== 0) return at + ' 不是整点或半点';
      if (e.t < range.start || e.t > range.end) return at + ' 超出显示范围 ' + fmtSpan(range.start, range.end);
      if (!e.text) return at + '：时刻事件要写文字';
      var te = validateText(e.text);
      if (te) return at + '：' + te;
    }
    var n = { wake: 0, sleep: 0 };
    list.forEach(function (e) { var role = eventRole(e.text); if (role) n[role]++; });
    if (n.wake > 1) return rowName(key) + ' 有不止一个起床时刻';
    if (n.sleep > 1) return rowName(key) + ' 有不止一个就寝时刻';
    return null;
  }

  function findInRow(doc, key, id) {
    var row = eff(doc, key);
    for (var i = 0; i < row.length; i++) if (row[i].id === id) return row[i];
    return null;
  }
  function intervalAt(doc, key, t) {
    var row = eff(doc, key);
    for (var i = 0; i < row.length; i++) if (row[i].start <= t && t < row[i].end) return row[i];
    return null;
  }

  /* ---------- 描述 ---------- */

  function describeInterval(key, iv) {
    var parts = [rowName(key), fmtSpan(iv.start, iv.end), fmtDur(iv.end - iv.start), KIND_LABEL[iv.kind]];
    if (iv.text) parts.push(iv.text);
    if (iv.float) parts.push('浮动');
    return parts.join('，');
  }
  function describeCells(keys, start, end) {
    return keys.map(rowName).join('、') + '，' + fmtSpan(start, end) + '，' + fmtDur(end - start);
  }
  function loc(key, s, e) { return rowName(key) + ' ' + fmtSpan(s, e); }

  /* ---------- 校验 ---------- */

  /** 区间文字（3.3 节），返回错误说明或 null。调用前应已去除首尾空白。 */
  function validateText(text) {
    if (/[\r\n]/.test(text)) return '文字不能包含换行';
    if (/[\[\]]/.test(text)) return '文字不能包含“[”或“]”';
    // “~”在 md 中是浮动标记（FR-7.3），文字里有它就读不回来（FR-7.8）
    if (/[~～]/.test(text)) return '文字不能包含“~”或“～”（“~”在文本中表示浮动）';
    // 整段用圆括号括起来的文字在 md 中读作日常事务（7.1 节）
    if (PAREN_RE.test(text)) return '文字不能整段用圆括号括起来（圆括号在文本中表示日常事务）';
    if (text !== text.trim()) return '文字首尾不能有空白';
    if (charLen(text) > 40) return '文字不能超过 40 个字符（当前 ' + charLen(text) + ' 个）';
    return null;
  }
  function validateTitle(title) {
    if (title === '') return '标题不能为空';
    if (/[\r\n]/.test(title)) return '标题不能包含换行';
    if (charLen(title) > 100) return '标题不能超过 100 个字符';
    return null;
  }
  function validateRange(s, e) {
    if (s % SLOT !== 0 || e % SLOT !== 0) return '显示范围的起止必须是整点或半点';
    if (s < 0 || e > 1440) return '显示范围必须在 00:00–24:00 之内';
    if (e - s < 60) return '显示范围至少为 1 小时';
    return null;
  }
  function validateWeekStart(w) {
    return (w === Math.floor(w) && w >= 0 && w <= 6) ? null : '一周起始日无效';
  }

  /** 检查一个安排对象的区间是否满足 I-1 至 I-4 */
  function checkRow(row, range, key) {
    for (var i = 0; i < row.length; i++) {
      var iv = row[i];
      if (iv.start % SLOT !== 0 || iv.end % SLOT !== 0) return loc(key, iv.start, iv.end) + ' 的端点不是整点或半点';
      if (!(iv.start < iv.end)) return loc(key, iv.start, iv.end) + ' 的结束不晚于开始';
      if (iv.start < range.start || iv.end > range.end) return loc(key, iv.start, iv.end) + ' 超出显示范围 ' + fmtSpan(range.start, range.end);
      if (i > 0) {
        var p = row[i - 1];
        if (p.start > iv.start) return rowName(key) + ' 的区间没有按开始时刻排序';
        if (p.end > iv.start) return loc(key, iv.start, iv.end) + ' 与 ' + fmtSpan(p.start, p.end) + ' 重叠';
      }
    }
    return null;
  }

  /** 计划文档的不变式 I-1 至 I-7 及字段约束（起始日与加载范围的关系另由 setSettings / parse 检查） */
  function validateDoc(doc) {
    var err = validateTitle(doc.title) || validateRange(doc.range.start, doc.range.end) || validateWeekStart(doc.weekStart);
    if (err) return err;
    if (!isDate(doc.startDate)) return '起始日无效';
    var objs = doc.objs;
    if (!objs[BASE] || objs[BASE].follow) return '缺少唯一模板';
    for (var w = 0; w < 7; w++) if (!objs[weeklyKey(w)]) return '缺少' + WEEK_NAMES[w] + '的周模板';
    var ids = Object.create(null);
    for (var key in objs) {
      if (!isKey(key)) return '无效的行键：' + key;
      var o = objs[key];
      if (o.follow) {
        if (o.intervals.length || (o.events && o.events.length)) return rowName(key) + ' 处于跟随状态，却有自己的区间或时刻事件';
        if (keyType(key) === 'day') return rowName(key) + ' 处于跟随状态，不应单独保存';
        continue;
      }
      err = checkRow(o.intervals, doc.range, key) || checkEvents(o.events || [], doc.range, key) || checkWakeSleep(doc, key);
      if (err) return err;
      for (var i = 0; i < o.intervals.length; i++) {
        var iv = o.intervals[i];
        if (ids[iv.id]) return '区间 id 重复：' + iv.id;
        ids[iv.id] = true;
        if (!KIND_LABEL.hasOwnProperty(iv.kind)) return loc(key, iv.start, iv.end) + ' 的类别无效';
        var te = validateText(iv.text);
        if (te) return loc(key, iv.start, iv.end) + '：' + te;
        if (iv.float && iv.text === FLOAT_WORD) return loc(key, iv.start, iv.end) + '：浮动区间的文字不能是“' + FLOAT_WORD + '”';
      }
    }
    return null;
  }

  /* ---------- 结果 ---------- */

  function ok(doc, extra) {
    var res = { ok: true, doc: doc, error: null };
    if (extra) for (var k in extra) res[k] = extra[k];
    return res;
  }
  function fail(doc, error) { return { ok: false, doc: doc, error: error }; }
  function finish(orig, next, extra) {
    var err = validateDoc(next);
    return err ? fail(orig, err) : ok(next, extra);
  }

  /* ---------- 编辑的统一入口（FR-4.8） ---------- */

  function sameContent(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      var x = a[i], y = b[i];
      if (x.start !== y.start || x.end !== y.end || x.kind !== y.kind || x.text !== y.text || x.float !== y.float) return false;
    }
    return true;
  }

  /** 行的自有副本：已编辑行直接取自己的区间；跟随行复制有效内容并分配新 id，同时给出“旧 id → 新 id” */
  function ownCopy(doc, key, gen) {
    var o = getObj(doc, key);
    if (!o.follow) return { list: o.intervals.slice(), map: null };
    var map = {};
    var list = eff(doc, key).map(function (iv) {
      var n = copyIv(iv, gen());
      map[iv.id] = n.id;
      return n;
    });
    return { list: list, map: map };
  }

  /**
   * 对若干行执行修改。fn(list, key, map, k) 返回新的区间数组，或返回字符串表示错误（整体不生效）。
   * 修改后内容与原有效内容相同的行保持原样（跟随的仍然跟随）；否则该行变为已编辑。
   * 返回的 maps[key] 是跟随行变为已编辑时的 id 映射。
   */
  function editRows(doc, keys, fn, gen) {
    var objs = null, maps = {};
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var own = ownCopy(doc, key, gen);
      var r = fn(own.list, key, own.map, k);
      if (typeof r === 'string') return fail(doc, r);
      var after = sortRow(r);
      if (sameContent(eff(doc, key), after)) continue;
      if (!objs) objs = Object.assign({}, doc.objs);
      objs[key] = editedObj(doc, key, after);
      if (own.map) maps[key] = own.map;
    }
    if (!objs) return ok(doc, { maps: maps, unchanged: true });
    return finish(doc, withObjs(doc, objs), { maps: maps });
  }

  function groupRefs(refs) {
    var keys = [], ids = {};
    refs.forEach(function (r) {
      if (!ids[r.key]) { ids[r.key] = []; keys.push(r.key); }
      ids[r.key].push(r.id);
    });
    return { keys: keys, ids: ids };
  }
  function remapRefs(refs, maps) {
    return refs.map(function (r) {
      var m = maps && maps[r.key];
      return { key: r.key, id: (m && m[r.id]) || r.id };
    });
  }
  function mapIds(ids, map) {
    var s = Object.create(null);
    ids.forEach(function (id) { s[map ? (map[id] || id) : id] = true; });
    return s;
  }
  function checkRefs(doc, refs) {
    if (!refs.length) return '没有选中区间';
    for (var i = 0; i < refs.length; i++) if (!findInRow(doc, refs[i].key, refs[i].id)) return '所选区间已不存在';
    return null;
  }

  /** 按引用修改区间属性的通用形式 */
  function editRefs(doc, refs, fn, gen) {
    var err = checkRefs(doc, refs);
    if (err) return fail(doc, err);
    var g = groupRefs(refs);
    var res = editRows(doc, g.keys, function (list, key, map) {
      var set = mapIds(g.ids[key], map);
      return fn(list, set, key);
    }, gen);
    if (res.ok) res.refs = remapRefs(refs, res.maps);
    return res;
  }

  /* ---------- 写入类操作（FR-4.4 覆盖处理） ---------- */

  /** 从一行中清除 [s, e)，截断部分重叠的区间；剩两段时两段都分配新 id */
  function clearSpan(row, s, e, gen) {
    var out = [];
    row.forEach(function (iv) {
      if (iv.end <= s || iv.start >= e) { out.push(iv); return; }
      var left = iv.start < s, right = iv.end > e;
      if (left && right) {
        out.push({ id: gen(), start: iv.start, end: s, kind: iv.kind, text: iv.text, float: iv.float });
        out.push({ id: gen(), start: e, end: iv.end, kind: iv.kind, text: iv.text, float: iv.float });
      } else if (left) {
        out.push({ id: iv.id, start: iv.start, end: s, kind: iv.kind, text: iv.text, float: iv.float });
      } else if (right) {
        out.push({ id: iv.id, start: e, end: iv.end, kind: iv.kind, text: iv.text, float: iv.float });
      }
    });
    return out;
  }

  function checkSpan(doc, s, e) {
    if (s % SLOT !== 0 || e % SLOT !== 0) return '选区的端点不是整点或半点';
    if (!(s < e)) return '选区为空';
    if (s < doc.range.start || e > doc.range.end) return '选区 ' + fmtSpan(s, e) + ' 超出显示范围';
    return null;
  }
  function checkKeys(keys) {
    if (!keys.length) return '没有选中任何行';
    for (var i = 0; i < keys.length; i++) if (!isKey(keys[i])) return '行无效';
    return null;
  }

  /**
   * 写入类操作的通用形式：对 keys 中每一行，先清除 [s, e)，再放入 fill(key, k) 返回的区间
   * （[{start, end, kind, text, float}]，绝对时刻，可以为空）。
   */
  function writeCells(doc, keys, s, e, fill, gen) {
    var err = checkKeys(keys) || checkSpan(doc, s, e);
    if (err) return fail(doc, err);
    return editRows(doc, keys, function (list, key, map, k) {
      var row = clearSpan(list, s, e, gen);
      (fill ? fill(key, k) : []).forEach(function (a) {
        row.push({ id: gen(), start: a.start, end: a.end, kind: a.kind, text: a.text || '', float: !!a.float });
      });
      return row;
    }, gen);
  }

  /** E / S：在每一行创建覆盖 [s, e) 的区间；res.refs 指向各行中这个区间 */
  function createIntervals(doc, keys, s, e, kind, gen) {
    var res = writeCells(doc, keys, s, e, function () { return [{ start: s, end: e, kind: kind, text: '', float: false }]; }, gen);
    if (res.ok) {
      res.refs = keys.map(function (key) {
        var iv = intervalAt(res.doc, key, s);
        return { key: key, id: iv.id };
      });
    }
    return res;
  }

  /** Delete：清除格选区 */
  function clearCells(doc, keys, s, e, gen) {
    return writeCells(doc, keys, s, e, null, gen);
  }

  /* ---------- 区间属性 ---------- */

  function setKind(doc, refs, kind, gen) {
    return editRefs(doc, refs, function (list, set) {
      return list.map(function (iv) { return set[iv.id] ? { id: iv.id, start: iv.start, end: iv.end, kind: kind, text: iv.text, float: iv.float } : iv; });
    }, gen);
  }

  /** F：全部为 true 时设为 false，否则全部设为 true */
  function toggleFloat(doc, refs, gen) {
    var err = checkRefs(doc, refs);
    if (err) return fail(doc, err);
    var val = !refs.every(function (r) { return findInRow(doc, r.key, r.id).float; });
    var res = editRefs(doc, refs, function (list, set) {
      return list.map(function (iv) { return set[iv.id] ? { id: iv.id, start: iv.start, end: iv.end, kind: iv.kind, text: floatText(iv.text, val), float: val } : iv; });
    }, gen);
    res.value = val;
    return res;
  }

  function setText(doc, refs, text, gen) {
    text = String(text).trim();
    var err = validateText(text);
    if (err) return fail(doc, err);
    return editRefs(doc, refs, function (list, set) {
      return list.map(function (iv) { return set[iv.id] ? { id: iv.id, start: iv.start, end: iv.end, kind: iv.kind, text: floatText(text, iv.float), float: iv.float } : iv; });
    }, gen);
  }

  function deleteIntervals(doc, refs, gen) {
    var res = editRefs(doc, refs, function (list, set) {
      return list.filter(function (iv) { return !set[iv.id]; });
    }, gen);
    if (res.ok) res.count = refs.length;
    return res;
  }

  /* ---------- 移动类操作（FR-4.5 拒绝处理） ---------- */

  /** 在一行（已排序）中找第一个重叠；movedSet 中的区间作为主语 */
  function findOverlap(row, key, movedSet) {
    for (var i = 0; i < row.length; i++) {
      for (var j = i + 1; j < row.length && row[j].start < row[i].end; j++) {
        var a = row[i], b = row[j];
        var subj = movedSet[b.id] && !movedSet[a.id] ? b : a;
        var other = subj === a ? b : a;
        return loc(key, subj.start, subj.end) + ' 与 ' + fmtSpan(other.start, other.end) + ' 冲突';
      }
    }
    return null;
  }

  /**
   * 平移（dStart = dEnd）、调整结束端点（dStart = 0）、调整开始端点（dEnd = 0）。
   * 作用于每个所选区间；任一冲突则整体不生效（FR-6.11）。
   */
  function shiftIntervals(doc, refs, dStart, dEnd, gen) {
    var range = doc.range;
    return editRefs(doc, refs, function (list, set, key) {
      var err = null;
      var out = list.map(function (iv) {
        if (!set[iv.id]) return iv;
        var s = iv.start + dStart, e = iv.end + dEnd;
        if (!err) {
          if (e - s < SLOT) err = loc(key, iv.start, iv.end) + ' 的长度不能小于 1 格';
          else if (s < range.start || e > range.end) err = loc(key, s, e) + ' 超出显示范围 ' + fmtSpan(range.start, range.end);
        }
        return { id: iv.id, start: s, end: e, kind: iv.kind, text: iv.text, float: iv.float };
      });
      return err || findOverlap(sortRow(out), key, set) || out;
    }, gen);
  }

  /** Alt + ↑ ↓：把所选区间移到 order（当前页可编辑行的键序列）中相邻行的同一时间段 */
  function moveIntervalsRow(doc, refs, order, dRow, gen) {
    var err = checkRefs(doc, refs);
    if (err) return fail(doc, err);
    var g = groupRefs(refs);
    var target = {};
    for (var i = 0; i < g.keys.length; i++) {
      var idx = order.indexOf(g.keys[i]);
      if (idx < 0) return fail(doc, '所选区间不在当前页');
      var t = idx + dRow;
      if (t < 0) return fail(doc, '已在最上面一行（' + rowName(order[0]) + '），无法再上移');
      if (t >= order.length) return fail(doc, '已在最后一行（' + rowName(order[order.length - 1]) + '），无法再下移');
      target[g.keys[i]] = order[t];
    }
    // 涉及的行：来源与目标
    var involved = g.keys.slice();
    g.keys.forEach(function (k) { if (involved.indexOf(target[k]) < 0) involved.push(target[k]); });
    var lists = {}, maps = {};
    involved.forEach(function (k) { var o = ownCopy(doc, k, gen); lists[k] = o.list; if (o.map) maps[k] = o.map; });
    var moving = [], movedSet = Object.create(null);
    g.keys.forEach(function (k) {
      var set = mapIds(g.ids[k], maps[k]);
      lists[k] = lists[k].filter(function (iv) {
        if (!set[iv.id]) return true;
        moving.push({ iv: iv, to: target[k] });
        movedSet[iv.id] = true;
        return false;
      });
    });
    moving.forEach(function (m) { lists[m.to].push(m.iv); });
    var objs = Object.assign({}, doc.objs);
    for (var j = 0; j < involved.length; j++) {
      var k = involved[j];
      var row = sortRow(lists[k]);
      var ov = findOverlap(row, k, movedSet);
      if (ov) return fail(doc, ov);
      if (!sameContent(eff(doc, k), row)) objs[k] = editedObj(doc, k, row);
    }
    var res = finish(doc, withObjs(doc, objs));
    if (res.ok) res.refs = moving.map(function (m) { return { key: m.to, id: m.iv.id }; });
    return res;
  }

  /* ---------- 复制与粘贴（6.4 节） ---------- */

  /** 复制矩形：keys × [s, e)，区间截取到时间段内，以相对偏移记录 */
  function copyRect(doc, keys, s, e) {
    return {
      width: e - s,
      srcKeys: keys.slice(),
      srcStart: s,
      rows: keys.map(function (key) {
        var out = [];
        eff(doc, key).forEach(function (iv) {
          if (iv.end <= s || iv.start >= e) return;
          out.push({ start: Math.max(iv.start, s) - s, end: Math.min(iv.end, e) - s, kind: iv.kind, text: iv.text, float: iv.float });
        });
        return out;
      })
    };
  }

  /** 复制区间选区：行集合为所选区间所在的行（按 order 排序），时间段为最早开始到最晚结束 */
  function copyIntervals(doc, refs, order) {
    var keys = [], s = Infinity, e = -Infinity;
    refs.forEach(function (r) {
      var iv = findInRow(doc, r.key, r.id);
      if (!iv) return;
      if (keys.indexOf(r.key) < 0) keys.push(r.key);
      s = Math.min(s, iv.start);
      e = Math.max(e, iv.end);
    });
    if (!keys.length) return null;
    keys.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    return copyRect(doc, keys, s, e);
  }

  /** 粘贴到 order 中从 anchorIdx 开始的若干行（FR-6.15 至 FR-6.17） */
  function pasteRect(doc, clip, order, anchorIdx, anchorStart, gen) {
    var h = clip.rows.length;
    if (anchorIdx + h > order.length) {
      return fail(doc, '粘贴的内容有 ' + h + ' 行，从' + rowName(order[anchorIdx]) + '开始会超出最后一行（' + rowName(order[order.length - 1]) + '）');
    }
    var s = anchorStart, e = anchorStart + clip.width;
    if (s < doc.range.start || e > doc.range.end) {
      return fail(doc, '粘贴的内容为 ' + fmtSpan(s, e) + '，超出显示范围 ' + fmtSpan(doc.range.start, doc.range.end));
    }
    var keys = order.slice(anchorIdx, anchorIdx + h);
    var res = writeCells(doc, keys, s, e, function (key, k) {
      return clip.rows[k].map(function (c) {
        return { start: s + c.start, end: s + c.end, kind: c.kind, text: c.text, float: c.float };
      });
    }, gen);
    if (res.ok) { res.keys = keys; res.start = s; res.end = e; }
    return res;
  }

  function intervalLine(iv) {
    var line = fmtSpanMd(iv.start, iv.end);
    var part = iv.kind === 'external' ? '[' + iv.text + ']' : iv.kind === 'daily' ? '(' + iv.text + ')' : iv.text;
    if (iv.float) return line + ' ~' + (part || FLOAT_WORD);   // 浮动：文字写在“~”后面（7.1 节）
    return part ? line + ' ' + part : line;
  }

  /** FR-6.18：复制内容的区间行文本（按原位置的绝对时刻） */
  function clipToText(clip) {
    var multi = clip.rows.length > 1;
    var out = [];
    clip.rows.forEach(function (list, k) {
      if (multi) out.push('## ' + mdHeading(clip.srcKeys[k]));
      list.forEach(function (c) {
        out.push(intervalLine({ start: clip.srcStart + c.start, end: clip.srcStart + c.end, kind: c.kind, text: c.text, float: c.float }));
      });
      if (multi && k < clip.rows.length - 1) out.push('');
    });
    return out.join('\n') + '\n';
  }

  /* ---------- 行操作 ---------- */

  /** FR-4.12：恢复跟随 */
  function resetRow(doc, key) {
    if (key === BASE) return fail(doc, '唯一模板没有上级，不能重置为模板');
    if (isFollow(doc, key)) return fail(doc, rowName(key) + ' 已经在跟随模板');
    var objs = Object.assign({}, doc.objs);
    if (keyType(key) === 'weekly') objs[key] = FOLLOW;
    else delete objs[key];
    return finish(doc, withObjs(doc, objs));
  }

  /** 清空此行：变为已编辑且没有区间 */
  function clearRow(doc, key) {
    var o = getObj(doc, key);
    if (!o.follow && !o.intervals.length) return fail(doc, rowName(key) + ' 已经是空行');
    var objs = Object.assign({}, doc.objs);
    objs[key] = editedObj(doc, key, []);          // 时刻事件保留（FR-6.19）
    return finish(doc, withObjs(doc, objs));
  }

  /* ---------- 文档设置、标题、笔记 ---------- */

  /**
   * 修改显示范围、一周起始日、起始日（FR-4.10、FR-4.15、FR-4.16），三项一起校验、一起生效。
   * s 中缺少的项保持原值。today 为当前日期。
   */
  function setSettings(doc, s, today) {
    var range = s.range || doc.range;
    var weekStart = s.weekStart != null ? s.weekStart : doc.weekStart;
    var startDate = s.startDate || doc.startDate;
    var err = validateRange(range.start, range.end) || validateWeekStart(weekStart);
    if (err) return fail(doc, err);
    if (!isDate(startDate)) return fail(doc, '起始日 ' + startDate + ' 不是有效的日期');
    var last = loadEnd(today, weekStart);
    if (dayNum(startDate) > dayNum(last)) return fail(doc, '起始日不能晚于加载范围的最后一天（' + last + '）');
    var outside = [];
    Object.keys(doc.objs).forEach(function (key) {
      var o = doc.objs[key];
      if (o.follow) return;
      o.intervals.forEach(function (iv) { if (iv.start < range.start || iv.end > range.end) outside.push(loc(key, iv.start, iv.end)); });
      (o.events || []).forEach(function (e) { if (e.t < range.start || e.t > range.end) outside.push(rowName(key) + ' ' + fmtTime(e.t) + ' ' + e.text); });
    });
    if (outside.length) {
      var res = fail(doc, '有 ' + outside.length + ' 个区间或时刻事件会落在新范围 ' + fmtSpan(range.start, range.end) + ' 之外：' + outside.join('、'));
      res.outside = outside;
      return res;
    }
    if (range.start === doc.range.start && range.end === doc.range.end && weekStart === doc.weekStart && startDate === doc.startDate) {
      return ok(doc, { unchanged: true });
    }
    return finish(doc, { title: doc.title, range: { start: range.start, end: range.end }, weekStart: weekStart, startDate: startDate, objs: doc.objs, note: doc.note });
  }

  function setTitle(doc, title) {
    title = String(title).trim();
    var err = validateTitle(title);
    if (err) return fail(doc, err);
    if (title === doc.title) return ok(doc, { unchanged: true });
    return ok({ title: title, range: doc.range, weekStart: doc.weekStart, startDate: doc.startDate, objs: doc.objs, note: doc.note });
  }

  /* ---------- 规范文本（7.3 节） ---------- */

  /** 去除首尾的空行（FR-7.2） */
  function normalizeNote(note) {
    var lines = String(note).replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && lines[0].trim() === '') lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.join('\n');
  }

  function serialize(doc) {
    var out = ['# ' + doc.title, '范围 ' + fmtSpanMd(doc.range.start, doc.range.end), '一周起始 ' + WEEK_NAMES[doc.weekStart], '起始日 ' + doc.startDate, ''];
    function section(key) {
      out.push('## ' + mdHeading(key));
      // 区间行与事件行按时刻混排，同一时刻事件行在前（FR-7.7）
      var o = doc.objs[key], lines = [];
      o.intervals.forEach(function (iv) { lines.push([iv.start, 1, 0, intervalLine(iv)]); });
      (o.events || []).forEach(function (e, i) { lines.push([e.t, 0, i, fmtTime(e.t) + ' ' + e.text]); });
      lines.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; });
      lines.forEach(function (l) { out.push(l[3]); });
      out.push('');
    }
    section(BASE);
    weeklyOrder(doc.weekStart).forEach(function (w) {
      if (!doc.objs[weeklyKey(w)].follow) section(weeklyKey(w));
    });
    Object.keys(doc.objs).filter(function (k) { return keyType(k) === 'day' && !doc.objs[k].follow; }).sort().forEach(section);
    out.push('## 笔记');
    var note = normalizeNote(doc.note);
    if (note) out.push(note);
    return out.join('\n') + '\n';
  }

  /* ---------- 解析（7.2 节） ---------- */

  var TIME_RE = '(\\d{1,2}):(\\d{2})';
  var DASH_RE = '\\s*[-–—]\\s*';
  var RANGE_LINE_RE = new RegExp('^范围\\s*' + TIME_RE + DASH_RE + TIME_RE + '$');
  var INTERVAL_LINE_RE = new RegExp('^' + TIME_RE + DASH_RE + TIME_RE + '(.*)$');

  /** 解析时刻，返回 {value} 或 {error} */
  function parseTimeParts(hs, ms) {
    var h = parseInt(hs, 10), m = parseInt(ms, 10);
    var shown = hs + ':' + ms;
    if (h > 24) return { error: '时刻 ' + shown + ' 超出 0:00–24:00' };
    if (m !== 0 && m !== 30) return { error: shown + ' 不是整点或半点，分钟只能为 00 或 30' };
    if (h === 24 && m !== 0) return { error: '24 点只能写作 24:00' };
    return { value: h * 60 + m };
  }

  function parseIntervalLine(t) {
    var m = INTERVAL_LINE_RE.exec(t);
    if (!m) return { error: '无法识别“' + t + '”，区间行应写作“08:00-12:00 文字”，时刻事件写作“07:00 起床”' };
    var a = parseTimeParts(m[1], m[2]), b = parseTimeParts(m[3], m[4]);
    if (a.error || b.error) return { error: [a.error, b.error].filter(Boolean).join('；') };
    var rest = m[5];
    // 浮动：“~”（或全角“～”）后面是它的文字，前面的空格可以省略（7.1 节、FR-7.3）
    var float = false, tilde = rest.search(/[~～]/);
    if (tilde >= 0) {
      float = true;
      var before = rest.slice(0, tilde).trim(), after = rest.slice(tilde + 1).trim();
      if (!before) rest = after;
      else if (after === FLOAT_WORD && /^\s/.test(rest)) rest = before;   // 修订前的写法“文字部分 ~浮动”（FR-7.19）
      else return { error: '浮动区间的文字要写在“~”后面，应写作“' + fmtSpanMd(a.value, b.value) + ' ~' + before + '”' };
    } else {
      if (rest && !/^\s/.test(rest)) return { error: '时刻与文字之间需要一个空格' };
      rest = rest.trim();
    }
    var kind = 'self', text = rest;
    if (rest.charAt(0) === '[') {
      if (rest.length < 2 || rest.charAt(rest.length - 1) !== ']') return { error: '方括号没有闭合：“' + rest + '”' };
      kind = 'external';
      text = rest.slice(1, -1).trim();
    } else if (PAREN_RE.test(rest)) {       // “(文字)”，全角括号也认（FR-7.3）
      kind = 'daily';
      text = rest.slice(1, -1).trim();
    }
    var te = validateText(text);
    if (te) return { error: te };
    if (!(a.value < b.value)) return { error: fmtSpanMd(a.value, b.value) + ' 的结束时刻必须晚于开始时刻' };
    return { start: a.value, end: b.value, kind: kind, text: floatText(text, float), float: float };
  }

  var EVENT_LINE_RE = new RegExp('^' + TIME_RE + '(?:\\s+(.*))?$');
  /** 事件行“07:00 起床”（7.1 节）：不是事件行时返回 null；否则返回 {t, text} 或 {error} */
  function parseEventLine(t) {
    if (INTERVAL_LINE_RE.test(t)) return null;
    var m = EVENT_LINE_RE.exec(t);
    if (!m) return null;
    var a = parseTimeParts(m[1], m[2]);
    if (a.error) return { error: a.error };
    var text = (m[3] || '').trim();
    if (!text) return { error: '时刻事件要写文字，例如“' + fmtTime(a.value) + ' 起床”' };
    var te = validateText(text);
    if (te) return { error: te };
    return { t: a.value, text: text };
  }

  /** 小节头 → {key, phase, name}；phase：1 唯一模板、2 周模板、3 具体日子、4 笔记 */
  function classifyHeading(name) {
    if (name === '唯一模板' || name === '模板') return { key: BASE, phase: 1 };   // “模板”为修订前的写法（FR-7.19）
    var w = WEEK_NAMES.indexOf(name);
    if (w >= 0) return { key: weeklyKey(w), phase: 2 };
    if (name === '笔记') return { key: null, phase: 4 };
    var m = /^(\d{4}-\d{2}-\d{2})(?:\s+(\S+))?$/.exec(name);
    if (m) {
      if (!isDate(m[1])) return { error: m[1] + ' 不是有效的日期' };
      var real = WEEK_NAMES[weekdayOf(m[1])];
      if (!m[2]) return { error: '日子小节应写作“## ' + m[1] + ' ' + real + '”，缺少星期' };
      if (m[2] !== real) return { error: m[1] + ' 是' + real + '，不是' + m[2] };
      return { key: dayKey(m[1]), phase: 3 };
    }
    return { error: '无法识别的小节“## ' + name + '”，小节只能是“## 唯一模板”、星期（如“## 周一”）、日期（如“## 2026-09-29 周二”）或“## 笔记”' };
  }
  var PHASE_NAMES = ['', '唯一模板', '周模板', '具体日子', '笔记'];

  /**
   * 解析 md 文本。返回 {ok, doc, errors}；errors 为带行号的中文说明，按行号排序。
   * 有任何错误时 ok 为 false、doc 为 null（FR-7.6）。today 用于起始日的默认值与上限检查。
   */
  function parse(text, gen, today) {
    gen = gen || makeIdGen('p');
    var errors = [];
    function err(ln, msg) { errors.push({ line: ln, msg: '第 ' + ln + ' 行：' + msg }); }

    var lines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    var total = lines.length;
    var i = 0;
    function skipBlank() { while (i < total && lines[i].trim() === '') i++; }

    // 标题行
    skipBlank();
    var title = null;
    if (i >= total) {
      err(1, '文件为空，缺少标题行（例如“# 本周时间安排”）');
    } else {
      var tl = lines[i].trim();
      if (/^#(?!#)/.test(tl)) {
        title = tl.replace(/^#\s*/, '');
        var tErr = validateTitle(title);
        if (tErr) err(i + 1, tErr);
        i++;
      } else {
        err(i + 1, '第一行应为标题行，例如“# 本周时间安排”');
        if (!/^(范围|一周起始|起始日)/.test(tl) && !/^##/.test(tl)) i++;
      }
    }

    // 设置行（FR-7.3：先后不限）
    var range = null, weekStart = null, startDate = null, seenSet = {}, rangeLine = 0;
    for (;;) {
      skipBlank();
      if (i >= total) break;
      var sl = lines[i].trim();
      var which = /^范围/.test(sl) ? 'range' : /^一周起始/.test(sl) ? 'week' : /^起始日/.test(sl) ? 'start' : null;
      if (!which) break;
      if (seenSet[which]) err(i + 1, '设置行重复，已在第 ' + seenSet[which] + ' 行出现过');
      seenSet[which] = i + 1;
      if (which === 'range') {
        rangeLine = i + 1;
        var rm = RANGE_LINE_RE.exec(sl);
        if (!rm) err(i + 1, '范围行应写作“范围 07:00-22:30”');
        else {
          var rs = parseTimeParts(rm[1], rm[2]), re = parseTimeParts(rm[3], rm[4]);
          if (rs.error || re.error) err(i + 1, [rs.error, re.error].filter(Boolean).join('；'));
          else {
            var rErr = validateRange(rs.value, re.value);
            if (rErr) err(i + 1, rErr); else range = { start: rs.value, end: re.value };
          }
        }
      } else if (which === 'week') {
        var wm = /^一周起始\s*(\S+)$/.exec(sl);
        var wi = wm ? WEEK_NAMES.indexOf(wm[1]) : -1;
        if (wi < 0) err(i + 1, '一周起始行应写作“一周起始 周日”（周日至周六之一）'); else weekStart = wi;
      } else {
        var dm = /^起始日\s*(\S+)$/.exec(sl);
        if (!dm || !isDate(dm[1])) err(i + 1, '起始日行应写作“起始日 2026-09-20”，且为有效日期'); else startDate = dm[1];
      }
      i++;
    }
    if (!seenSet.range) err(Math.min(i + 1, total), '缺少范围行，例如“范围 07:00-22:30”');
    if (!seenSet.week) weekStart = 0;                                   // FR-7.19
    if (!seenSet.start) {
      if (today) startDate = weekFirst(today, weekStart == null ? 0 : weekStart);
      else err(Math.min(i + 1, total), '缺少起始日行，例如“起始日 2026-09-20”');
    }

    // 小节
    var seen = {};           // 行键 → 行号
    var lastPhase = 0;
    var cur = null;          // 当前行键；'?' 表示忽略（小节头有误）
    var items = {};          // 行键 → [{start, end, kind, text, float, line}]
    var evs = {};            // 行键 → [{t, text, line}]
    var note = '', noteSeen = false, baseSeen = false;

    for (; i < total; i++) {
      var t = lines[i].trim();
      if (t === '') continue;
      if (t.charAt(0) === '#') {
        var hm = /^##\s*(.+)$/.exec(t);
        var h = hm ? classifyHeading(hm[1].trim()) : { error: '无法识别的行“' + t + '”，小节头应以“## ”开头' };
        if (h.error) { err(i + 1, h.error); cur = '?'; continue; }
        var label = h.key ? mdHeading(h.key) : '笔记';
        if (h.key && seen[h.key] != null) { err(i + 1, '小节“' + label + '”重复，已在第 ' + seen[h.key] + ' 行出现过'); cur = '?'; continue; }
        if (h.phase < lastPhase) err(i + 1, '小节“' + label + '”的位置不对：小节的顺序应为唯一模板、周模板、具体日子、笔记，它应在' + PHASE_NAMES[lastPhase] + '之前');
        lastPhase = Math.max(lastPhase, h.phase);
        if (h.phase === 4) {
          noteSeen = true;
          note = normalizeNote(lines.slice(i + 1).join('\n'));
          break;
        }
        if (h.key === BASE) baseSeen = true;
        seen[h.key] = i + 1;
        items[h.key] = [];
        evs[h.key] = [];
        cur = h.key;
        continue;
      }
      if (cur === '?') continue;
      if (cur === null) { err(i + 1, '“' + t + '”不在任何小节之下，区间行应写在“## 唯一模板”“## 周一”等小节之下'); continue; }
      var ev = parseEventLine(t);
      if (ev) {
        if (ev.error) { err(i + 1, ev.error); continue; }
        if (range && (ev.t < range.start || ev.t > range.end)) { err(i + 1, fmtTime(ev.t) + ' 超出显示范围 ' + fmtSpanMd(range.start, range.end)); continue; }
        ev.line = i + 1;
        evs[cur].push(ev);
        continue;
      }
      var p = parseIntervalLine(t);
      if (p.error) { err(i + 1, p.error); continue; }
      if (range && (p.start < range.start || p.end > range.end)) {
        err(i + 1, fmtSpanMd(p.start, p.end) + ' 超出显示范围 ' + fmtSpanMd(range.start, range.end));
        continue;
      }
      p.line = i + 1;
      items[cur].push(p);
    }
    if (!baseSeen) err(total, '缺少小节“## 唯一模板”');
    if (!noteSeen) err(total, '缺少小节“## 笔记”（必须是最后一节）');

    // 重叠（I-3）
    Object.keys(items).forEach(function (key) {
      var sorted = items[key].slice().sort(function (a, b) { return a.start - b.start || a.line - b.line; });
      var prev = null;
      sorted.forEach(function (it) {
        if (prev && it.start < prev.end) {
          var later = it.line > prev.line ? it : prev;
          var earlier = later === it ? prev : it;
          err(later.line, fmtSpanMd(later.start, later.end) + ' 与第 ' + earlier.line + ' 行的 ' + fmtSpanMd(earlier.start, earlier.end) + ' 重叠');
        }
        if (!prev || it.end > prev.end) prev = it;
      });
    });

    // 起床、就寝：每节至多各一个（3.5 节）；是否早于就寝在构建文档后按有效值检查
    var roleLine = {};       // 行键 → {wake: 行号, sleep: 行号}
    Object.keys(evs).forEach(function (key) {
      var first = roleLine[key] = {};
      evs[key].forEach(function (e) {
        var role = eventRole(e.text);
        if (!role) return;
        if (first[role]) err(e.line, '一节中只能有一个' + (role === 'wake' ? '起床' : '就寝') + '时刻，已在第 ' + first[role] + ' 行出现过');
        else first[role] = e.line;
      });
    });

    // 起始日不得晚于加载范围的最后一天
    if (today && startDate && weekStart != null) {
      var last = loadEnd(today, weekStart);
      if (dayNum(startDate) > dayNum(last)) err(seenSet.start || 1, '起始日 ' + startDate + ' 晚于加载范围的最后一天（' + last + '）');
    }

    errors.sort(function (a, b) { return a.line - b.line; });
    if (errors.length) return { ok: false, doc: null, errors: errors.map(function (e) { return e.msg; }) };

    var objs = {};
    for (var w = 0; w < 7; w++) objs[weeklyKey(w)] = FOLLOW;
    Object.keys(items).forEach(function (key) {
      objs[key] = { follow: false, intervals: sortRow(items[key].map(function (q) { return mkInterval(gen, q.start, q.end, q.kind, q.text, q.float); })),
        events: sortEvents(evs[key]).map(function (e) { return { t: e.t, text: e.text }; }) };
    });
    var doc = { title: title, range: range, weekStart: weekStart, startDate: startDate, objs: objs, note: note };
    // 起床早于就寝，按每行的有效值（3.5 节）；错误报在本节写的那一行上
    Object.keys(objs).forEach(function (key) {
      if (objs[key].follow) return;
      var msg = checkWakeSleep(doc, key);
      if (!msg) return;
      var ws = effWakeSleep(doc, key), rl = roleLine[key] || {};
      err((ws.wake.from === key ? rl.wake : rl.sleep) || seen[key] || 1, msg);
    });
    if (errors.length) {
      errors.sort(function (a, b) { return a.line - b.line; });
      return { ok: false, doc: null, errors: errors.map(function (e) { return e.msg; }) };
    }
    var vErr = validateDoc(doc);
    if (vErr) return { ok: false, doc: null, errors: [vErr] };
    return { ok: true, doc: doc, errors: [] };
  }

  /** 忽略 id 比较两份计划文档（FR-7.8） */
  function docEquals(a, b) { return serialize(a) === serialize(b); }

  var Core = {
    effEvents: effEvents, eventRole: eventRole, wakeSleep: wakeSleep, effWakeSleep: effWakeSleep, rowEvents: rowEvents,
    SLOT: SLOT, BASE: BASE, WEEK_NAMES: WEEK_NAMES, KIND_LABEL: KIND_LABEL,
    DEFAULT_TITLE: DEFAULT_TITLE, DEFAULT_RANGE: DEFAULT_RANGE,
    pad2: pad2, fmtTime: fmtTime, fmtTimeShort: fmtTimeShort, fmtSpan: fmtSpan, fmtSpanMd: fmtSpanMd, fmtDur: fmtDur,
    isDate: isDate, dayNum: dayNum, fromDayNum: fromDayNum, addDays: addDays, weekdayOf: weekdayOf, weekFirst: weekFirst,
    loadEnd: loadEnd, listDays: listDays, fmtDateMd: fmtDateMd, fmtDateCn: fmtDateCn,
    weeklyKey: weeklyKey, dayKey: dayKey, keyType: keyType, keyDate: keyDate, keyWeekday: keyWeekday, isKey: isKey,
    parentKey: parentKey, rowName: rowName, mdHeading: mdHeading, weeklyOrder: weeklyOrder,
    makeIdGen: makeIdGen, makeDoc: makeDoc, mkInterval: mkInterval,
    getObj: getObj, isFollow: isFollow, eff: eff, findInRow: findInRow, intervalAt: intervalAt,
    describeInterval: describeInterval, describeCells: describeCells,
    validateText: validateText, validateTitle: validateTitle, validateRange: validateRange, validateDoc: validateDoc,
    writeCells: writeCells, createIntervals: createIntervals, clearCells: clearCells,
    setKind: setKind, toggleFloat: toggleFloat, setText: setText, deleteIntervals: deleteIntervals,
    shiftIntervals: shiftIntervals, moveIntervalsRow: moveIntervalsRow,
    copyRect: copyRect, copyIntervals: copyIntervals, pasteRect: pasteRect, clipToText: clipToText, intervalLine: intervalLine,
    resetRow: resetRow, clearRow: clearRow, setSettings: setSettings, setTitle: setTitle,
    normalizeNote: normalizeNote, serialize: serialize, parse: parse, parseIntervalLine: parseIntervalLine, docEquals: docEquals
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.WeekCore = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
