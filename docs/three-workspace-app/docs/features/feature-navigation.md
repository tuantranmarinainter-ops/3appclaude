# 1.1.2 — Cây chức năng và tìm kiếm

## Mục tiêu / I/O
Input: [manifest development](../inventory/development.yaml), locale, capabilities, selection, query. Output: tree/kết quả/ancestor và workspace/panel được mở; chọn panel không sửa project. Dùng ID đích LISTCODE, không lấy số module nguồn trùng nhau.

Manifest leaf: id,parentId,label,keywords:string[],workspace,panelId,command?:string,requires:string[],spec. Group lấy ARCHITECTURE. Panel ID được định nghĩa trong development.yaml, đăng ký khi triển khai; command phải có trong commands-v1 hoặc public action nguồn.

## Luồng / UI
1. Validate unique ID, parent, panel registry. Manifest lỗi phải báo ID, không bỏ chức năng âm thầm.
2. Tìm label/keywords/ID không phân biệt hoa thường/dấu tiếng Việt; giữ label gốc. Query rỗng phục hồi expand state trước tìm.
3. Kết quả giữ ancestor, sort theo thứ tự cây (không lexical1.10 trước1.2). Expand/collapse all tác động nhánh hiện; search không ghi đè preference.
4. Enter/click mở workspace qua shell, mở panel, focus heading. Chức năng thiếu character/rig vẫn hiện disabled kèm lý do/cách chọn asset.
5. Mutation chỉ chạy từ form/action có validation trong panel; mở kết quả không tự export hoặc sửa scene.

Ô tìm có clear/số kết quả; tree có collapse/expand và workspace badge. ARIA tree/treeitem, aria-expanded, roving tabindex; click target>=32px. Up/Down di chuyển, Left collapse/parent, Right expand/child, Home/End đầu/cuối; Escape xóa query rồi trả focus; Ctrl+K mở palette, không cướp shortcut input đang edit.

## API / lỗi
Host giữ UI registry; shared chỉ type/validator. Unknown panel/command, orphan/duplicate ID là lỗi docs/build. Capability thiếu được giải thích; không tự cài tool. Không cần virtualize cây nhỏ; giữ keyboard/accessible labels.

## Nghiệm thu / tác động
NAV-01 trong [acceptance](../acceptance.yaml): “xuong”, “xương”, “camera”, “1.3.2”; ancestor đúng, focus/selection giữ, clear khôi phục trạng thái, keyboard hoạt động. Mục2.* có mặt trong tài liệu/chẩn đoán, không biến test/release thành nút sửa scene. Thêm chức năng cập nhật manifest/LISTCODE/spec cùng ID.
