#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
weekline —— 周时间轴的本地网页服务（仅标准库）

启动一个只监听 127.0.0.1 的 HTTP 服务，送出 web/ 下的页面，并替页面读写计划文件（一个 md 文件），然后打开浏览器。
计划文档的解析、规则与编辑全部在页面里（web/core.js）；服务不解析计划文档，只按字节读写计划文件：
  GET  /api/plan          读计划文件：{path, name, exists, text, rev}，rev 是文件内容的 SHA-256
  POST /api/plan/save     {text, base}：文件当前的 rev 等于 base（null 表示应当不存在）才写入，否则回 conflict
  POST /api/plan/reveal   在资源管理器中显示计划文件

服务外壳（后台运行的日志与失败对话框、单实例、--stop、空闲退出、Host / Origin 校验、/api/display、/api/prefs、
配色与显示设置 /kit/*）来自本目录的 web-kit/（随工具带的副本，来历见 vendor.json）。

用法：pythonw weekline.py [--port 8767] [--no-browser] [--stop]
已有实例在同一端口运行时，只打开浏览器后退出。--stop 停止正在运行的实例。

在后台运行、不开控制台窗口：周时间轴.bat 用 pythonw 启动后立即返回。没有控制台时，输出写到数据目录的 web.log；
启动失败（端口被占）弹系统对话框告知。页面开着时每分钟报到一次，连续 30 分钟没有任何请求就退出。

设置与数据放在哪（web-kit 的 tooldirs）：设置目录平常是 %APPDATA%\\weekline\\（settings.json 与默认的计划文件 plan.md），
数据目录是 %LOCALAPPDATA%\\weekline\\（web.log、ui_prefs.json、backup/）；工具目录里有 portable 文件时分别是工具目录与它的 var/。
"""
import os, sys, json, glob, shutil, hashlib, datetime, threading, subprocess, argparse, webbrowser

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "web-kit"))      # 随本工具带的副本（来历见 vendor.json）
import webkit
import tooldirs

NAME = "weekline"
SIGNATURE = "weekline-web"
DEFAULT_PORT = 8767
IDLE_MINUTES = 30
BACKUP_KEEP = 30
WEB = os.path.join(HERE, "web")
CONF_DIR, DATA_DIR = tooldirs.dirs(HERE, NAME)

ApiError = webkit.ApiError


# ---------------- 计划文件 ----------------
def load_settings(conf_dir):
    """设置目录的 settings.json（可选）。文件不在或格式不对都当作没有设置。"""
    try:
        with open(os.path.join(conf_dir, "settings.json"), encoding="utf-8-sig") as f:
            s = json.load(f)
        return s if isinstance(s, dict) else {}
    except (OSError, ValueError):
        return {}


def plan_path(conf_dir):
    """FR-7.13：settings.json 的 plan_file（可含环境变量与 ~，相对路径相对设置目录），没有则为设置目录的 plan.md。"""
    p = load_settings(conf_dir).get("plan_file")
    if isinstance(p, str) and p.strip():
        p = os.path.expanduser(os.path.expandvars(p.strip()))
        return os.path.normpath(p if os.path.isabs(p) else os.path.join(conf_dir, p))
    return os.path.join(conf_dir, "plan.md")


def rev_of(data):
    return hashlib.sha256(data).hexdigest()


class Store:
    """计划文件的读写。不记状态：“自上次读写以来没被别处改过”由调用方带来的 base（它上次看到的 rev）判断。"""

    def __init__(self, conf_dir, data_dir, today=None):
        self.conf_dir = conf_dir
        self.data_dir = data_dir
        self.today = today or (lambda: datetime.date.today().isoformat())
        self.lock = threading.Lock()

    def path(self):
        return plan_path(self.conf_dir)

    def _read_bytes(self, path):
        try:
            with open(path, "rb") as f:
                return f.read()
        except FileNotFoundError:
            return None

    def read(self, _q=None):
        path = self.path()
        with self.lock:
            data = self._read_bytes(path)
        out = {"path": path, "name": os.path.basename(path), "exists": data is not None, "text": None, "rev": None}
        if data is None:
            return out
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise ApiError(f"计划文件不是 UTF-8 编码：{path}")
        out.update(text=text.replace("\r\n", "\n"), rev=rev_of(data))
        return out

    def save(self, body):
        text, base = body.get("text"), body.get("base")
        if not isinstance(text, str) or not (base is None or isinstance(base, str)):
            raise ApiError("参数不对")
        path = self.path()
        new = text.encode("utf-8")
        with self.lock:
            cur = self._read_bytes(path)
            cur_rev = None if cur is None else rev_of(cur)
            if cur_rev != base:
                return {"ok": False, "conflict": True, "rev": cur_rev}
            if cur is not None:
                self._backup(path)
            d = os.path.dirname(path)
            os.makedirs(d, exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "wb") as f:
                f.write(new)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)      # 原子写：写到一半中断不会留下不完整的计划文件（FR-7.14）
        return {"ok": True, "rev": rev_of(new)}

    def _backup(self, path):
        """FR-7.20：每天第一次写入前把原文件复制到数据目录 backup/，只保留最近 BACKUP_KEEP 份。失败不影响写入。"""
        try:
            bdir = os.path.join(self.data_dir, "backup")
            stem = os.path.splitext(os.path.basename(path))[0]
            dst = os.path.join(bdir, f"{stem}.{self.today()}.md")
            if os.path.exists(dst):
                return
            os.makedirs(bdir, exist_ok=True)
            shutil.copy2(path, dst)
            olds = sorted(glob.glob(os.path.join(glob.escape(bdir), glob.escape(stem) + ".????-??-??.md")))
            for p in olds[:-BACKUP_KEEP]:
                os.remove(p)
        except OSError as e:
            webkit.log(f"备份计划文件失败：{e}")

    def reveal(self, _body=None):
        path = self.path()
        if os.path.exists(path):
            subprocess.Popen(["explorer", "/select,", path])
        else:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            subprocess.Popen(["explorer", os.path.dirname(path)])
        return {"ok": True}


# ---------------- HTTP（外壳在 web-kit）----------------
def static_map(web_dir):
    """web/ 下的 .html / .css / .js 都可访问；/ 对应 index.html。新增界面文件不必改这里。"""
    out = {"/": "index.html"}
    for root, _dirs, files in os.walk(web_dir):
        for fn in files:
            if os.path.splitext(fn)[1] in (".html", ".css", ".js"):
                rel = os.path.relpath(os.path.join(root, fn), web_dir).replace(os.sep, "/")
                out["/" + rel] = rel
    return out


STORE = Store(CONF_DIR, DATA_DIR)


class Handler(webkit.Handler):
    signature = SIGNATURE; header = "X-Weekline"; web_dir = WEB
    static = static_map(WEB)
    factory = {"scheme": "xiangya"}          # 本工具的出厂配色：象牙（需求 NFR-6）
    get_routes = {"/api/plan": STORE.read}
    post_routes = {"/api/plan/save": STORE.save, "/api/plan/reveal": STORE.reveal}
    server_version = "weekline-web"


def main():
    webkit.setup_log(DATA_DIR)
    ap = argparse.ArgumentParser(prog="weekline", description="周时间轴的本地网页服务")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--stop", action="store_true", help="停止正在运行的实例")
    args = ap.parse_args()
    url = f"http://127.0.0.1:{args.port}/"
    if args.stop:
        print("已停止" if webkit.stop(args.port, Handler.header) else "没有在运行"); return
    if webkit.already_running(args.port, SIGNATURE):
        print(f"已在运行：{url}")
        if not args.no_browser: webbrowser.open(url)
        return
    Handler.port = args.port
    Handler.prefs = webkit.Prefs(os.path.join(DATA_DIR, "ui_prefs.json"), Handler.factory)
    Handler.idle = webkit.IdleWatch(IDLE_MINUTES)
    try:
        srv = webkit.bind(args.port, Handler)
    except OSError as e:
        webkit.fail(f"端口 {args.port} 用不了（{e}）。可以换一个：weekline.py --port 8768", "周时间轴")
    Handler.idle.start(srv)
    webkit.log(f"周时间轴已启动：{url}（计划文件：{STORE.path()}；停止：weekline.py --stop）")
    if not args.no_browser: webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    srv.server_close()


if __name__ == "__main__":
    main()
