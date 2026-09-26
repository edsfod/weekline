# -*- coding: utf-8 -*-
"""服务端计划文件读写的测试（需求 7.6 节）：python tests/test_server.py"""
import os, sys, json, tempfile, unittest

sys.dont_write_bytecode = True
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import weekline
from weekline import Store, plan_path, rev_of, static_map


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conf = os.path.join(self.tmp.name, "conf")
        self.data = os.path.join(self.tmp.name, "data")
        os.makedirs(self.conf)
        self.day = "2026-09-25"
        self.store = Store(self.conf, self.data, today=lambda: self.day)

    def tearDown(self):
        self.tmp.cleanup()

    def settings(self, obj):
        with open(os.path.join(self.conf, "settings.json"), "w", encoding="utf-8") as f:
            json.dump(obj, f)

    def test_default_path_and_missing_file(self):
        r = self.store.read()
        self.assertEqual(r["path"], os.path.join(self.conf, "plan.md"))
        self.assertFalse(r["exists"])
        self.assertIsNone(r["rev"])

    def test_plan_file_setting(self):
        self.settings({"plan_file": "sub/my.md"})
        self.assertEqual(plan_path(self.conf), os.path.normpath(os.path.join(self.conf, "sub/my.md")))
        os.environ["WEEKLINE_TEST_DIR"] = self.tmp.name
        self.settings({"plan_file": "%WEEKLINE_TEST_DIR%/x.md" if os.name == "nt" else "$WEEKLINE_TEST_DIR/x.md"})
        self.assertEqual(plan_path(self.conf), os.path.normpath(os.path.join(self.tmp.name, "x.md")))
        self.settings({"plan_file": ""})
        self.assertEqual(plan_path(self.conf), os.path.join(self.conf, "plan.md"))
        with open(os.path.join(self.conf, "settings.json"), "w") as f:
            f.write("{bad json")
        self.assertEqual(plan_path(self.conf), os.path.join(self.conf, "plan.md"))

    def test_create_then_conditional_write(self):
        r = self.store.save({"text": "# A\n", "base": None})
        self.assertTrue(r["ok"])
        self.assertEqual(r["rev"], rev_of(b"# A\n"))
        # 再用 base=None 写：文件已存在，冲突
        c = self.store.save({"text": "# B\n", "base": None})
        self.assertEqual(c, {"ok": False, "conflict": True, "rev": r["rev"]})
        # 用正确的 base 写
        r2 = self.store.save({"text": "# B\n", "base": r["rev"]})
        self.assertTrue(r2["ok"])
        got = self.store.read()
        self.assertEqual(got["text"], "# B\n")
        self.assertEqual(got["rev"], r2["rev"])

    def test_external_change_is_conflict(self):
        r = self.store.save({"text": "# A\n", "base": None})
        with open(self.store.path(), "w", encoding="utf-8", newline="\n") as f:
            f.write("# changed elsewhere\n")
        c = self.store.save({"text": "# mine\n", "base": r["rev"]})
        self.assertFalse(c["ok"])
        self.assertTrue(c["conflict"])
        with open(self.store.path(), encoding="utf-8") as f:
            self.assertEqual(f.read(), "# changed elsewhere\n")      # 冲突时不写
        # 覆盖：以冲突时拿到的 rev 为 base
        self.assertTrue(self.store.save({"text": "# mine\n", "base": c["rev"]})["ok"])

    def test_read_bom_crlf_and_non_utf8(self):
        with open(self.store.path(), "wb") as f:
            f.write("﻿# 标题\r\n范围 07:00-22:30\r\n".encode("utf-8"))
        r = self.store.read()
        self.assertEqual(r["text"], "# 标题\n范围 07:00-22:30\n")
        with open(self.store.path(), "wb") as f:
            f.write("# 标题\n".encode("gbk"))
        with self.assertRaises(weekline.ApiError):
            self.store.read()

    def test_atomic_write_leaves_no_tmp(self):
        self.store.save({"text": "# A\n", "base": None})
        self.assertEqual(sorted(os.listdir(self.conf)), ["plan.md"])

    def test_bad_params(self):
        with self.assertRaises(weekline.ApiError):
            self.store.save({"text": 1, "base": None})
        with self.assertRaises(weekline.ApiError):
            self.store.save({"text": "x", "base": 3})

    def test_daily_backup_and_keep(self):
        r = self.store.save({"text": "v0\n", "base": None})          # 新建：没有原文件，不备份
        self.assertFalse(os.path.exists(os.path.join(self.data, "backup")))
        r = self.store.save({"text": "v1\n", "base": r["rev"]})      # 当天第一次改写：备份 v0
        r = self.store.save({"text": "v2\n", "base": r["rev"]})      # 当天再写：不再备份
        bdir = os.path.join(self.data, "backup")
        self.assertEqual(os.listdir(bdir), ["plan.2026-09-25.md"])
        with open(os.path.join(bdir, "plan.2026-09-25.md"), encoding="utf-8") as f:
            self.assertEqual(f.read(), "v0\n")
        # 连续 35 天各写一次，只保留最近 30 份
        for i in range(35):
            self.day = "2026-10-%02d" % (i + 1) if i < 31 else "2026-11-%02d" % (i - 30)
            r = self.store.save({"text": "d%d\n" % i, "base": r["rev"]})
        names = sorted(os.listdir(bdir))
        self.assertEqual(len(names), weekline.BACKUP_KEEP)
        self.assertEqual(names[-1], "plan.2026-11-04.md")

    def test_static_map(self):
        m = static_map(weekline.WEB)
        self.assertEqual(m["/"], "index.html")
        self.assertEqual(m["/app/base.js"], "app/base.js")
        self.assertIn("/core.js", m)
        self.assertIn("/app.css", m)


if __name__ == "__main__":
    unittest.main(verbosity=1)
