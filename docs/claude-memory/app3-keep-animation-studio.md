---
name: app3-keep-animation-studio
description: "App 3 = Animation Studio 1.31.8 của người dùng; không được bỏ chức năng nào, chỉ thêm qua bridge/adapter"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 11be8693-7072-4bca-96c4-df2b88ac30aa
  modified: 2026-10-21T05:38:14.074Z
---

Người dùng (2026-10-21, khi bắt đầu App 3): "ko được bỏ chức năng của tôi". App 3 dựa trên Animation Studio 1.31.8 (HTML 9 MB nhúng iframe ở `apps/studio/public/animation-studio/v1.31.8`, nguồn module ở `C:\Users\Administrator\Documents\Codex\2026-10-09\animation-studio\...\material_alpha_v1_31_8\src`).

**Why:** đây là app họ tự làm, nhiều chức năng (control rig/IK, joint limits, skin shape, dual editor, onion skin, graph/easing, layers, smoothing, motion lab, quick animation, director, scene studio, loader FBX/GLB/BOBJ/WC3 MDX/Reforged/LoL, exporter BVH/FBX/GLB/BOBJ).

Ngoại lệ (người dùng chốt 2026-10-21): **bỏ phần nhập Warcraft trong App 3** (warcraft_loader / warcraft_reforged, MDX/MDL/DDS) vì app khác của họ đã lo; không kiểm/sửa phần đó. Phần ghép xương Warcraft (wc3r) của App 1 vẫn giữ.

**How to apply:** không viết lại, không port bỏ bớt, không thay bằng Topview editor. Mọi chức năng mới (MCP cho AI, nhận/trả gói shot, xuất BBS) đi qua `host-bridge.js` + broker; artifact HTML chỉ thay bằng bản build mới từ nguồn đã pin, có kiểm đủ chức năng cũ. Liên quan [[three-app-pipeline]].
