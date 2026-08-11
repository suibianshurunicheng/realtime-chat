#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Generate a wireframe SVG (4 key screens) for the chat web app prototype."""
W, H = 1280, 760
parts = []
parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">')

# background
parts.append(f'<rect x="0" y="0" width="{W}" height="{H}" fill="#F1F5F9"/>')

# title
parts.append(f'<text x="{W//2}" y="44" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="26" font-weight="700" fill="#0F172A">实时聊天 Web 应用 — 页面原型（线框图）</text>')
parts.append(f'<text x="{W//2}" y="70" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="13" fill="#64748B">登录/注册 · 好友列表 · 单聊 · 个人资料 （低保真线框，仅示意布局）</text>')

ACCENT = "#3B82F6"
GRAY = "#94A3B8"
LIGHT = "#E2E8F0"
DARK = "#1E293B"
GREEN = "#22C55E"

def phone(x, caption):
    y = 96; w = 280; h = 600
    # frame
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="26" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2"/>')
    # caption above
    parts.append(f'<text x="{x+w//2}" y="{y-14}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="15" font-weight="700" fill="#0F172A">{caption}</text>')
    # status bar
    parts.append(f'<text x="{x+16}" y="{y+28}" font-family="Noto Sans SC, sans-serif" font-size="12" fill="{DARK}">9:41</text>')
    parts.append(f'<circle cx="{x+w-30}" cy="{y+22}" r="3" fill="{GRAY}"/><circle cx="{x+w-18}" cy="{y+22}" r="3" fill="{GRAY}"/>')
    return x+14, y+14, w-28, h-28  # screen coords: sx, sy, sw, sh

def header(sx, sy, sw, title, left="‹", right="⋯"):
    y = sy+22
    parts.append(f'<text x="{sx+6}" y="{y+8}" font-family="Noto Sans SC, sans-serif" font-size="20" fill="{DARK}">{left}</text>')
    parts.append(f'<text x="{sx+sw//2}" y="{y+8}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="15" font-weight="700" fill="{DARK}">{title}</text>')
    parts.append(f'<text x="{sx+sw-6}" y="{y+8}" text-anchor="end" font-family="Noto Sans SC, sans-serif" font-size="18" fill="{DARK}">{right}</text>')
    parts.append(f'<line x1="{sx}" y1="{sy+44}" x2="{sx+sw}" y2="{sy+44}" stroke="{LIGHT}" stroke-width="1"/>')

def field(sx, cy, sw, label, ph):
    w = sw; h = 38
    parts.append(f'<text x="{sx}" y="{cy-4}" font-family="Noto Sans SC, sans-serif" font-size="11" fill="{GRAY}">{label}</text>')
    parts.append(f'<rect x="{sx}" y="{cy}" width="{w}" height="{h}" rx="8" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5"/>')
    parts.append(f'<text x="{sx+10}" y="{cy+24}" font-family="Noto Sans SC, sans-serif" font-size="13" fill="{LIGHT}">{ph}</text>')

def button(sx, cy, w, h, text, filled=True):
    fill = ACCENT if filled else "#FFFFFF"
    stroke = ACCENT if not filled else ACCENT
    tcol = "#FFFFFF" if filled else ACCENT
    parts.append(f'<rect x="{sx}" y="{cy}" width="{w}" height="{h}" rx="9" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    parts.append(f'<text x="{sx+w//2}" y="{cy+h//2+5}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="14" font-weight="600" fill="{tcol}">{text}</text>')

def avatar(cx, cy, r, online=False):
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{LIGHT}" stroke="#CBD5E1" stroke-width="1.5"/>')
    parts.append(f'<circle cx="{cx}" cy="{cy-4}" r="{r*0.32}" fill="{GRAY}"/>')
    parts.append(f'<path d="M {cx-r*0.55} {cy+r*0.55} Q {cx} {cy-r*0.05} {cx+r*0.55} {cy+r*0.55} Z" fill="{GRAY}"/>')
    if online:
        parts.append(f'<circle cx="{cx+r*0.7}" cy="{cy+r*0.7}" r="5" fill="{GREEN}" stroke="#FFFFFF" stroke-width="2"/>')

def bubble(sx, y, text, outgoing=False, read=None):
    # measure approx width
    tw = max(40, len(text)*13 + 20)
    maxw = 170
    if tw > maxw: tw = maxw
    if outgoing:
        bx = sx + (252 - 16) - tw
    else:
        bx = sx + 16
    parts.append(f'<rect x="{bx}" y="{y}" width="{tw}" height="34" rx="14" fill="{ACCENT if outgoing else LIGHT}"/>')
    col = "#FFFFFF" if outgoing else DARK
    # wrap simple: single line (truncate)
    disp = text if len(text) <= 12 else text[:11]+"…"
    parts.append(f'<text x="{bx+tw//2}" y="{y+22}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="12" fill="{col}">{disp}</text>')
    if read:
        parts.append(f'<text x="{bx+tw-2}" y="{y+30}" text-anchor="end" font-family="Noto Sans SC, sans-serif" font-size="10" fill="{GRAY}">已读</text>')

# ---------- Screen 1: 登录/注册 ----------
sx, sy, sw, sh = phone(35, "① 登录 / 注册")
# logo
cx = sx + sw//2
parts.append(f'<circle cx="{cx}" cy="{sy+90}" r="28" fill="{ACCENT}"/>')
parts.append(f'<path d="M {cx-12} {sy+82} q 12 -14 24 0 M {cx-8} {sy+100} h 16" stroke="#FFFFFF" stroke-width="2.5" fill="none" stroke-linecap="round"/>')
parts.append(f'<text x="{cx}" y="{sy+150}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="20" font-weight="700" fill="{DARK}">聊天</text>')
field(sx+20, sy+190, sw-40, "用户名", "请输入用户名")
field(sx+20, sy+256, sw-40, "密码", "••••••••")
# remember me
parts.append(f'<rect x="{sx+20}" y="{sy+312}" width="16" height="16" rx="4" fill="#FFFFFF" stroke="{ACCENT}" stroke-width="2"/>')
parts.append(f'<text x="{sx+44}" y="{sy+324}" font-family="Noto Sans SC, sans-serif" font-size="12" fill="{DARK}">记住我</text>')
button(sx+20, sy+346, sw-40, 44, "登 录", filled=True)
parts.append(f'<text x="{cx}" y="{sy+420}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="13" fill="{ACCENT}">注册新账号</text>')

# ---------- Screen 2: 好友列表 ----------
sx, sy, sw, sh = phone(345, "② 好友列表")
header(sx, sy, sw, "好友", "‹", "＋")
field(sx+16, sy+60, sw-32, "", "🔍 搜索好友")
# friend rows
friends = [("张伟", "在吗？周末一起吃饭？", True), ("李娜", "[图片]", False), ("王芳", "好的，晚点聊", True), ("陈强", "收到", False)]
ry = sy+118
for name, msg, on in friends:
    avatar(sx+34, ry+20, 18, online=on)
    parts.append(f'<text x="{sx+64}" y="{ry+14}" font-family="Noto Sans SC, sans-serif" font-size="13" font-weight="600" fill="{DARK}">{name}</text>')
    parts.append(f'<text x="{sx+64}" y="{ry+32}" font-family="Noto Sans SC, sans-serif" font-size="11" fill="{GRAY}">{msg}</text>')
    parts.append(f'<line x1="{sx+16}" y1="{ry+44}" x2="{sx+sw-16}" y2="{ry+44}" stroke="{LIGHT}" stroke-width="1"/>')
    ry += 56
# bottom tabs
parts.append(f'<line x1="{sx}" y1="{sy+sh-46}" x2="{sx+sw}" y2="{sy+sh-46}" stroke="{LIGHT}" stroke-width="1"/>')
parts.append(f'<text x="{sx+sw//4}" y="{sy+sh-16}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="12" fill="{ACCENT}">消息</text>')
parts.append(f'<text x="{sx+sw*3//4}" y="{sy+sh-16}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="12" fill="{GRAY}">好友</text>')

# ---------- Screen 3: 单聊 ----------
sx, sy, sw, sh = phone(655, "③ 单聊")
header(sx, sy, sw, "张伟", "‹", "⋯")
parts.append(f'<text x="{sx+sw//2}" y="{sy+58}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="11" fill="{GREEN}">在线</text>')
bubble(sx, sy+96, "在吗？", outgoing=False)
bubble(sx, sy+146, "在的，怎么了", outgoing=True)
bubble(sx, sy+196, "周末一起吃饭？", outgoing=False)
bubble(sx, sy+246, "好啊！", outgoing=True, read=True)
# input bar
by = sy+sh-54
parts.append(f'<rect x="{sx+12}" y="{by}" width="{sw-118}" height="38" rx="19" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5"/>')
parts.append(f'<text x="{sx+24}" y="{by+24}" font-family="Noto Sans SC, sans-serif" font-size="12" fill="{LIGHT}">输入消息…</text>')
parts.append(f'<rect x="{sx+sw-98}" y="{by}" width="34" height="38" rx="8" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5"/>')
parts.append(f'<text x="{sx+sw-81}" y="{by+24}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="16" fill="{GRAY}">🖼</text>')
button(sx+sw-58, by, 46, 38, "发送", filled=True)

# ---------- Screen 4: 个人资料 ----------
sx, sy, sw, sh = phone(965, "④ 个人资料")
header(sx, sy, sw, "个人资料", "‹", "")
avatar(sx+sw//2, sy+110, 40)
parts.append(f'<text x="{sx+sw//2}" y="{sy+172}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="16" font-weight="700" fill="{DARK}">左庆江</text>')
parts.append(f'<text x="{sx+sw//2}" y="{sy+194}" text-anchor="middle" font-family="Noto Sans SC, sans-serif" font-size="12" fill="{GREEN}">在线</text>')
# info rows
rows = [("用户名", "zqj"), ("状态", "正常")]
ry = sy+230
for k, v in rows:
    parts.append(f'<text x="{sx+24}" y="{ry+20}" font-family="Noto Sans SC, sans-serif" font-size="13" fill="{GRAY}">{k}</text>')
    parts.append(f'<text x="{sx+sw-24}" y="{ry+20}" text-anchor="end" font-family="Noto Sans SC, sans-serif" font-size="13" fill="{DARK}">{v}</text>')
    parts.append(f'<line x1="{sx+16}" y1="{ry+34}" x2="{sx+sw-16}" y2="{ry+34}" stroke="{LIGHT}" stroke-width="1"/>')
    ry += 48
button(sx+24, ry+10, sw-48, 42, "编辑资料", filled=False)
button(sx+24, ry+62, sw-48, 42, "更换头像", filled=False)

parts.append('</svg>')

with open("D:/MY-WEB/prototype.svg", "w", encoding="utf-8") as f:
    f.write("\n".join(parts))
print("wrote D:/MY-WEB/prototype.svg", len("\n".join(parts)), "bytes")
