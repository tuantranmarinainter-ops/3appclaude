---
name: w01-browser-check
description: Kiểm thay đổi của W01 trong trình duyệt thật (App 2 Dựng cảnh, App 3 Animation trong iframe, bảng Xuất film) và gửi ảnh bằng chứng cho người dùng. Dùng sau khi sửa bất cứ thứ gì người dùng nhìn thấy, khi người dùng nói "chụp ảnh test", "cho link test", "xem thử", hoặc trước khi báo một tính năng UI là xong. Có sẵn đoạn JS để chuyển workspace, mở timeline, chọn nhân vật, mở shot, chỉnh cài đặt App 3.
---

# Kiểm trên trình duyệt W01

Người dùng tự test bằng mắt và hay xem từ điện thoại. UI hiện ra chưa phải là PASS. Bằng chứng là: đã bấm đúng luồng người dùng sẽ
bấm, đọc được trạng thái/số liệu, và có ảnh.

## Quy trình
1. **Bản thử an toàn**: chỉ kiểm trên server dùng bản sao project + thư viện (skill `w01-test-sandbox`). Ghi vào bản sao thì được,
   ghi vào kho thật thì không.
2. **Tab riêng**: trình duyệt dùng chung giữa các agent. Mở tab mới cho mình, đừng điều hướng tab người khác đang dùng.
   Thấy tab tự đổi trang thì có agent khác đang dùng: chờ họ xong.
3. **Kích thước**: đặt khung 1600×900 khi cần ảnh rõ. Ảnh chụp có thể bị thu nhỏ một nửa, nên toạ độ click phải tính theo khung của ảnh.
   Xong thì trả lại kích thước mặc định.
4. **Điều khiển**: ưu tiên click thật (người dùng cũng click). Dùng JS trong `references/snippets.md` để chuyển nhanh tới trạng thái
   cần kiểm (chuyển workspace, chọn nhân vật, set khoảng frame, mở shot, chỉnh onion…). Mỗi lệnh JS nên xong trong khoảng 40 giây.
5. **Đọc kết quả bằng chữ** trước khi tin ảnh: `[role=status]`, `[role=alert]`, title của dải trộn, giá trị ô. Ảnh chụp ngay sau thao tác
   đôi khi chưa kịp vẽ. Thấy lạ thì chụp lại.
6. **Ảnh bằng chứng**: chép ảnh vào `S:\Claude\w01\work\<chủ-đề>\<số>-<mô-tả>.jpg` (thư mục `work/` không commit), đặt tên tiếng Việt
   không dấu dễ hiểu. Gửi người dùng kèm chú thích từng ảnh (đúng cái gì, ở đâu). Chỉ cần một vùng thì dùng chế độ zoom vùng.
7. **Báo cáo**: đạt/không đạt từng mục, điều chưa kiểm (vd "chưa bấm Xoá vì ô thư mục game trỏ Minecraft thật").

## Hay quên
- App 3 hiện bảng nổi kiểu `<details>`: click hai lần là đóng lại. Mở bằng `.open = true` cho chắc.
- Khoảng frame F3 tự lấp theo chuỗi clip của nhân vật (#204). Đặt tay thì phải đặt sau khi chọn nhân vật.
- Lỗi console của trang lớn chỉ đọc được ở trang App 2. Lỗi trong iframe App 3 thì kiểm bằng cách đọc DOM/trạng thái.
- Gợi ý "Phím tắt" của App 2 có thể che góc trái khung 3D, đừng nhầm là lỗi.
