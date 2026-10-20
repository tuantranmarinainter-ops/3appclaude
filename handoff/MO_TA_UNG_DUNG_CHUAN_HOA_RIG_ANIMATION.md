# Ứng dụng độc lập — Chuẩn hóa Rig & Animation

Tài liệu mô tả sản phẩm mong muốn khi tách Workspace 1 thành một ứng dụng riêng để người dùng quản lý nguồn, mapping, chuyển đổi và đầu ra trong một nơi. Nội dung xác định chức năng và hành vi của ứng dụng; không phải gói cài đặt phần mềm.

## 1. Mục đích

Ứng dụng tiếp nhận mô hình có rig và animation từ nhiều nguồn, chuyển chuyển động về skeleton chuẩn Mixamo 65, cho phép gán animation lên nhân vật tương thích khác, kiểm tra kết quả và xuất dữ liệu sử dụng bên ngoài.

Đây là Universal Animation Retargeting Engine: skeleton nguồn được mô tả bằng graph và dữ liệu chuyển động, không bị khóa vào một số mẫu nhân vật hoặc một số lượng xương định sẵn. Mô hình 115 xương chỉ là một ví dụ; nguồn có thể có số lượng xương, tên và hierarchy khác nhau. Skeleton đích chuẩn có 65 joint theo manifest Mixamo 65, gồm tên, quan hệ cha–con, vai trò và quy ước rest pose. Node chứa scene, mesh và container không được tính vào 65 joint này.

Ứng dụng giữ dữ liệu gốc, tạo kết quả chuyển đổi riêng và cho người dùng xem rõ phần nào được chuyển, phần nào không biểu diễn được trên skeleton đích. Nhập được file, retarget được chuyển động và chuyển được mesh/skin là ba khả năng được báo riêng.

## 2. Hình thức sử dụng và công nghệ

Ứng dụng chạy local trên PC, mở giao diện bằng trình duyệt và sử dụng dịch vụ local để quản lý project, đọc/ghi file và thực thi các lệnh. Người dùng có thể sử dụng nó độc lập với ứng dụng dựng cảnh hoặc trình chỉnh sửa animation khác.

| Lớp | Ngôn ngữ / công nghệ | Trách nhiệm |
| --- | --- | --- |
| Logic chính | TypeScript | Quy tắc dữ liệu, mapping, calibration, retarget, quản lý thao tác và API |
| Giao diện | React | Cây nguồn, bảng mapping, panel thông số, trình xem báo cáo và điều khiển preview |
| Framework ứng dụng | Next.js | Giao diện trình duyệt và API của dịch vụ local |
| Đồ họa và toán 3D | Three.js | Scene preview, skeleton, mesh, animation sampling, quaternion, matrix và loader/exporter tương ứng |
| Runtime phía host | Node.js | Chạy dịch vụ local và xử lý yêu cầu từ giao diện hoặc CLI |
| Dòng lệnh và điều phối | Python CLI | Gọi các thao tác project, điều phối chuyển đổi local và cung cấp đường tích hợp agent/MCP |
| Bố cục và hiển thị | HTML/CSS qua React | Bố trí panel, thông báo, bảng và tương tác của giao diện |
| Quản lý package | pnpm workspace | Quản lý các package ứng dụng và thư viện dùng chung trong sản phẩm độc lập |
| Lưu dữ liệu | JSON và file binary theo manifest/hash | Project, cấu hình, mapping, calibration, nguồn và kết quả chuyển đổi |

Nền công nghệ được kế thừa từ Topview. Mốc khai báo trong mã nguồn tham chiếu là TypeScript 5.3.3, React ^18.2.0, Next.js 15.1.9, Three.js ^0.184.0 và Python từ 3.11. Đây là các phiên bản tham chiếu, không phải tuyên bố về phiên bản mới nhất của thư viện.

Engine retarget sử dụng TypeScript và phép toán Three.js. Python phụ trách dòng lệnh, điều phối và kết nối công cụ local; không mặc định chuyển toàn bộ thuật toán retarget sang Python. Công cụ chuyển đổi ngoài chỉ tham gia khi định dạng nguồn cần đến chúng, với yêu cầu và giới hạn được hiển thị rõ.

## 3. Phạm vi độc lập

Ứng dụng có project riêng, danh mục tài nguyên riêng, cấu hình riêng, lịch sử chỉnh sửa riêng và thư mục đầu ra riêng. Mở ứng dụng không yêu cầu khởi động workspace dựng cảnh hoặc trình tạo animation.

Các phần thuộc ứng dụng gồm: nhập nguồn, kiểm tra rig, bone mapping, calibration, chuẩn hóa animation, chuẩn hóa model/skin, Animation Assignment, preview, báo cáo, quản lý project và import/export.

Dựng bối cảnh hoàn chỉnh, bố trí đạo cụ, thiết kế camera/shot và biên tập phim thuộc ứng dụng bên ngoài. Việc tạo pose hoặc biên tập keyframe chuyên sâu thuộc trình chỉnh sửa animation. Ứng dụng chuẩn hóa có công cụ chọn tư thế tham chiếu và xem chuyển động để phục vụ retarget, không tự đưa lại pose editor đã được gỡ khỏi Retarget.

Kết nối với Scene hoặc hệ thống BBS sử dụng dữ liệu xuất hay giao diện trao đổi rõ ràng. Tích hợp bên ngoài không làm project chuẩn hóa phụ thuộc vào trạng thái đang mở của các ứng dụng khác. Xuất Film native BBS là phạm vi của bộ tích hợp Film, không mặc định coi file GLB hoặc manifest nhân vật là Film native.

## 4. Nguồn rig và định dạng

Các hệ nguồn được hướng tới gồm iClone/Character Creator, Maya, UE4/UE5 Mannequin, MetaHuman, Unity Humanoid/Generic, Sketchfab, Warcraft III, World of Warcraft, Liên Minh Huyền Thoại, Mixamo, Blender, Dota và rig tùy chỉnh.

Tên phần mềm hoặc trò chơi không xác định khả năng đọc file. Mỗi nguồn đi qua một trong các đường sau:

- Đọc trực tiếp bằng adapter của định dạng được hỗ trợ.
- Xuất từ phần mềm nguồn sang định dạng trung gian phù hợp.
- Chuyển đổi bằng công cụ local riêng, có ghi nguồn gốc và báo cáo mất dữ liệu.

FBX và GLB/glTF là các định dạng trao đổi chính. Với glTF có tài nguyên ngoài, ứng dụng phải kiểm tra đủ file phụ hoặc yêu cầu gói tài nguyên phù hợp. Không tự coi `.uasset`, `.ma`, `.mb`, `.iMotion` hay định dạng game độc quyền là định dạng có thể mở trực tiếp.

RigGraph lưu identity của node, tên hiển thị, parent, bind/rest transform, trục, đơn vị và thông tin deform. Animation có danh sách Action, channel, thời gian và bộ lấy mẫu tương ứng. Xương trùng tên vẫn được phân biệt bằng identity/path.

Nguồn nhiều skeleton cho phép chọn skeleton cần xử lý. Các node cha ảnh hưởng đến chuyển động phải được giữ trong phép tính, kể cả khi chúng không phải deform bone. Constraint/IK cần được đánh giá hoặc bake bằng công cụ phù hợp trước khi chuyển đổi nếu adapter không giải được chúng.

Rig phi humanoid, khuôn mặt, morph, shear, scale động hoặc chuyển động phụ không thể tự động quy về humanoid 65 một cách chính xác. Ứng dụng phải nêu khả năng hỗ trợ, cho chọn cách xử lý hoặc chặn thao tác khi không có cách bảo toàn hợp lệ.

## 5. Quy trình sử dụng tổng thể

```text
Tạo / mở project độc lập
          ↓
Nhập model hoặc rig + animation
          ↓
Kiểm tra nguồn → chọn skeleton → chọn Action
          ↓
Mapping xương → chọn reference pose → calibration
          ↓
Chuẩn hóa animation về Mixamo 65
          ↓
    ┌───────────────────────┬─────────────────────────────┐
    │ Animation Only        │ Model + Rig + Animation     │
    │                       │                             │
    │ Gán sang nhân vật khác│ Fit rig và chuyển skin      │
    └───────────────────────┴─────────────────────────────┘
          ↓
Preview và xem báo cáo
          ↓
Lưu kết quả riêng / xuất file / chuyển sang ứng dụng Scene
```

Animation-only không bắt buộc có mesh, nhưng phải có skeleton/rest và dữ liệu chuyển động đủ để tính retarget. Nhánh Model + Rig + Animation yêu cầu thêm mesh, skin và dữ liệu bind hợp lệ.

## 6. Nhập và kiểm tra nguồn

Sau khi nhập, người dùng xem được cây Node/Bone, skeleton được chọn, mesh/submesh, material, texture, UV, skin influences và danh sách Action. Mỗi Action có tên, độ dài, phạm vi thời gian và thông tin channel.

Ứng dụng xác định trục và đơn vị, kiểm tra parent bị thiếu, vòng lặp hierarchy, matrix không hợp lệ, dữ liệu skin sai, thiếu tài nguyên và channel không hỗ trợ. Lỗi của một Action phải được trình bày riêng để người dùng còn xem và lựa chọn Action khác đủ điều kiện.

Giới hạn xử lý dựa trên kích thước file, node/channel, số mẫu, bộ nhớ và thời gian. Khi vượt giới hạn, ứng dụng giải thích nguyên nhân và khả năng giảm phạm vi xử lý; không cắt bớt xương hoặc frame âm thầm.

## 7. Bone Mapping

Mapping liên kết xương nguồn với 65 joint đích. Gợi ý dựa trên tên, hierarchy và hình học/rest pose phải thể hiện độ tin cậy và trường hợp mơ hồ. Người dùng có thể sửa từng cặp, tìm xương theo tên/path, kiểm tra trái/phải và chọn xương cần thiết.

Một joint đích có thể nhận chuyển động từ một xương hoặc một chain nguồn theo một nhánh cha–con. Người dùng xem thứ tự contributor, trọng số và cách kết hợp chuyển động:

- **World average:** kết hợp các delta xoay trong world bằng trọng số tương đối không âm. Giá trị 0 loại ảnh hưởng xoay của contributor đó.
- **Local compose:** kết hợp delta xoay cục bộ theo thứ tự tổ tiên đến con, đưa về hệ tham chiếu thống nhất và tránh tính lặp chuyển động chung của cha. Trọng số biểu diễn mức áp dụng góc trong khoảng 0–1.

Đổi chế độ phải làm rõ sự khác nhau về ý nghĩa trọng số và yêu cầu rà soát giá trị mới. Không diễn giải lại vector trọng số cũ mà không thông báo. Cấu trúc chain lỗi, nhánh không phù hợp, contributor thiếu dữ liệu hoặc ảnh hưởng bị tính chồng phải được phát hiện trước khi chạy.

Mapping preset lưu tên/identity có thể đối chiếu, mode, trọng số và fingerprint liên quan. Khi dùng preset cho rig khác, ứng dụng đưa ra kết quả khớp tên và danh sách mơ hồ, không tự coi mapping đó đã chính xác.

## 8. Calibration và reference pose

Calibration điều chỉnh khác biệt A-pose/T-pose, hướng trục, hướng xương, tỷ lệ và tư thế cơ sở giữa nguồn và đích. Người dùng chọn rest pose hoặc một frame của Action làm reference pose phù hợp.

Giao diện cho xem nguồn–đích, căn chỉnh toàn cục, correction theo role, đặt lại giá trị và quản lý cấu hình đã lưu. Reference pose và calibration gắn với đúng nguồn, skeleton và mapping; thay dữ liệu liên quan phải được phát hiện trước khi tái sử dụng.

Khác chiều dài tay/chân hoặc tỷ lệ cơ thể cần được xử lý riêng với căn trục. Các lựa chọn về chân chạm đất, điểm đặt tay và end effector phải thể hiện rõ chúng giữ đặc điểm nào của chuyển động và có thể thay đổi pose ra sao.

## 9. Retarget và quản lý Action

Engine lấy mẫu Action nguồn theo thời gian, tính chuyển động tương đối với reference, chuyển qua mapping/calibration rồi tái lập local/world transform trên hierarchy Mixamo 65. Kết quả được bake thành một Motion mới.

Người dùng chọn Action, phạm vi thời gian, FPS lấy mẫu và chế độ đầu ra. Khi xử lý nhiều Action, từng mục giữ tên, nguồn, range, cấu hình và báo cáo riêng. Không tự đổi tốc độ chuyển động theo tốc độ phát preview.

Root motion có chủ sở hữu rõ ràng. Di chuyển có thể nằm trong skeleton, được giữ thành trajectory để ứng dụng nhận sử dụng hoặc loại khỏi vị trí phát để tạo in-place. Các cách biểu diễn không được cộng cùng một displacement hai lần. Giữ khoảng cách theo mét là quy ước mặc định của chuyển đổi; scale theo tỷ lệ phải là lựa chọn rõ ràng.

Motion đầu ra giữ liên kết đến Action nguồn và cấu hình tạo ra nó. Action gốc không bị ghi đè. Channel bị bỏ, thay đổi nội suy hoặc sai lệch do lấy mẫu phải được phản ánh trong báo cáo.

## 10. Model, rig đích và skin

Nhánh Model + Rig + Animation tạo nhân vật dùng skeleton Mixamo 65 cùng chuyển động đã chuẩn hóa. Rig đích được fit theo mapping, tỷ lệ và reference của model nguồn; dữ liệu bind/inverse-bind được tính phù hợp với skeleton mới.

Skin transfer ưu tiên dùng influence sẵn có: chuyển source joint sang target owner, cộng các influence cùng owner và chuẩn hóa tổng weight. Nếu đầu ra giới hạn số influence ít hơn nguồn, phải đo lượng weight bị bỏ và những vertex chịu ảnh hưởng.

Người dùng xem hình dạng ở rest pose và khi phát animation. Báo cáo phân biệt sai lệch rig, sai lệch rest mesh, mất skin weight và sai lệch biến dạng động. Quyết định áp dụng đầu ra nằm sau bước xem báo cáo.

Với cánh, đuôi, twist/helper và phụ kiện, việc không retarget một bone không tự xóa dữ liệu nguồn. Các cách xử lý được trình bày rõ: chuyển influence về owner đích, biến phần phù hợp thành rigid attachment hoặc loại phần mesh khi người dùng chọn riêng. Thiếu owner hợp lệ hoặc vertex mất toàn bộ ảnh hưởng phải chặn xuất. Không thêm joint thứ 66 vào skeleton chuẩn chỉ để giữ một phụ kiện.

## 11. Animation Assignment

Animation Assignment là khu vực con để chọn một Motion chuẩn hóa và gán lên nhân vật Mixamo 65 khác. Người dùng chọn nhân vật nhận, Action, phạm vi, cách thêm hoặc thay thế và chính sách root motion.

Cùng topology 65 không có nghĩa cùng rest pose, chiều dài chi hoặc fingerprint. Nếu khác biệt ảnh hưởng playback, ứng dụng tạo derivative phù hợp với nhân vật nhận thay vì bỏ qua kiểm tra tương thích.

Thao tác thay animation trên một nhân vật không được làm đổi Motion nguồn hay animation của nhân vật khác đang dùng chung tài nguyên. Người dùng có thể preview trên nhân vật nhận, so sánh với chuyển động chuẩn hóa và hoàn tác thao tác gán.

## 12. Bố cục giao diện

| Khu vực | Nội dung |
| --- | --- |
| Thanh trên | Project đang mở, lưu/mở, nhập, xuất, Undo/Redo và cấu hình |
| Cột trái | Asset, skeleton, cây Node/Bone và tìm kiếm/thu gọn/mở rộng |
| Trung tâm | Hai viewport nguồn–đích, đồng bộ thời gian, mesh/skeleton overlay, camera xem và reset góc nhìn |
| Cột phải | Mapping, calibration, chain mode, skin owner và thông tin phần tử đang chọn |
| Phía dưới | Action list, play/pause, scrub thời gian, range, FPS và tiến độ xử lý |
| Khu vực báo cáo | Lỗi, cảnh báo, danh sách phần không chuyển được, sai lệch và kết quả xuất |

Giao diện giữ phong cách Topview: panel gọn, thao tác thống nhất, lựa chọn đang có hiệu lực dễ nhận biết. Chọn một xương trong cây liên kết tới hàng mapping và phần hiển thị 3D tương ứng. Những quyết định làm mất chuyển động hoặc skin phải có phần giải thích gần thao tác liên quan.

Các khu vực chính của ứng dụng là Nguồn, Mapping & Calibration, Chuẩn hóa, Model & Skin, Assignment và Xuất. Thông số và lựa chọn phải được giữ khi chuyển khu vực trong cùng project.

## 13. Project và dữ liệu độc lập

Project lưu Asset, SkeletonProfile, Mapping, ReferencePose, Calibration, Action/Motion, Character nhận, báo cáo, cấu hình xuất và lịch sử thay đổi. AssetID nhận diện tài nguyên; CharacterID nhận diện từng nhân vật sử dụng tài nguyên đó. Hai nhân vật có thể dùng cùng model mà vẫn có cấu hình gán chuyển động riêng.

Nguồn binary được lưu hoặc tham chiếu có kiểm soát, kèm hash để phát hiện thay đổi. Kết quả chuyển đổi là derivative mới có liên kết về nguồn và thông số tạo ra. Đường dẫn trên máy không được dùng làm danh tính duy nhất của tài nguyên.

Lưu/mở project phải khôi phục mapping, calibration, Action đang chọn và dữ liệu cần để tái tạo kết quả. Project có version/schema để đọc dữ liệu cũ bằng chuyển đổi riêng, giữ bản gốc và thông báo dữ liệu không chuyển được.

Undo/Redo bao phủ các thay đổi của project. Tác vụ xử lý chỉ tạo kết quả tạm cho đến khi người dùng lưu hoặc áp dụng. Kết quả tính từ revision cũ phải được phát hiện trước khi ghi vào project hiện tại.

## 14. API, CLI và kiểm soát xử lý

Giao diện, Python CLI và tích hợp agent/MCP sử dụng cùng quy tắc command, validation, revision và lưu dữ liệu. Mỗi lệnh mô tả rõ input, output và lỗi; CLI không tạo đường ghi project bỏ qua kiểm tra của giao diện.

Các nhóm thao tác gồm quản lý project/asset, inspect rig, quản lý mapping/calibration, tạo cấu hình chuyển đổi, thực thi/hủy/xem kết quả, Assignment và export. Người dùng thấy trạng thái tác vụ đang chờ, đang chạy, hoàn tất, thất bại hoặc bị hủy, cùng tiến độ có căn cứ và thông báo lỗi cụ thể.

Hủy xử lý không làm hỏng nguồn hoặc project đang lưu. Chạy lại cùng một yêu cầu phải tránh tạo dữ liệu trùng không chủ ý. Công cụ ngoài chỉ nhận tài nguyên và quyền cần cho phép chuyển đổi đã chọn.

## 15. Đầu ra và kết nối bên ngoài

Ứng dụng cung cấp hai nhóm đầu ra: Animation Only có skeleton/reference phù hợp để tái sử dụng; và Model + Mixamo 65 Rig + Animation có mesh, skin, material/texture và Actions tương ứng. GLB là định dạng đóng gói chính; các lựa chọn khác chỉ xuất hiện khi exporter tương ứng có khả năng bảo toàn dữ liệu cần thiết.

Gói đầu ra kèm manifest hoặc báo cáo mô tả rig, trục, đơn vị, thời gian, root-motion policy, tài nguyên phụ và nguồn gốc chuyển đổi. Khi xuất Animation Only, phải đủ thông tin để ứng dụng nhận xác định nhân vật tương thích hoặc thực hiện Assignment.

Việc chuyển sang ứng dụng dựng Scene có thể dùng file xuất hoặc API trao đổi. Ứng dụng nhận tạo Character/Motion từ dữ liệu này; project chuẩn hóa vẫn có thể mở và quản lý độc lập. Material, texture, timing và chuyển động cần được đánh giá sau khi xuất và đọc lại, không chỉ trước export.

## 16. Báo cáo và minh bạch dữ liệu

Mỗi kết quả gắn với nguồn, skeleton, mapping, calibration, Action, range, FPS và phiên bản adapter/engine. Người dùng có thể xem lại báo cáo sau khi đóng và mở project.

Báo cáo gồm số xương nguồn/đích, tỷ lệ mapping trên tập xương được xác định rõ, role quan trọng còn thiếu, bones/channels không chuyển được, chính sách xử lý phần phụ, sai lệch rotation/root/độ dài đoạn, ảnh hưởng skin và tính toàn vẹn tài nguyên xuất.

Các chỉ số nhất quán toán học được phân biệt với đánh giá chất lượng chuyển động. Sai số nhỏ trong phép tính không tự chứng minh bàn chân không trượt, pose hợp lý hoặc mesh biến dạng đẹp. Những kết luận cần tham chiếu độc lập phải có dữ liệu tham chiếu phù hợp.

## 17. Nhóm tương thích Retarget

Ứng dụng giữ nhóm tương thích cho thư viện 85 clip Minecraft, Metarig, Mixamo 65 và Minecraft20 cùng các đường mapping/calibration, chỉnh motion, root motion, lưu project và import/export liên quan. Minecraft25 không thuộc phạm vi này.

Nhóm tương thích được đặt riêng trong giao diện để người dùng chọn đúng pipeline. Universal normalization sử dụng Mixamo 65 làm đích chuẩn; các chuyển đổi Mixamo 65 ↔ Minecraft20 là đường tương thích có hợp đồng riêng, không được dùng để giới hạn graph nguồn của universal engine.

## 18. Nguyên tắc kiểm soát của người dùng

- Luôn giữ model, rig và Action nguồn; các kết quả chỉnh sửa/chuyển đổi được lưu riêng.
- Hiển thị cấu hình ảnh hưởng đến chuyển động, root motion, skin và dữ liệu đầu ra trước khi áp dụng.
- Không bỏ âm thầm bone, channel, Action, texture hoặc influence không xử lý được.
- Cho phép xem lại mapping, calibration, nguồn gốc và báo cáo của từng kết quả.
- Không tự tải tài nguyên dự án lên dịch vụ ngoài; mọi kết nối ngoài phải có mục đích và lựa chọn rõ ràng.
- Cho phép quản lý project độc lập và trao đổi dữ liệu với các ứng dụng khác qua định dạng/API xác định.
- Bảo toàn chức năng có ý nghĩa của nguồn Retarget, đồng thời giữ riêng trách nhiệm chuẩn hóa, dựng cảnh và biên tập animation.
