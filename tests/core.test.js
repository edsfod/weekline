/* 周时间轴 · 纯函数测试：覆盖需求第 4、7 节以及验收标准的数据部分 */
(function () {
  'use strict';
  var C = window.WeekCore;
  var results = [];

  function test(name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, msg: e && e.message ? e.message : String(e) }); }
  }
  function eq(a, b, what) {
    var sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) throw new Error((what || '值') + ' 不相等：\n  实际 ' + sa + '\n  期望 ' + sb);
  }
  function assert(c, what) { if (!c) throw new Error(what || '断言失败'); }
  function has(str, sub) { if (String(str).indexOf(sub) < 0) throw new Error('“' + str + '” 中没有 “' + sub + '”'); }

  var TODAY = '2026-09-25';   // 周五（验收标准的初始状态）

  var EXAMPLE = [
    '# 本周时间安排', '范围 07:00-22:30', '一周起始 周日', '起始日 2026-09-20', '',
    '## 唯一模板', '08:00-12:00', '14:00-17:00', '18:30-20:30 ~浮动', '',
    '## 周一', '08:00-12:30 [上课]', '14:00-17:00', '18:30-20:30 ~浮动', '',
    '## 周二', '08:00-12:00', '14:00-17:00', '18:30-21:00 [活动]', '21:00-22:30 家务', '',
    '## 周三', '08:00-11:00', '13:00-15:00 [上课]', '15:00-17:00', '18:30-20:30 ~浮动', '',
    '## 周四', '09:30-12:30 [上课]', '14:00-17:00', '18:30-21:00 [上课]', '21:00-22:30 家务', '',
    '## 周五', '09:30-12:30 [上课]', '12:30-13:30 外卖', '13:30-18:00 [上课]', '18:30-20:30 ~浮动', '',
    '## 笔记', '一天理论上应然的最高工作时长是 4+3+2=9 小时。', '早上的 4h 是最为关键和高质量的。', ''
  ].join('\n');

  /** 修订前的格式（FR-7.19） */
  var LEGACY = [
    '# 本周时间安排', '范围 07:00-22:30', '',
    '## 模板', '08:00-12:00', '14:00-17:00', '18:30-20:30 ~浮动', '',
    '## 周一', '08:00-12:30 [上课]', '', '## 周二', '', '## 周三', '', '## 周四', '', '## 周五', '', '## 周六', '', '## 周日', '08:00-12:00', '',
    '## 笔记', ''
  ].join('\n');

  var gen = C.makeIdGen('t');
  var W = C.weeklyKey, D = C.dayKey;
  /** 周日为一周起始时，模板页可编辑行的顺序 */
  var TPL_ORDER = ['B', 'W0', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6'];

  /** 验收初始状态：示例的唯一模板，七个周模板都跟随 */
  function initial() {
    var d = C.parse(EXAMPLE, gen, TODAY).doc;
    for (var w = 0; w < 7; w++) d = C.resetRow(d, W(w)).ok ? C.resetRow(d, W(w)).doc : d;
    return d;
  }
  function spans(doc, key) { return C.eff(doc, key).map(function (iv) { return C.fmtSpanMd(iv.start, iv.end); }); }
  function T(s) { var m = /^(\d+):(\d+)$/.exec(s); return +m[1] * 60 + +m[2]; }
  function ref(doc, key, i) { return { key: key, id: C.eff(doc, key)[i].id }; }

  /* ---------- 格式化与日期 ---------- */
  test('FR-4.6 时长格式', function () {
    eq(C.fmtDur(240), '4h'); eq(C.fmtDur(270), '4.5h'); eq(C.fmtDur(30), '0.5h'); eq(C.fmtDur(1440), '24h');
  });
  test('时刻格式 24 小时制', function () {
    eq(C.fmtTime(0), '00:00'); eq(C.fmtTime(1350), '22:30'); eq(C.fmtTime(1440), '24:00'); eq(C.fmtTimeShort(480), '8:00');
  });
  test('日期计算', function () {
    eq(C.weekdayOf('2026-09-25'), 5); eq(C.weekdayOf('2026-09-20'), 0); eq(C.weekdayOf('1970-01-01'), 4);
    eq(C.addDays('2026-12-31', 1), '2027-01-01'); eq(C.addDays('2028-03-01', -1), '2028-02-29');
    assert(C.isDate('2028-02-29') && !C.isDate('2026-02-29') && !C.isDate('2026-13-01') && !C.isDate('26-09-01'));
    eq(C.weekFirst(TODAY, 0), '2026-09-20'); eq(C.weekFirst(TODAY, 1), '2026-09-21'); eq(C.weekFirst('2026-09-20', 1), '2026-09-14');
    eq(C.fmtDateCn('2026-09-29'), '9月29日 周二');
  });
  test('FR-4.14 / AC-21 加载范围', function () {
    eq(C.loadEnd(TODAY, 0), '2026-10-03');
    eq(C.loadEnd(TODAY, 1), '2026-10-04');
    var d = initial();
    var days = C.listDays(d, TODAY);
    eq([days.length, days[0], days[13]], [14, '2026-09-20', '2026-10-03']);
    var d1 = C.setSettings(d, { weekStart: 1 }, TODAY).doc;
    eq(C.listDays(d1, TODAY).length, 15);
    eq(C.serialize(d1).split('\n')[2], '一周起始 周一');
  });
  test('FR-5.15 悬停描述与格选区描述', function () {
    var iv = { id: 'x', start: T('18:30'), end: T('21:00'), kind: 'external', text: '活动', float: true };
    eq(C.describeInterval(W(2), iv), '周二，18:30–21:00，2.5h，外部固定安排，活动，浮动');
    eq(C.describeInterval(D('2026-09-29'), iv).split('，')[0], '9月29日 周二');
    eq(C.describeCells([W(2), W(4)], T('18:30'), T('21:00')), '周二、周四，18:30–21:00，2.5h');
  });

  /* ---------- 文本 ---------- */
  test('AC-10 / FR-7.8 示例文本往返逐字相同', function () {
    var p = C.parse(EXAMPLE, gen, TODAY);
    assert(p.ok, '解析失败：' + p.errors.join('；'));
    eq(C.serialize(p.doc), EXAMPLE);
    assert(C.isFollow(p.doc, W(0)) && C.isFollow(p.doc, W(6)) && !C.isFollow(p.doc, W(1)), '周日、周六跟随，周一已编辑');
  });
  test('FR-7.19 / AC-25 兼容旧格式', function () {
    var p = C.parse(LEGACY, gen, TODAY);
    assert(p.ok, p.errors.join('；'));
    for (var w = 0; w < 7; w++) assert(!C.isFollow(p.doc, W(w)), C.WEEK_NAMES[w] + ' 应为已编辑');
    eq([p.doc.weekStart, p.doc.startDate], [0, '2026-09-20']);
    eq(spans(p.doc, W(2)), [], '周二已编辑且为空');
    var s = C.serialize(p.doc);
    has(s, '一周起始 周日\n起始日 2026-09-20\n\n## 唯一模板\n08:00-12:00');
    has(s, '## 周日\n08:00-12:00\n\n## 周一\n08:00-12:30 [上课]\n\n## 周二\n\n## 周三');
    assert(C.parse(s, gen, TODAY).ok, '新格式可以读回');
  });
  test('FR-7.3 宽松写法', function () {
    var txt = '﻿#  标题  \r\n\r\n起始日 2026-09-21\r\n范围 7:00 – 22:30\r\n一周起始 周一\r\n## 唯一模板\r\n  14:00 -17:00  \r\n8:00-12:00 [ 上课 ]\r\n\r\n## 周二\n## 2026-09-30 周三\n09:00-10:00\n## 2026-09-29 周二\n## 笔记\n\n\n# 不解析的行\n## 周一\n\n';
    var p = C.parse(txt, gen, TODAY);
    assert(p.ok, p.errors.join('；'));
    eq(p.doc.title, '标题');
    eq(spans(p.doc, 'B'), ['08:00-12:00', '14:00-17:00']);
    eq(C.eff(p.doc, 'B')[0].kind, 'external'); eq(C.eff(p.doc, 'B')[0].text, '上课');
    eq(p.doc.note, '# 不解析的行\n## 周一');
    assert(!C.isFollow(p.doc, D('2026-09-29')) && spans(p.doc, D('2026-09-29')).length === 0, '空的已编辑日子');
    eq(C.serialize(p.doc), '# 标题\n范围 07:00-22:30\n一周起始 周一\n起始日 2026-09-21\n\n## 唯一模板\n08:00-12:00 [上课]\n14:00-17:00\n\n## 周二\n\n## 2026-09-29 周二\n\n## 2026-09-30 周三\n09:00-10:00\n\n## 笔记\n# 不解析的行\n## 周一\n');
  });
  test('AC-11 / FR-7.5 收集全部错误并带行号', function () {
    var lines = EXAMPLE.split('\n');
    lines[6] = '08:15-12:00';          // 第 7 行
    lines[12] = '11:00-17:00';         // 第 13 行，与第 12 行 08:00-12:30 重叠
    var p = C.parse(lines.join('\n'), gen, TODAY);
    assert(!p.ok && p.doc === null, '应解析失败');
    eq(p.errors.length, 2, '错误数');
    has(p.errors[0], '第 7 行'); has(p.errors[0], '08:15');
    eq(p.errors[1], '第 13 行：11:00-17:00 与第 12 行的 08:00-12:30 重叠');
  });
  test('FR-7.1 小节的缺少、重复、顺序与日期错误', function () {
    var bad = EXAMPLE.replace('## 周三', '## 周二').replace('## 周五\n', '## 周六x\n')
      .replace('## 笔记', '## 2026-09-29 周三\n## 2026-02-30 周一\n## 2026-09-29\n## 2026-09-30 周三\n## 周六\n## 笔记');
    var p = C.parse(bad, gen, TODAY);
    assert(!p.ok);
    var all = p.errors.join('\n');
    has(all, '小节“周二”重复'); has(all, '无法识别的小节'); has(all, '2026-09-29 是周二，不是周三');
    has(all, '2026-02-30 不是有效的日期'); has(all, '缺少星期'); has(all, '位置不对');
    var p2 = C.parse(EXAMPLE.replace('## 唯一模板', '## 周六'), gen, TODAY);
    has(p2.errors.join('\n'), '缺少小节“## 唯一模板”');
    var p3 = C.parse(EXAMPLE.replace('## 笔记', '## 备注'), gen, TODAY);
    has(p3.errors.join('\n'), '缺少小节“## 笔记”');
  });
  test('设置行的错误', function () {
    var p = C.parse(EXAMPLE.replace('一周起始 周日', '一周起始 星期天').replace('起始日 2026-09-20', '起始日 2026-10-05'), gen, TODAY);
    assert(!p.ok);
    has(p.errors.join('\n'), '一周起始行应写作');
    var p2 = C.parse(EXAMPLE.replace('起始日 2026-09-20', '起始日 2026-10-05'), gen, TODAY);
    has(p2.errors.join('\n'), '晚于加载范围的最后一天');
    var p3 = C.parse(EXAMPLE.replace('范围 07:00-22:30\n', ''), gen, TODAY);
    has(p3.errors.join('\n'), '缺少范围行');
  });
  test('文字约束与时刻错误', function () {
    var bad = ['08:00-09:00 [a~b]', '08:00-09:00 [abc', '08:00-09:00 a[b', '09:00-08:00', '08:00-24:30', '08:00-25:00', '8:00-9:00x',
      '08:00-09:00 ' + new Array(42).join('字')];
    bad.forEach(function (l) {
      var p = C.parse(EXAMPLE.replace('## 周五\n09:30-12:30 [上课]', '## 周五\n' + l), gen, TODAY);
      assert(!p.ok, '应拒绝：' + l);
    });
    var p = C.parse(EXAMPLE.replace('范围 07:00-22:30', '范围 08:00-22:00'), gen, TODAY);
    has(p.errors.join('\n'), '超出显示范围');
  });
  test('浮动区间的文字写在“~”后面（7.1 节、FR-7.3、FR-7.19）', function () {
    var cases = [   // [写法, kind, text, 写出]
      ['08:00-09:00 ~浮动', 'self', '', '08:00-09:00 ~浮动'],
      ['08:00-09:00 ~', 'self', '', '08:00-09:00 ~浮动'],
      ['08:00-09:00~', 'self', '', '08:00-09:00 ~浮动'],
      ['08:00-09:00 ～ 浮动', 'self', '', '08:00-09:00 ~浮动'],
      ['08:00-09:00 ~待定', 'self', '待定', '08:00-09:00 ~待定'],
      ['08:00-09:00 ～ Voice', 'self', 'Voice', '08:00-09:00 ~Voice'],
      ['08:00-09:00 ~[上课]', 'external', '上课', '08:00-09:00 ~[上课]'],
      ['08:00-09:00 ~[]', 'external', '', '08:00-09:00 ~[]'],
      ['08:00-09:00 ~[浮动]', 'external', '', '08:00-09:00 ~[]'],
      ['08:00-09:00 读书 ~浮动', 'self', '读书', '08:00-09:00 ~读书'],          // 修订前的写法
      ['08:00-09:00 [上课] ~浮动', 'external', '上课', '08:00-09:00 ~[上课]'],
      ['08:00-09:00 浮动', 'self', '浮动', '08:00-09:00 浮动'],                 // 不浮动的区间可以叫“浮动”
      ['08:00-09:00 读书', 'self', '读书', '08:00-09:00 读书']
    ];
    cases.forEach(function (c) {
      var p = C.parse(EXAMPLE.replace('## 周五\n09:30-12:30 [上课]', '## 周五\n' + c[0]), gen, TODAY);
      assert(p.ok, '应接受：' + c[0] + ' ' + p.errors);
      var iv = p.doc.objs.W5.intervals[0];
      eq(iv.float, c[3].indexOf('~') >= 0, c[0]);
      eq(iv.kind, c[1], c[0]); eq(iv.text, c[2], c[0]);
      has(C.serialize(p.doc), '\n' + c[3] + '\n');
    });
    ['08:00-09:00 读书 ~晚上', '08:00-09:00 ~读~书', '08:00-09:00 ~[a'].forEach(function (l) {
      var p = C.parse(EXAMPLE.replace('## 周五\n09:30-12:30 [上课]', '## 周五\n' + l), gen, TODAY);
      assert(!p.ok, '应拒绝：' + l);
    });
    has(C.parse(EXAMPLE.replace('## 周五\n09:30-12:30 [上课]', '## 周五\n08:00-09:00 读书 ~晚上'), gen, TODAY).errors.join('\n'), '应写作“08:00-09:00 ~读书”');
    assert(C.validateText('a~b'), '文字不能含 ~');
    assert(C.validateText('a～b'), '文字不能含 ～');
    eq(C.validateText('上课'), null);
  });
  test('日常事务：圆括号写法（7.1 节、FR-7.3）', function () {
    var cases = [   // [写法, kind, text, float, 写出]
      ['09:00-10:00 (吃饭)', 'daily', '吃饭', false, '09:00-10:00 (吃饭)'],
      ['09:00-10:00 （吃饭）', 'daily', '吃饭', false, '09:00-10:00 (吃饭)'],
      ['09:00-10:00 ( 洗漱 )', 'daily', '洗漱', false, '09:00-10:00 (洗漱)'],
      ['09:00-10:00 ()', 'daily', '', false, '09:00-10:00 ()'],
      ['09:00-10:00 ~(吃饭)', 'daily', '吃饭', true, '09:00-10:00 ~(吃饭)'],
      ['09:00-10:00 ~()', 'daily', '', true, '09:00-10:00 ~()'],
      ['09:00-10:00 (吃饭) ~浮动', 'daily', '吃饭', true, '09:00-10:00 ~(吃饭)'],
      ['09:00-10:00 (复习)第3章', 'self', '(复习)第3章', false, '09:00-10:00 (复习)第3章'],
      ['09:00-10:00 复习(第3章)', 'self', '复习(第3章)', false, '09:00-10:00 复习(第3章)']
    ];
    cases.forEach(function (c) {
      var p = C.parse(EXAMPLE.replace('## 周五\n09:30-12:30 [上课]', '## 周五\n' + c[0]), gen, TODAY);
      assert(p.ok, '应接受：' + c[0] + ' ' + p.errors);
      var iv = p.doc.objs.W5.intervals.filter(function (x) { return x.start === 540; })[0];
      eq(iv.kind, c[1], c[0]); eq(iv.text, c[2], c[0]); eq(iv.float, c[3], c[0]);
      has(C.serialize(p.doc), '\n' + c[4] + '\n');
    });
    assert(!C.parse(EXAMPLE.replace('## 周五\n09:30-12:30 [上课]', '## 周五\n09:00-10:00 ((吃饭))'), gen, TODAY).ok, '括号里的文字不能再整段带括号');
    assert(C.validateText('(吃饭)'), '文字不能整段用括号括起来');
    assert(C.validateText('（吃饭）'), '全角同样');
    eq(C.validateText('(复习)第3章'), null);
    eq(C.KIND_LABEL.daily, '日常事务');
  });
  test('日常事务：创建与改类别', function () {
    var d = C.parse(EXAMPLE, gen, TODAY).doc;
    var r = C.createIntervals(d, ['W1'], 720, 780, 'daily', gen);
    assert(r.ok, r.error);
    var iv = C.findInRow(r.doc, 'W1', r.refs[0].id);
    eq(iv.kind, 'daily');
    has(C.serialize(r.doc), '12:00-13:00 ()');
    var r2 = C.setKind(r.doc, r.refs, 'external', gen);
    eq(C.findInRow(r2.doc, 'W1', r.refs[0].id).kind, 'external');
    eq(C.validateDoc(r.doc), null);
  });
  test('时刻事件：读写与混排（3.5 节、7.1 节、FR-7.7）', function () {
    var src = EXAMPLE.replace('## 唯一模板\n08:00-12:00\n', '## 唯一模板\n10:00 吃药\n7:00  起床\n08:00-12:00\n22:30 就寝\n10:00 喝水\n');
    var p = C.parse(src, gen, TODAY);
    assert(p.ok, p.errors && p.errors.join('；'));
    var evs = p.doc.objs.B.events;
    eq(evs.map(function (e) { return e.t + e.text; }).join(','), '420起床,600吃药,600喝水,1350就寝');
    has(C.serialize(p.doc), '## 唯一模板\n07:00 起床\n08:00-12:00\n10:00 吃药\n10:00 喝水\n14:00-17:00\n18:30-20:30 ~浮动\n22:30 就寝\n');
    var ws = C.wakeSleep(C.effEvents(p.doc, 'W6'));                       // 周六跟随唯一模板
    eq(ws.wake, 420); eq(ws.sleep, 1350);
    eq(C.eventRole('睡觉'), 'sleep'); eq(C.eventRole('吃药'), null);
    var p2 = C.parse(C.serialize(p.doc), gen, TODAY);
    eq(C.serialize(p2.doc), C.serialize(p.doc));
  });
  test('时刻事件：错误', function () {
    function errs(line) {
      var p = C.parse(EXAMPLE.replace('## 唯一模板\n', '## 唯一模板\n' + line + '\n'), gen, TODAY);
      assert(!p.ok, '应拒绝：' + line);
      return p.errors.join('\n');
    }
    has(errs('07:00'), '时刻事件要写文字');
    has(errs('07:15 起床'), '不是整点或半点');
    has(errs('06:00 起床'), '超出显示范围');
    has(errs('07:00 a[b'), '“[”');
    has(errs('07:00 起床\n07:30 起床'), '只能有一个起床时刻');
    has(errs('22:00 起床\n08:00 睡觉'), '必须早于就寝时刻');
    has(errs('8:00起床'), '时刻事件写作');
  });
  test('时刻事件随继承：第一次编辑时复制，清空此行保留，重置丢弃（FR-4.8、FR-4.12、FR-6.19）', function () {
    var d = C.parse(EXAMPLE.replace('## 唯一模板\n', '## 唯一模板\n07:00 起床\n22:30 睡觉\n10:00 吃药\n'), gen, TODAY).doc;
    var r = C.createIntervals(d, ['W6'], 480, 540, 'self', gen);
    assert(r.ok, r.error);
    eq(C.isFollow(r.doc, 'W6'), false);
    eq(r.doc.objs.W6.events.map(function (e) { return e.text; }).join(','), '吃药');   // 起床、就寝不复制
    has(C.serialize(r.doc), '## 周六\n08:00-09:00\n09:00-12:00\n10:00 吃药\n');
    eq(C.effWakeSleep(r.doc, 'W6').wake.from, 'B');
    var c = C.clearRow(r.doc, 'W6');
    eq(c.doc.objs.W6.intervals.length, 0); eq(c.doc.objs.W6.events.length, 1);
    var z = C.resetRow(c.doc, 'W6');
    eq(C.isFollow(z.doc, 'W6'), true); eq(C.rowEvents(z.doc, 'W6').length, 3);
    var r2 = C.createIntervals(d, ['B'], 480, 540, 'self', gen);           // 已编辑行保留自己的事件
    eq(r2.doc.objs.B.events.length, 3);
  });
  test('起床、就寝单独继承（3.5 节）', function () {
    // 示例中周一是已编辑的
    var d = C.parse(EXAMPLE.replace('## 唯一模板\n', '## 唯一模板\n07:00 起床\n22:00 睡觉\n10:00 吃药\n'), gen, TODAY).doc;
    eq(C.isFollow(d, 'W1'), false);
    var ws = C.effWakeSleep(d, 'W1');
    eq(ws.wake.t, 420); eq(ws.wake.from, 'B'); eq(ws.sleep.t, 1320);
    eq(C.rowEvents(d, 'W1').map(function (e) { return e.text; }).join(','), '起床,睡觉');   // 吃药不沿用
    var day = 'D2026-09-28';                                              // 跟随周一的具体日子
    eq(C.effWakeSleep(d, day).wake.from, 'B');
    var p = C.parse(C.serialize(d).replace('## 周一\n', '## 周一\n07:30 起床\n'), gen, TODAY);
    assert(p.ok, p.errors && p.errors.join('；'));
    ws = C.effWakeSleep(p.doc, 'W1');
    eq(ws.wake.t, 450); eq(ws.wake.from, 'W1'); eq(ws.sleep.from, 'B');
    eq(C.effWakeSleep(p.doc, day).wake.t, 450);
    eq(C.effWakeSleep(p.doc, 'W2').wake.t, 420);
    var bad = C.parse(C.serialize(d).replace('## 周一\n', '## 周一\n22:30 起床\n'), gen, TODAY);
    assert(!bad.ok);
    has(bad.errors.join('\n'), '周一 的起床时刻 22:30 必须早于就寝时刻 22:00（沿用唯一模板）');
  });
  test('FR-4.10：时刻事件落在新显示范围之外时不生效', function () {
    var d = C.parse(EXAMPLE.replace('## 唯一模板\n', '## 唯一模板\n22:30 睡觉\n'), gen, TODAY).doc;
    var r = C.setSettings(d, { range: { start: 420, end: 1320 } }, TODAY);
    assert(!r.ok); has(r.error, '22:30 睡觉');
  });
  test('浮动区间的文字为“浮动”时按空处理（3.3 节）', function () {
    var d = C.parse(EXAMPLE, gen, TODAY).doc;
    var iv = d.objs.B.intervals[2];        // 18:30-20:30 ~浮动
    eq(iv.float, true); eq(iv.text, '');
    var r = C.setText(d, [{ key: 'B', id: iv.id }], '浮动', gen);
    assert(r.ok); eq(C.findInRow(r.doc, 'B', iv.id).text, '');
    var r2 = C.setText(d, [{ key: 'B', id: iv.id }], '读书', gen);
    var r3 = C.toggleFloat(r2.doc, [{ key: 'B', id: iv.id }], gen);           // 取消浮动：文字保留
    eq(C.findInRow(r3.doc, 'B', iv.id).text, '读书');
    var r4 = C.setText(r3.doc, [{ key: 'B', id: iv.id }], '浮动', gen);       // 不浮动时可以叫“浮动”
    eq(C.findInRow(r4.doc, 'B', iv.id).text, '浮动');
    var r5 = C.toggleFloat(r4.doc, [{ key: 'B', id: iv.id }], gen);           // 设为浮动：“浮动”变为空
    eq(C.findInRow(r5.doc, 'B', iv.id).text, ''); eq(C.findInRow(r5.doc, 'B', iv.id).float, true);
  });
  test('FR-7.8 随机文档往返', function () {
    var rnd = 12345;
    function rand(n) { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd % n; }
    function randRow(range) {
      var t = range.start, row = [];
      for (;;) {
        t += rand(3) * 30;
        var len = (1 + rand(6)) * 30;
        if (t + len > range.end) break;
        var texts = ['', '上课', '家务 与 休息', 'a-b', '浮动'];
        row.push(C.mkInterval(gen, t, t + len, ['external', 'self', 'daily'][rand(3)], texts[rand(5)], !!rand(2)));
        t += len;
      }
      return row;
    }
    for (var k = 0; k < 120; k++) {
      var range = { start: 360 + rand(4) * 30, end: 1320 + rand(5) * 30 };
      var objs = { B: { follow: false, intervals: randRow(range) } };
      for (var w = 0; w < 7; w++) objs[W(w)] = rand(2) ? { follow: false, intervals: randRow(range) } : { follow: true, intervals: [] };
      for (var j = 0; j < rand(4); j++) objs[D(C.addDays('2026-09-01', rand(40)))] = { follow: false, intervals: randRow(range) };
      var d = C.makeDoc({ title: '随机 ' + k, range: range, weekStart: rand(7), startDate: C.addDays('2026-09-01', rand(20)),
        note: rand(2) ? '\n第一行\n  #第二行 ~浮动 [x]\n\n' : '', objs: objs });
      assert(!C.validateDoc(d), C.validateDoc(d));
      var s = C.serialize(d);
      var p = C.parse(s, gen, TODAY);
      assert(p.ok, '第 ' + k + ' 个：' + p.errors.join('；'));
      eq(C.serialize(p.doc), s, '往返 ' + k);
    }
  });

  /* ---------- 继承（4.4 节） ---------- */
  test('AC-1 修改唯一模板，跟随的周模板与日子随之改变', function () {
    var d = initial();
    var r = C.shiftIntervals(d, [ref(d, 'B', 1)], 0, 60, gen);
    assert(r.ok, r.error);
    for (var w = 0; w < 7; w++) eq(spans(r.doc, W(w))[1], '14:00-18:00', C.WEEK_NAMES[w]);
    C.listDays(r.doc, TODAY).forEach(function (day) { eq(spans(r.doc, D(day))[1], '14:00-18:00', day); });
    assert(C.isFollow(r.doc, W(3)), '仍为跟随');
  });
  test('AC-2 在跟随的周一写入：先复制再修改，其他行不变', function () {
    var d = initial();
    var r = C.createIntervals(d, [W(1)], T('08:00'), T('12:30'), 'external', gen);
    assert(r.ok, r.error);
    var r2 = C.setText(r.doc, r.refs, '上课', gen);
    assert(r2.ok, r2.error);
    assert(!C.isFollow(r2.doc, W(1)), '周一变为已编辑');
    eq(spans(r2.doc, W(1)), ['08:00-12:30', '14:00-17:00', '18:30-20:30']);
    var iv = C.eff(r2.doc, W(1))[0];
    eq([iv.kind, iv.text, C.fmtDur(iv.end - iv.start)], ['external', '上课', '4.5h']);
    assert(C.isFollow(r2.doc, W(2)) && r2.doc.objs.B === d.objs.B, '其他行不变');
    var ids = C.eff(r2.doc, W(1)).map(function (x) { return x.id; });
    C.eff(r2.doc, 'B').forEach(function (x) { assert(ids.indexOf(x.id) < 0, '副本使用新 id（I-5）'); });
  });
  test('AC-3 在跟随的周三清除中间的格', function () {
    var d = initial();
    var r = C.clearCells(d, [W(3)], T('10:00'), T('10:30'), gen);
    assert(r.ok, r.error);
    eq(spans(r.doc, W(3)).slice(0, 2), ['08:00-10:00', '10:30-12:00']);
    assert(!C.isFollow(r.doc, W(3)));
  });
  test('FR-4.8 内容不变的操作不改变跟随状态', function () {
    var d = initial();
    var r = C.clearCells(d, [W(3)], T('12:00'), T('13:00'), gen);
    assert(r.ok && r.doc === d && C.isFollow(r.doc, W(3)), '空白处清除不脱离跟随');
    var r2 = C.createIntervals(d, [W(3)], T('08:00'), T('12:00'), 'self', gen);
    assert(r2.doc === d, '写入与原有完全相同的区间也不算改变');
    eq(C.findInRow(r2.doc, W(3), r2.refs[0].id).start, T('08:00'));
  });
  test('AC-18 已编辑的下级不随上级改变', function () {
    var d = initial();
    d = C.createIntervals(d, [W(1)], T('08:00'), T('12:30'), 'external', gen).doc;
    var r = C.shiftIntervals(d, [ref(d, 'B', 1)], 0, 60, gen).doc;
    eq(spans(r, W(1))[1], '14:00-17:00');
    eq(spans(r, D('2026-09-21'))[1], '14:00-17:00', '跟随周一模板的日子');
    eq(spans(r, D('2026-09-22'))[1], '14:00-18:00', '跟随周二模板（→唯一模板）的日子');
  });
  test('AC-19 在日程页编辑一天，再改周模板', function () {
    var d = initial();
    var day = D('2026-09-29');
    var r = C.toggleFloat(d, [ref(d, day, 0)], gen);
    assert(r.ok && !C.isFollow(r.doc, day) && C.eff(r.doc, day)[0].float, '该日变为已编辑');
    assert(r.refs[0].id !== ref(d, day, 0).id && C.findInRow(r.doc, day, r.refs[0].id), '引用换成副本的 id');
    var r2 = C.writeCells(r.doc, [W(2)], T('14:00'), T('17:00'), function () { return [{ start: T('15:00'), end: T('17:00'), kind: 'self' }]; }, gen);
    eq(spans(r2.doc, day)[1], '14:00-17:00');
    eq(spans(r2.doc, D('2026-09-22'))[1], '15:00-17:00');
  });
  test('AC-20 重置为模板', function () {
    var d = initial();
    var e = C.createIntervals(d, [W(1)], T('08:00'), T('12:30'), 'external', gen).doc;
    var r = C.resetRow(e, W(1));
    assert(r.ok && C.isFollow(r.doc, W(1)));
    eq(spans(r.doc, W(1)), spans(r.doc, 'B'));
    assert(!C.resetRow(r.doc, W(1)).ok && !C.resetRow(r.doc, 'B').ok);
    var day = C.clearRow(d, D('2026-09-29')).doc;
    assert(!C.isFollow(day, D('2026-09-29')) && spans(day, D('2026-09-29')).length === 0, '清空此行：已编辑且为空');
    var back = C.resetRow(day, D('2026-09-29')).doc;
    assert(!back.objs[D('2026-09-29')], '日子重置后不再单独保存');
  });

  /* ---------- 写入类（FR-4.4） ---------- */
  test('FR-4.4 截断与删除；FR-4.3 不合并', function () {
    var d = initial();
    var r = C.clearCells(d, [W(1), W(2)], T('11:00'), T('19:00'), gen);
    eq(spans(r.doc, W(1)), ['08:00-11:00', '19:00-20:30']);
    eq(C.eff(r.doc, W(1))[1].float, true);
    var r2 = C.createIntervals(d, [W(1)], T('12:00'), T('13:00'), 'self', gen);
    eq(spans(r2.doc, W(1)).slice(0, 2), ['08:00-12:00', '12:00-13:00']);
  });
  test('AC-6 多行写入（Ctrl 去掉周三）', function () {
    var d = initial();
    var r = C.createIntervals(d, [W(2), W(4)], T('18:30'), T('21:00'), 'self', gen);
    assert(r.ok, r.error);
    [2, 4].forEach(function (w) { eq(spans(r.doc, W(w))[2], '18:30-21:00'); });
    assert(C.isFollow(r.doc, W(3)), '周三不变');
  });

  /* ---------- 属性 ---------- */
  test('F 切换浮动：不一致时全部设为 true', function () {
    var d = initial();
    var refs = [ref(d, W(1), 0), ref(d, W(1), 2)];
    var r = C.toggleFloat(d, refs, gen);
    eq(C.eff(r.doc, W(1)).map(function (x) { return x.float; }), [true, false, true]);
    var r2 = C.toggleFloat(r.doc, r.refs, gen);
    eq(C.eff(r2.doc, W(1)).map(function (x) { return x.float; }), [false, false, false]);
  });
  test('同一个区间在两条跟随行中分别修改', function () {
    var d = initial();
    var refs = [ref(d, W(1), 0), ref(d, W(2), 0)];
    eq(refs[0].id, refs[1].id, '两行显示同一个上级区间');
    var r = C.setKind(d, refs, 'external', gen);
    assert(r.ok);
    eq([C.eff(r.doc, W(1))[0].kind, C.eff(r.doc, W(2))[0].kind, C.eff(r.doc, 'B')[0].kind], ['external', 'external', 'self']);
    assert(r.refs[0].id !== r.refs[1].id, '各自得到新 id');
  });
  test('FR-6.13 文字违反约束不生效', function () {
    var d = initial();
    var r = C.setText(d, [ref(d, W(1), 0)], '含[括号]', gen);
    assert(!r.ok && r.doc === d);
    eq(C.setText(d, [ref(d, W(1), 0)], '  去空格  ', gen).doc.objs[W(1)].intervals[0].text, '去空格');
  });

  /* ---------- 移动类（FR-4.5） ---------- */
  test('AC-4 两次 Shift+← 缩短结束端点', function () {
    var d = initial();
    var r = C.shiftIntervals(d, [ref(d, W(3), 0)], 0, -30, gen);
    r = C.shiftIntervals(r.doc, r.refs, 0, -30, gen);
    assert(r.ok);
    eq(spans(r.doc, W(3))[0], '08:00-11:00');
  });
  test('AC-5 结束端点越过 14:00 时拒绝', function () {
    var d = initial();
    var refs = [ref(d, W(2), 0)];
    for (var k = 0; k < 4; k++) { var r = C.shiftIntervals(d, refs, 0, 30, gen); assert(r.ok, r.error); d = r.doc; refs = r.refs; }
    eq(spans(d, W(2))[0], '08:00-14:00');
    var bad = C.shiftIntervals(d, refs, 0, 30, gen);
    assert(!bad.ok && bad.doc === d);
    has(bad.error, '14:00–17:00'); has(bad.error, '周二');
  });
  test('平移、开始端点、最短 1 格、越界', function () {
    var d = initial();
    var r = C.shiftIntervals(d, [ref(d, W(1), 0)], -30, -30, gen);
    eq(spans(r.doc, W(1))[0], '07:30-11:30');
    r = C.shiftIntervals(r.doc, r.refs, -30, -30, gen);
    var bad = C.shiftIntervals(r.doc, r.refs, -30, -30, gen);
    assert(!bad.ok); has(bad.error, '超出显示范围');
    var d2 = C.createIntervals(d, [W(5)], T('12:00'), T('12:30'), 'self', gen);
    var bad2 = C.shiftIntervals(d2.doc, d2.refs, 0, -30, gen);
    assert(!bad2.ok); has(bad2.error, '不能小于 1 格');
  });
  test('FR-6.11 多区间平移，任一冲突整体不生效', function () {
    var d = initial();
    var refs = [ref(d, W(1), 0), ref(d, W(2), 1)];
    var cur = d, okCount = 0;
    for (var k = 0; k < 10; k++) { var rr = C.shiftIntervals(cur, refs, 30, 30, gen); if (!rr.ok) break; cur = rr.doc; refs = rr.refs; okCount++; }
    eq(okCount, 3);
    eq(spans(cur, W(1))[0], '09:30-13:30');
  });
  test('Alt+↑↓ 跨行移动', function () {
    var d = initial();
    var c = C.clearCells(d, [W(2)], T('08:00'), T('12:00'), gen).doc;
    var r = C.moveIntervalsRow(c, [ref(c, W(1), 0)], TPL_ORDER, 1, gen);
    assert(r.ok, r.error);
    eq(spans(r.doc, W(1)), ['14:00-17:00', '18:30-20:30']);
    eq(spans(r.doc, W(2))[0], '08:00-12:00');
    eq(r.refs[0].key, W(2));
    var bad = C.moveIntervalsRow(r.doc, r.refs, TPL_ORDER, 1, gen);
    assert(!bad.ok); has(bad.error, '冲突');
    var top = C.moveIntervalsRow(d, [ref(d, 'B', 0)], TPL_ORDER, -1, gen);
    assert(!top.ok); has(top.error, '最上面');
  });

  /* ---------- 复制粘贴（6.4 节） ---------- */
  test('AC-7 复制周一 14:00–17:00，粘贴到周三 13:00', function () {
    var d = initial();
    var clip = C.copyRect(d, [W(1)], T('14:00'), T('17:00'));
    var r = C.pasteRect(d, clip, TPL_ORDER, TPL_ORDER.indexOf(W(3)), T('13:00'), gen);
    assert(r.ok, r.error);
    eq(spans(r.doc, W(3)), ['08:00-12:00', '13:00-16:00', '16:00-17:00', '18:30-20:30']);
  });
  test('AC-8 粘贴超出最后一行不生效', function () {
    var d = initial();
    var clip = C.copyRect(d, [W(5), W(6)], T('08:00'), T('12:00'));
    var r = C.pasteRect(d, clip, TPL_ORDER, TPL_ORDER.indexOf(W(6)), T('08:00'), gen);
    assert(!r.ok && r.doc === d);
    has(r.error, '超出最后一行');
  });
  test('FR-6.17 超出显示范围；跨页粘贴到日子', function () {
    var d = initial();
    var clip = C.copyRect(d, [W(1)], T('18:00'), T('21:00'));
    assert(!C.pasteRect(d, clip, TPL_ORDER, 1, T('20:00'), gen).ok);
    var order = C.listDays(d, TODAY).map(D);
    var r = C.pasteRect(d, C.copyRect(d, ['B'], T('08:00'), T('09:00')), order, 3, T('13:00'), gen);
    assert(r.ok && !C.isFollow(r.doc, order[3]));
    eq(spans(r.doc, order[3])[1], '13:00-14:00');
  });
  test('复制区间选区与剪贴板文本', function () {
    var d = initial();
    var clip = C.copyIntervals(d, [ref(d, W(2), 2), ref(d, W(1), 0)], TPL_ORDER);
    eq(clip.srcKeys, [W(1), W(2)]);
    eq(C.clipToText(clip), '## 周一\n08:00-12:00\n14:00-17:00\n18:30-20:30 ~浮动\n\n## 周二\n08:00-12:00\n14:00-17:00\n18:30-20:30 ~浮动\n');
    var dc = C.copyRect(d, [D('2026-09-29')], T('08:00'), T('09:00'));
    has(C.clipToText(dc), '08:00-09:00');
  });

  /* ---------- 文档设置 ---------- */
  test('FR-4.10 显示范围：检查全部已编辑对象', function () {
    var d = initial();
    d = C.createIntervals(d, [D('2026-09-01')], T('07:00'), T('07:30'), 'self', gen).doc;   // 加载范围之外保留的日子
    var bad = C.setSettings(d, { range: { start: T('07:30'), end: T('22:30') } }, TODAY);
    assert(!bad.ok); eq(bad.outside.length, 1); has(bad.error, '9月1日 周二 07:00–07:30');
    var r = C.setSettings(d, { range: { start: T('06:30'), end: T('24:00') } }, TODAY);
    assert(r.ok); has(C.serialize(r.doc), '范围 06:30-24:00');
    assert(!C.setSettings(d, { range: { start: 480, end: 510 } }, TODAY).ok, '至少 1 小时');
  });
  test('FR-4.15 / FR-4.16 起始日与一周起始日', function () {
    var d = initial();
    assert(!C.setSettings(d, { startDate: '2026-10-04' }, TODAY).ok, '周日起始时加载到 10-03');
    var r = C.setSettings(d, { weekStart: 1, startDate: '2026-10-04' }, TODAY);
    assert(r.ok, '周一起始时加载到 10-04');
    eq(C.serialize(r.doc).split('\n').slice(2, 4), ['一周起始 周一', '起始日 2026-10-04']);
    eq(C.setSettings(d, {}, TODAY).doc, d);
  });
  test('标题约束；笔记首尾空行', function () {
    var d = initial();
    assert(!C.setTitle(d, '   ').ok);
    eq(C.setTitle(d, '  第 39 周 ').doc.title, '第 39 周');
    var n = Object.assign({}, d, { note: '\n\n  a\nb  \n\n' });            // 笔记只在文本视图中修改，没有 setNote
    has(C.serialize(n), '## 笔记\n  a\nb  \n');
  });
  test('不变式 I-5 / I-6', function () {
    var d = initial();
    var bad = C.makeDoc({ startDate: '2026-09-20', objs: { W1: { follow: true, intervals: [C.mkInterval(gen, 480, 510)] } } });
    has(C.validateDoc(bad), '跟随状态');
    var iv = C.mkInterval(gen, 480, 510);
    var dup = C.makeDoc({ startDate: '2026-09-20', base: [iv], objs: { W1: { follow: false, intervals: [iv] } } });
    has(C.validateDoc(dup), 'id 重复');
    assert(!C.validateDoc(d));
  });

  /* ---------- 输出 ---------- */
  var pass = results.filter(function (r) { return r.ok; }).length;
  var fails = results.filter(function (r) { return !r.ok; });
  var out = document.getElementById('out');
  var lines = ['RESULT ' + (fails.length ? 'FAIL' : 'PASS') + ' ' + pass + '/' + results.length];
  results.forEach(function (r) { lines.push((r.ok ? '  ok   ' : '  FAIL ') + r.name + (r.ok ? '' : '\n        ' + r.msg.replace(/\n/g, '\n        '))); });
  out.textContent = lines.join('\n');
  document.title = lines[0];
})();
