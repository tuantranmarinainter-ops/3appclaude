# 1.1.1 / 1.1.3 / 1.3.3 — Shell và chuyển workspace

## Mục tiêu / nguồn
Giữ workbench và Studio overlay của Topview; thêm selector Retarget–Scene–Animation trong overlay. Entry hiện có: editor/apps/studio/app/workbench/WorkbenchClient.tsx, components/StudioOverlay.tsx, src/LocalHostAdapter.ts. Scene mount DirectorStudio từ public package. Không tạo ba route/project độc lập. Tích hợp mới ở host, nghiệp vụ ở package tương ứng.

## Luồng / Input/Output
Input: shared snapshot/revision, selection, workspace đích. Output: cùng projectId, UI workspace mới, selection phù hợp. Project mới mở Scene; mở lại dùng preference gần nhất. Sidebar trái cây chức năng, viewport giữa, inspector phải, timeline dưới; desktop1366×768 và1920×1080.

| Trạng thái | Hành vi chuyển workspace |
| --- | --- |
| Idle | Dừng playback, giữ playhead; lưu UI preference, unmount viewport cũ rồi mount mới. |
| Drag/text chưa commit | Kết thúc gesture hợp lệ thành1command; text lỗi giữ focus/báo lỗi; Escape hủy gesture. |
| Retarget preview chưa Apply | Giữ native draft theo sessionId, badge chưa áp dụng; không tự bake. Đóng project hỏi lưu draft hoặc bỏ; draft không thay motion đã commit. |
| Bake/render/export đang chạy | Cho chuyển; job đọc snapshot cố định; attach kết quả dùng CAS/revalidation. |
| Asset load/WebGL context lỗi | Retry hoặc đổi workspace được; không thay bằng project rỗng. |

Selection dùng CharacterID/NodeID/MotionID/ClipID, không dùng index. Chọn camera/prop rồi sang Animation hiển thị yêu cầu chọn character, không tạo rig giả. Retarget nhận character làm target; source/target không tự tráo.

## UI / module / API
Một viewport active; dispose listeners/timers/GPU khi unmount, host cache CPU/assets theo AssetID. UI preference giữ panel widths/tree/camera navigation/playhead/selection; model/motion chỉ qua command. Ctrl+Z/Shift+Ctrl+Z/Ctrl+Y dùng history global; input text dùng undo text trước commit. Space playback không chặn nhập liệu.

Trong unified shell giai đoạn C, shortcut undo/redo được chuyển ở capture phase sang project history; sự kiện khi focus trong input, textarea, select, editable content hoặc IME composition được để nguyên. Chưa kiểm tương tác bàn phím với viewport thật; HISTORY-01 vẫn chờ chạy app và nghiệm thu.

Shell tiếng Việt mặc định; giữ locale nguồn và fallback của panel native. Không xóa dictionary cũ hoặc áp quy tắc chỉ tiếng Trung.

Interface workspace adapter mới: snapshot, dispatch(Command), resolveAsset(AssetID), subscribeRevision, selection, setSelection, dispose. Host nối callbacks/saveDocument hiện có vào shared commands, không đổi public HostAdapter của builder. Callback giữ revision khi gesture bắt đầu; stale -> rollback preview/refresh. Không lồng history provider thứ hai.

## Lỗi / nghiệm thu / tác động
UI-01, UI-02, HISTORY-01 trong [acceptance](../acceptance.yaml): chuyển vòng20lần, giữ2character/camera/timeline/draft, không tăng revision vì chuyển, không nhân listener/canvas. Reuse logic nguồn; shell mới vì3UI độc lập. Pose creation chỉ ở Animation, không đưa lại Retarget.
