---
name: per-character-base-model
description: "Mỗi nhân vật thư viện có base model (mesh + xương) riêng, không dùng chung dù file giống hệt; tạo ngay từ bước nhập nhân vật đích ở App 1"
metadata:
  node_type: memory
  type: project
  originSessionId: 11be8693-7072-4bca-96c4-df2b88ac30aa
  modified: 2026-10-24T02:10:23.787Z
---

Người dùng chốt 2026-10-24: mỗi nhân vật (Hero, Đen, Gà, Chi Chi, Người bí ẩn, Gỗ Xưa, Tiểu Nhị, Chirity…) phải có **base model riêng** về mesh và xương,
kể cả khi file model giống hệt nhau (Gỗ Xưa/Tiểu Nhị cùng .bobj; 5 nhân vật Minecraft cùng khung xương).

**Why:** sau này mỗi nhân vật có thể nâng cấp theo hướng khác nhau; dùng chung base model sẽ kéo theo lỗi (đã gặp: Gỗ Xưa bị mặc texture tím của Tiểu Nhị vì chung base).

**How to apply:** khi App 1 "Thêm nhân vật đích" / tạo nhân vật thư viện thì tạo base model riêng cho nhân vật đó (không khử trùng theo SHA giữa các nhân vật);
lệnh migrate base model cũng tách mỗi nhân vật một base. Liên quan [[main-characters]].
