"""Cài phim BBS — giao diện chọn gói ZIP (xuất từ App 2) + thư mục game, cài/gỡ phim. Chạy: pythonw film_installer.pyw [gói.zip]"""
from __future__ import annotations

import json
import os
import sys
import threading
from datetime import datetime
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import installer_core as core

APP_NAME = 'Cài phim BBS'
VERSION = '1.0.0'
SETTINGS = Path(os.environ.get('APPDATA', Path.home())) / 'CaiPhimBBS' / 'settings.json'

BG, PANEL, FIELD, TEXT, MUTED = '#16181d', '#1f232b', '#2a2f39', '#e8eaef', '#9aa3b2'
ACCENT, OK, WARN, BAD = '#7c5cff', '#3ecf8e', '#f5b544', '#ff6b6b'
STATUS_TEXT = {'install': 'Cài mới', 'skip': 'Đã có — bỏ qua', 'conflict': 'Khác bản đang có — giữ bản cũ'}


def load_settings() -> dict:
    try:
        return json.loads(SETTINGS.read_text('utf8'))
    except (OSError, ValueError):
        return {}


def save_settings(data: dict) -> None:
    try:
        SETTINGS.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS.write_text(json.dumps(data, ensure_ascii=False, indent=2), 'utf8')
    except OSError:
        pass  # Không nhớ được thì lần sau chọn lại, không chặn việc cài.


def local_time(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone().strftime('%d/%m/%Y %H:%M')
    except ValueError:
        return iso[:16]


class App(tk.Tk):
    def __init__(self, initial_zip: str | None):
        super().__init__()
        self.title(f'{APP_NAME} {VERSION}')
        self.geometry('980x700')
        self.minsize(820, 600)
        self.configure(bg=BG)
        self.settings = load_settings()
        self.package: core.Package | None = None
        self.root_dir: Path | None = None
        self.plan: core.Plan | None = None
        self.mods_ok = False
        self.running_here = False
        self._style()
        self._build()
        game = self.settings.get('gameDir') or next(iter(core.guess_game_dirs()), '')
        if game:
            self.set_game(game, quiet=True)
        if initial_zip:
            self.after(200, lambda: self.set_zip(initial_zip))

    # ----------------------------------------------------------------------------------------------- giao diện
    def _style(self):
        s = ttk.Style(self)
        s.theme_use('clam')
        base = ('Segoe UI', 10)
        s.configure('.', background=BG, foreground=TEXT, fieldbackground=FIELD, font=base, bordercolor=PANEL, lightcolor=PANEL, darkcolor=PANEL)
        s.configure('TFrame', background=BG)
        s.configure('Panel.TFrame', background=PANEL)
        s.configure('TLabel', background=BG, foreground=TEXT)
        s.configure('Panel.TLabel', background=PANEL, foreground=TEXT)
        s.configure('Muted.TLabel', background=PANEL, foreground=MUTED)
        s.configure('Title.TLabel', background=BG, foreground=TEXT, font=('Segoe UI Semibold', 18))
        s.configure('Sub.TLabel', background=BG, foreground=MUTED)
        s.configure('Step.TLabel', background=PANEL, foreground=TEXT, font=('Segoe UI Semibold', 11))
        s.configure('TButton', background=FIELD, foreground=TEXT, padding=(12, 6), borderwidth=0)
        s.map('TButton', background=[('active', '#353b47'), ('disabled', '#22262e')], foreground=[('disabled', '#5d6573')])
        s.configure('Accent.TButton', background=ACCENT, foreground='white', font=('Segoe UI Semibold', 11), padding=(22, 10))
        s.map('Accent.TButton', background=[('active', '#6a4cf0'), ('disabled', '#3a3550')], foreground=[('disabled', '#8c86a6')])
        s.configure('Danger.TButton', background='#5a2a30', foreground='white')
        s.map('Danger.TButton', background=[('active', '#7a333b'), ('disabled', '#2c2326')])
        s.configure('TCombobox', fieldbackground=FIELD, background=FIELD, foreground=TEXT, arrowcolor=TEXT, padding=6)
        s.map('TCombobox', fieldbackground=[('readonly', FIELD)], foreground=[('readonly', TEXT)])
        self.option_add('*TCombobox*Listbox.background', FIELD)
        self.option_add('*TCombobox*Listbox.foreground', TEXT)
        self.option_add('*TCombobox*Listbox.selectBackground', ACCENT)
        s.configure('Treeview', background=FIELD, fieldbackground=FIELD, foreground=TEXT, rowheight=26, borderwidth=0)
        s.configure('Treeview.Heading', background=PANEL, foreground=MUTED, relief='flat')
        s.map('Treeview', background=[('selected', ACCENT)])

    def _build(self):
        head = ttk.Frame(self, padding=(20, 16, 20, 6))
        head.pack(fill='x')
        ttk.Label(head, text='Cài phim BBS FS', style='Title.TLabel').pack(anchor='w')
        ttk.Label(head, text='Chọn gói phim .zip (xuất từ App 2) và thư mục game, rồi bấm Cài. Không cần cài thêm gì.', style='Sub.TLabel').pack(anchor='w')

        self.banner = tk.Label(self, text='', bg=BG, fg='white', font=('Segoe UI Semibold', 10), anchor='w', padx=20, pady=6)

        # Thanh tab tự vẽ: tab đang chọn nổi lên (nền sáng, chữ trắng, gạch tím), tab kia chìm (nền tối, chữ mờ).
        bar = tk.Frame(self, bg=BG)
        bar.pack(fill='x', padx=20, pady=(8, 0))
        body = ttk.Frame(self)
        body.pack(fill='both', expand=True, padx=20, pady=(0, 16))
        self.tab_install = ttk.Frame(body, padding=0)
        self.tab_list = ttk.Frame(body, padding=0)
        self.tabs = []
        for index, (title, frame) in enumerate((('Cài phim', self.tab_install), ('Phim đã cài', self.tab_list))):
            tab = tk.Frame(bar, bg=BG, cursor='hand2')
            tab.pack(side='left', padx=(0, 4), anchor='s')
            label = tk.Label(tab, text=title, font=('Segoe UI Semibold', 11), padx=22, pady=8, cursor='hand2')
            label.pack()
            line = tk.Frame(tab, height=3)
            line.pack(fill='x')
            for widget in (tab, label):
                widget.bind('<Button-1>', lambda _e, i=index: self.select_tab(i))
            self.tabs.append((tab, label, line, frame))
        tk.Frame(self, bg=FIELD, height=1).place(in_=bar, relx=0, rely=1, relwidth=1, y=-1)
        self._build_install(self.tab_install)
        self._build_list(self.tab_list)
        self.select_tab(0)

    def select_tab(self, index: int):
        for i, (tab, label, line, frame) in enumerate(self.tabs):
            if i == index:
                label.configure(bg=FIELD, fg='white', pady=10)
                line.configure(bg=ACCENT)
                frame.pack(fill='both', expand=True)
            else:
                label.configure(bg=PANEL, fg=MUTED, pady=6)
                line.configure(bg=PANEL)
                frame.pack_forget()
        if index == 1:
            self.refresh_installs()

    def _step(self, parent, number: str, title: str):
        box = ttk.Frame(parent, style='Panel.TFrame', padding=(14, 10))
        box.pack(fill='x', pady=(10, 0))
        ttk.Label(box, text=f'{number}  {title}', style='Step.TLabel').grid(row=0, column=0, sticky='w')
        box.columnconfigure(1, weight=1)
        return box

    def _build_install(self, tab):
        s1 = self._step(tab, '①', 'Gói phim (.zip)')
        self.zip_var = tk.StringVar(value='Chưa chọn gói')
        ttk.Label(s1, textvariable=self.zip_var, style='Muted.TLabel').grid(row=0, column=1, sticky='w', padx=12)
        ttk.Button(s1, text='Chọn gói…', command=self.pick_zip).grid(row=0, column=2)
        self.pkg_info = ttk.Label(s1, text='', style='Muted.TLabel', justify='left')
        self.pkg_info.grid(row=1, column=0, columnspan=3, sticky='w', pady=(6, 0))

        s2 = self._step(tab, '②', 'Thư mục game (Minecraft 1.20.1)')
        self.game_var = tk.StringVar(value='Chưa chọn thư mục game')
        ttk.Label(s2, textvariable=self.game_var, style='Muted.TLabel').grid(row=0, column=1, sticky='w', padx=12)
        ttk.Button(s2, text='Chọn thư mục…', command=self.pick_game).grid(row=0, column=2)
        self.mod_frame = ttk.Frame(s2, style='Panel.TFrame')
        self.mod_frame.grid(row=1, column=0, columnspan=3, sticky='w', pady=(6, 0))
        ttk.Label(s2, text='Phải là game Minecraft 1.20.1 (Forge hoặc Fabric) đã có BBS FS 2.7 — thư mục có mods, saves, config '
                           '(vd .minecraft hoặc instance 1.20.1 của launcher).',
                  style='Muted.TLabel').grid(row=2, column=0, columnspan=3, sticky='w', pady=(4, 0))

        s3 = self._step(tab, '③', 'World để xem phim')
        self.world_var = tk.StringVar()
        self.world_box = ttk.Combobox(s3, textvariable=self.world_var, state='readonly', width=40)
        self.world_box.grid(row=0, column=1, sticky='w', padx=12)
        self.world_box.bind('<<ComboboxSelected>>', lambda _e: self.rebuild_plan())
        ttk.Label(s3, text='Phim sẽ hiện trong danh sách film của world này.', style='Muted.TLabel').grid(row=1, column=0, columnspan=3, sticky='w', pady=(4, 0))

        foot = ttk.Frame(tab, padding=(0, 12, 0, 0))
        foot.pack(side='bottom', fill='x')  # luôn thấy nút Cài dù cửa sổ thấp
        prev = ttk.Frame(tab, style='Panel.TFrame', padding=(14, 10))
        prev.pack(fill='both', expand=True, pady=(10, 0))
        ttk.Label(prev, text='④  Xem trước các file sẽ chép', style='Step.TLabel').pack(anchor='w')
        cols = ('file', 'dest', 'size', 'status')
        self.tree = ttk.Treeview(prev, columns=cols, show='headings', height=6)
        for col, title, width in (('file', 'File', 260), ('dest', 'Chép vào', 360), ('size', 'Dung lượng', 90), ('status', 'Trạng thái', 200)):
            self.tree.heading(col, text=title, anchor='w')
            self.tree.column(col, width=width, anchor='w', stretch=col in ('file', 'dest'))
        self.tree.tag_configure('install', foreground=TEXT)
        self.tree.tag_configure('skip', foreground=MUTED)
        self.tree.tag_configure('conflict', foreground=WARN)
        self.tree.pack(fill='both', expand=True, pady=(8, 0))

        self.summary = ttk.Label(foot, text='', style='Sub.TLabel')
        self.summary.pack(side='left')
        self.install_btn = ttk.Button(foot, text='Cài vào game', style='Accent.TButton', command=self.do_install, state='disabled')
        self.install_btn.pack(side='right')
        ttk.Button(foot, text='Kiểm lại', command=self.recheck).pack(side='right', padx=8)

    def _build_list(self, tab):
        box = ttk.Frame(tab, style='Panel.TFrame', padding=(14, 10))
        box.pack(fill='both', expand=True, pady=(10, 0))
        ttk.Label(box, text='Các lần cài trong thư mục game đang chọn (cả lần cài từ App 2)', style='Step.TLabel').pack(anchor='w')
        cols = ('when', 'package', 'world', 'films', 'files')
        self.inst_tree = ttk.Treeview(box, columns=cols, show='headings', selectmode='browse')
        for col, title, width in (('when', 'Thời gian', 150), ('package', 'Gói', 260), ('world', 'World', 150), ('films', 'Phim', 220), ('files', 'Số file', 70)):
            self.inst_tree.heading(col, text=title, anchor='w')
            self.inst_tree.column(col, width=width, anchor='w', stretch=col in ('package', 'films'))
        self.inst_tree.pack(fill='both', expand=True, pady=(8, 0))
        self.inst_tree.bind('<<TreeviewSelect>>', lambda _e: self.remove_btn.configure(state='normal' if self.inst_tree.selection() else 'disabled'))
        foot = ttk.Frame(tab, padding=(0, 12, 0, 0))
        foot.pack(fill='x')
        ttk.Label(foot, text='Gỡ chỉ xoá đúng file đã cài và chưa bị sửa; tài nguyên phim khác còn dùng sẽ được giữ lại.', style='Sub.TLabel').pack(side='left')
        self.remove_btn = ttk.Button(foot, text='Gỡ phim đã chọn', style='Danger.TButton', command=self.do_uninstall, state='disabled')
        self.remove_btn.pack(side='right')
        ttk.Button(foot, text='Làm mới', command=self.refresh_installs).pack(side='right', padx=8)

    # ----------------------------------------------------------------------------------------------- trạng thái
    def show_banner(self, text: str, color: str):
        if text:
            self.banner.configure(text=text, bg=color)
            self.banner.pack(fill='x', after=self.winfo_children()[0])
        else:
            self.banner.pack_forget()

    def background(self, work, done, busy_text='Đang xử lý…'):
        self.configure(cursor='watch')
        self.summary.configure(text=busy_text)

        def run():
            try:
                result, error = work(), None
            except Exception as exc:  # noqa: BLE001 — hiện lỗi cho người dùng
                result, error = None, exc
            self.after(0, lambda: (self.configure(cursor=''), done(result, error)))
        threading.Thread(target=run, daemon=True).start()

    # ----------------------------------------------------------------------------------------------- bước 1: gói
    def pick_zip(self):
        start = self.settings.get('zipDir') or str(Path.home() / 'Downloads')
        path = filedialog.askopenfilename(title='Chọn gói phim .zip', initialdir=start, filetypes=[('Gói phim BBS', '*.zip'), ('Mọi file', '*.*')])
        if path:
            self.set_zip(path)

    def set_zip(self, path: str):
        self.settings['zipDir'] = str(Path(path).parent)
        save_settings(self.settings)

        def done(pkg, error):
            if error:
                self.package = None
                self.zip_var.set(Path(path).name)
                self.pkg_info.configure(text=f'✗ {error}', foreground=BAD)
                self.rebuild_plan()
                return
            self.package = pkg
            self.zip_var.set(pkg.path.name)
            effects = 'có hiệu ứng (cần AAA)' if pkg.requires_effects else 'không có hiệu ứng'
            mods = ', '.join(pkg.required_mods) or 'BBS FS'
            self.pkg_info.configure(foreground=MUTED, text=f'Phim: {", ".join(pkg.films) or "—"}   ·   {len(pkg.files)} file, {core.human_size(pkg.total_bytes)}'
                                    f'   ·   {effects}   ·   cần mod: {mods}')
            self.refresh_mods()
            self.rebuild_plan()
        self.background(lambda: core.read_package(path), done, 'Đang đọc gói…')

    # ----------------------------------------------------------------------------------------------- bước 2: game
    def pick_game(self):
        path = filedialog.askdirectory(title='Chọn thư mục game (có mods, saves)', initialdir=self.settings.get('gameDir') or str(Path.home()))
        if path:
            self.set_game(path)

    def set_game(self, path: str, quiet=False):
        try:
            root = core.canonical_game_dir(path)
        except core.InstallError as error:
            if not quiet:
                messagebox.showerror(APP_NAME, str(error))
            return
        self.root_dir = root
        self.game_var.set(str(root))
        self.settings['gameDir'] = str(root)
        save_settings(self.settings)
        worlds = core.list_worlds(root)
        self.world_box.configure(values=worlds)
        remembered = self.settings.get('world')
        self.world_var.set(remembered if remembered in worlds else (worlds[0] if worlds else ''))
        if not worlds and not quiet:
            messagebox.showwarning(APP_NAME, 'Thư mục này chưa có world nào (saves/<world>/level.dat). Hãy vào game tạo world trước, hoặc chọn đúng thư mục game.')
        self.refresh_mods()
        self.check_running()
        self.rebuild_plan()

    def refresh_mods(self):
        for child in self.mod_frame.winfo_children():
            child.destroy()
        if not self.root_dir:
            return
        if not self.package:
            ttk.Label(self.mod_frame, text='Chọn gói phim để kiểm mod cần có.', style='Muted.TLabel').pack(anchor='w')
            self.mods_ok = False
            return
        root, pkg = self.root_dir, self.package

        def done(check, error):
            for child in self.mod_frame.winfo_children():
                child.destroy()
            if error:
                ttk.Label(self.mod_frame, text=f'✗ Không đọc được thư mục mods: {error}', style='Muted.TLabel', foreground=BAD).pack(anchor='w')
                self.mods_ok = False
            else:
                for ok, text in check.lines:
                    mark, color = ('✓  ', OK) if ok else ('!  ', WARN) if ok is None else ('✗  ', BAD)
                    ttk.Label(self.mod_frame, text=mark + text, style='Muted.TLabel', foreground=color).pack(anchor='w')
                self.mods_ok = check.ok
            self.update_button()
        self.background(lambda: core.check_mods(root, pkg), done, 'Đang kiểm mod…')

    def check_running(self):
        if not self.root_dir:
            return
        root = self.root_dir

        def done(result, _error):
            here, other = result or (False, False)
            self.running_here = here
            if here:
                self.show_banner('⚠  Minecraft đang mở với thư mục game này — hãy THOÁT GAME rồi bấm "Kiểm lại" (cài khi game mở có thể làm BBS sập).', '#8a2c34')
            elif other:
                self.show_banner('ℹ  Có Minecraft khác đang chạy. Nếu đó là game sẽ cài vào, hãy thoát trước khi cài.', '#6b5320')
            else:
                self.show_banner('', BG)
            self.update_button()
        self.background(lambda: core.game_running(root), done, 'Đang kiểm game có đang mở…')

    def recheck(self):
        if self.package:
            self.set_zip(str(self.package.path))
        if self.root_dir:
            self.set_game(str(self.root_dir), quiet=True)

    # ----------------------------------------------------------------------------------------------- xem trước + cài
    def rebuild_plan(self):
        self.tree.delete(*self.tree.get_children())
        self.plan = None
        if self.world_var.get():
            self.settings['world'] = self.world_var.get()
            save_settings(self.settings)
        if self.package and self.root_dir and self.world_var.get():
            try:
                self.plan = core.plan_install(self.package, self.root_dir, self.world_var.get())
            except core.InstallError as error:
                self.summary.configure(text=f'✗ {error}')
            else:
                for row in sorted(self.plan.rows, key=lambda r: (not r.source.startswith('films/'), r.source)):
                    self.tree.insert('', 'end', values=(row.source, row.target, core.human_size(row.size), STATUS_TEXT[row.status]), tags=(row.status,))
        self.update_button()

    def update_button(self):
        ready = bool(self.plan) and self.mods_ok and not self.running_here
        new = self.plan.count('install') if self.plan else 0
        self.install_btn.configure(state='normal' if ready and new else 'disabled')
        if not self.package:
            text = 'Bước 1: chọn gói phim .zip'
        elif not self.root_dir:
            text = 'Bước 2: chọn thư mục game'
        elif not self.world_var.get():
            text = 'Bước 3: chọn world (game chưa có world?)'
        elif not self.plan:
            text = self.summary.cget('text')
        elif self.running_here:
            text = 'Thoát game trước khi cài'
        elif not self.mods_ok:
            text = 'Thiếu mod — xem bước ②'
        else:
            p = self.plan
            text = f'{p.count("install")} file sẽ cài · {p.count("skip")} đã có · {p.count("conflict")} khác bản cũ'
            if not new:
                text += '  —  phim này đã cài sẵn' if not p.count('conflict') else '  —  gỡ bản cũ ở tab "Phim đã cài" rồi cài lại'
        self.summary.configure(text=text)

    def do_install(self):
        if not self.plan:
            return
        plan = self.plan
        conflicts = plan.count('conflict')
        if conflicts and not messagebox.askyesno(APP_NAME, f'{conflicts} file trong game khác với bản trong gói và sẽ được GIỮ NGUYÊN (không ghi đè).\n\n'
                                                           'Muốn dùng bản mới: gỡ lần cài cũ ở tab "Phim đã cài" rồi cài lại.\n\nVẫn cài phần còn lại?'):
            return
        here, _ = core.game_running(plan.root)
        if here:
            self.running_here = True
            self.check_running()
            return
        self.install_btn.configure(state='disabled')

        def done(result, error):
            if error:
                messagebox.showerror(APP_NAME, f'Cài không thành công — đã hoàn tác file vừa chép.\n\n{error}')
            else:
                films = ', '.join(plan.package.films)
                messagebox.showinfo(APP_NAME, f'Đã cài xong!\n\nPhim: {films}\nWorld: {plan.world}\n'
                                              f'Đã chép {len(result.installed)} file, bỏ qua {len(result.skipped)} file đã có'
                                              + (f', giữ nguyên {len(result.conflicts)} file khác bản.' if result.conflicts else '.') +
                                              '\n\nVào game → mở world này → BBS → Film để xem.')
            self.rebuild_plan()
        self.background(lambda: core.apply_install(plan), done, 'Đang cài…')

    # ----------------------------------------------------------------------------------------------- gỡ
    def refresh_installs(self):
        self.inst_tree.delete(*self.inst_tree.get_children())
        self.remove_btn.configure(state='disabled')
        if not self.root_dir:
            return
        try:
            rows = core.list_installs(self.root_dir)
        except core.InstallError as error:
            messagebox.showerror(APP_NAME, str(error))
            return
        for r in rows:
            when = local_time(r.installed_at)
            self.inst_tree.insert('', 'end', iid=r.install_id, values=(when, r.package_name, r.world, ', '.join(r.films) or '—', len(r.files)))

    def do_uninstall(self):
        sel = self.inst_tree.selection()
        if not sel or not self.root_dir:
            return
        values = self.inst_tree.item(sel[0], 'values')
        if not messagebox.askyesno(APP_NAME, f'Gỡ gói "{values[1]}" (phim: {values[3]})?\n\nFile phim và tài nguyên chỉ phim này dùng sẽ bị xoá.'):
            return
        here, _ = core.game_running(self.root_dir)
        if here:
            messagebox.showwarning(APP_NAME, 'Minecraft đang mở với thư mục game này. Hãy thoát game rồi gỡ.')
            return
        root, install_id = self.root_dir, sel[0]

        def done(result, error):
            if error:
                messagebox.showerror(APP_NAME, str(error))
            else:
                msg = f'Đã gỡ: xoá {len(result.removed)} file.'
                if result.in_use:
                    msg += f'\nGiữ {len(result.in_use)} tài nguyên vì phim khác còn dùng.'
                if result.preserved:
                    msg += f'\nGiữ {len(result.preserved)} file đã bị sửa sau khi cài (không xoá để khỏi mất dữ liệu).'
                messagebox.showinfo(APP_NAME, msg)
            self.refresh_installs()
            self.rebuild_plan()
        self.background(lambda: core.uninstall(root, install_id), done, 'Đang gỡ…')


def main():
    initial = next((a for a in sys.argv[1:] if a.lower().endswith('.zip')), None)
    App(initial).mainloop()


if __name__ == '__main__':
    main()
