# weekline — weekly time-block planner

[中文](README.md) | English

A small local tool for laying out your week in half-hour blocks. You design one default day and seven weekday templates; every actual date follows its weekday template until you change it. The plan is saved as one plain Markdown file that you can also edit by hand.

It runs as a local web service plus a page in your browser (Windows). The service listens on `127.0.0.1` only and needs no network. **The interface is in Chinese**; this README explains what the labels mean.

## Download and run

1. Download `weekline-<version>-win64.zip` from [Releases](https://github.com/edsfod/weekline/releases). It bundles an embeddable Python, so nothing else needs to be installed.
2. Unzip it anywhere and double-click **`周时间轴.bat`** ("week timeline"). The service starts in the background with no console window and opens the page in your default browser. Double-clicking again only opens another page.
3. There is no window to close. The service exits by itself 30 minutes after the last page is closed; to stop it at once, run `pythonw weekline.py --stop`.

Running from a clone works the same way if Python 3.8+ is installed (the launcher looks in the bundled `python\`, the registry, the `py` launcher, common folders and `PATH`; set `TOOL_PYTHON` to force one).

## Three levels

| Level | Page | Default content |
| --- | --- | --- |
| Base day (唯一模板, one) | Templates (模板) | — |
| Weekday templates (周模板, Sunday–Saturday) | Templates (模板) | Follows the base day |
| Dates (具体日子, from the start date to the end of next week) | Schedule (日程) | Follows the template of the same weekday |

- **Following (跟随)**: the row shows whatever its parent shows, and changes when the parent changes — past dates included.
- **Edited (已编辑)**: the first time you change a following row, the tool copies the parent's content into it and then applies your change. From then on the row keeps its own content.
- **Reset to template (重置为模板)**, in the row menu, makes an edited row follow again.
- **Reference rows on the schedule page**: the base day stays pinned at the top, read-only. When you select a cell or block on a date, the template of that date's weekday appears right below it. The three levels are told apart by shade (each level darker than the one above), a level bar on the left of the row header, and indentation. Both reference rows can be hidden.
- **Notes**: the file ends with a `## 笔记` (notes) section for free text such as "at most 9 working hours a day". The tool does not check it. Edit it in the text view.

## Quick start

- **Switch pages**: the 模板 / 日程 buttons in the top bar, or `Alt+1` / `Alt+2`.
- **Select cells**: click a cell, or drag across cells (several rows at once). `Ctrl`+click a row header adds or removes that row. Click inside the selection again, or anywhere outside the editor, to clear it.
- **Create a block** on the selected cells:
  - `E` external fixed commitment (e.g. a class) — then type its text and press `Enter`;
  - `S` self-planned time;
  - `D` daily routine (meals, washing up) — also asks for text.
- **Change a block**: click it to select, then
  - `←` `→` move, `Shift+←→` change the end, `Ctrl+←→` change the start, `Alt+↑↓` move to the neighbouring row;
  - `F` toggle floating, `Enter` or double-click to edit the text, `Delete` to delete;
  - or drag the left/right edge of a selected block.
- Everything can be undone (`Ctrl+Z` / `Ctrl+Y`). Right-click anywhere for a menu of the actions available there; press `?` in the editor for all shortcuts and the legend.
- **导入 / 导出** import / export an md file. **文档设置** (document settings) sets the visible time range, the first day of the week and the start date. The slider button opens display settings (four colour schemes, fonts); the sun button toggles light/dark.

**Legend**

- External fixed commitment: solid blue block, text in a rounded outline.
- Self-planned time: sand-coloured outlined block.
- Daily routine: translucent light green block, no border.
- Floating: dashed border; shows "浮动" (floating) when it has no text.
- Time event (e.g. wake up, bedtime): a translucent honey-yellow line with a label. Wake-up and bedtime lines are thicker, and the time outside them is shaded.
- Selected block: thick outline. Selected cells: thicker copper grid lines; the cell you started from (the anchor) has no tint.

The styles stay distinguishable in greyscale.

## The plan file

- **Where**: `plan.md` in the settings folder, normally `%APPDATA%\weekline\`. To keep it elsewhere (e.g. a synced folder), copy [settings.example.json](settings.example.json) to `settings.json` in that folder and set `plan_file`.
- **Saving**: automatic, within about a second of each change, written atomically. If the service is not running, the top bar shows "保存失败" (save failed) and keeps retrying every 5 seconds.
- **Edited elsewhere**: you can edit the file in any text editor. When you switch back, the page loads the new content (undoable). If the page also has unsaved changes, it asks which version to keep.
- **Errors**: a file with errors is neither loaded nor overwritten; the errors are listed in the text view with line numbers.
- **Backups**: before the first write each day, the old file is copied to `backup\` in the data folder (normally `%LOCALAPPDATA%\weekline\`), keeping the last 30. The log `web.log` is there too.

## Text view and file format

The **文本视图** (text view) button shows the whole plan as Markdown, updated live. Edit it and press **应用** (apply), or **放弃修改** (discard). Only edited templates and dates are written out; anything missing is following.

A short example:

```
# 本周时间安排
范围 07:00-23:00
一周起始 周一
起始日 2026-09-21

## 唯一模板
07:00 起床
07:00-08:00 (洗漱+早饭)
08:00-12:00
12:00-14:00 (午饭+午休)
14:00-17:00
18:30-20:30 ~浮动
23:00 睡觉

## 周二
19:00-21:30 ~[Voice]

## 笔记
一天最多工作 9 小时。
```

- The header lines set the title, the visible range (`范围`), the first day of the week (`一周起始`) and the start date (`起始日`).
- Sections are `## 唯一模板` (base day), `## 周一` … `## 周日` (weekday templates), `## 2026-09-29 周二` (a date), and the final `## 笔记` (notes).
- A block is `HH:MM-HH:MM text`, on half-hour boundaries:
  - `[text]` external fixed commitment;
  - `(text)` daily routine;
  - plain text (or nothing) self-planned time;
  - a leading `~` marks it floating; the text after `~` is what the block shows (`~` alone or `~浮动` shows "浮动", floating). So block text cannot contain `~`.
- A time event is `HH:MM text`, e.g. `10:00 take pills`. It can only be written in text; in the editor it is display-only and clicks go through to the cells below.
- `起床` (wake up) and `睡觉` / `就寝` (bedtime) are special time events, at most one each per section. They inherit on their own: written in the base day, they apply to every template and date, edited or not, unless a section writes its own.

## Folder layout

| Path | Contents |
| --- | --- |
| `周时间轴.bat` | Launcher: finds Python and starts the service with `pythonw`. |
| `weekline.py` | The service: serves the page, reads and writes the plan file. Python standard library only. |
| `web/` | The page: `index.html`, `app.css`, the pure-function core `core.js` (data model, inheritance, rules, edits, md parsing and serialising) and the UI layer `app/`. No build step. |
| `web-kit/` | A vendored copy of [web-kit](https://github.com/edsfod/web-kit) (colour schemes, display settings, service shell, packaging). Do not edit; its origin is recorded in `vendor.json`. |
| `docs/` | The requirements document (Chinese). |
| `tests/`, `run-tests.sh` | `./run-tests.sh` runs the core tests in headless Edge, then the service tests in Python. |

**Development**: put an empty file named `portable` in the tool folder; the plan file then lives in the tool folder and data in `var\`, separate from an installed copy.

**Releasing**: push an annotated tag starting with `v` (`git tag -a v1.0.1 -m "notes"`, then `git push origin v1.0.1`). The workflow in `.github/workflows/release.yml` packs the tracked files plus an embeddable Python with `web-kit/pack.py` and creates a GitHub Release with the zip, using the tag message as the release notes.

## Requirements

- Windows 10 / 11.
- Chrome, Edge or Firefox. All file access goes through the service, not the browser's file APIs.

## License

MIT, see [LICENSE](LICENSE).
