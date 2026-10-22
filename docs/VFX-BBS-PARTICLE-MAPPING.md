# App 4 VFX — Ánh xạ Effekseer → particle BBS FS 2.7 (hướng 2)
Ngày: 2026-10-22. Trạng thái: DRAFT đặc tả, **chưa có converter, chưa kiểm trong game**.
Quyết định (người dùng chốt, `docs/DECISIONS.md`): đưa VFX vào BBS FS bằng cách chuyển sang particle Snowstorm JSON của BBS,
phát native; tính năng không hỗ trợ thì chặn hoặc cảnh báo khi xuất. Đích là **BBS FS 2.7**; hướng addon AAA chỉ khảo sát.

Blend Add (người dùng chốt 2026-10-22): xuất kèm cảnh báo, không chặn; fallback blend alpha + tăng sáng màu (§3).
Viết code (converter và các bước sau): giao Codex. Session Windows chỉ chạy phần cần máy thật (DLL Effekseer, render, thử BBS FS) và review PR.

## 1. Nguồn đã đọc (chỉ đọc, không build)
- BBS FS: `C:\Users\Administrator\Documents\ChatGPT\BBS MINECRAFT\.build-tools\bbs-fs-1.20.1`, commit `998c9d5`
  (`mod_version=2.7`, Minecraft 1.20.1, Fabric). File: `particles/ParticleParser.java`, `ParticleMaterial.java`,
  `ParticleCurveType.java`, `particles/components/**`, `particles/emitter/ParticleEmitter.java`,
  `forms/forms/ParticleForm.java`, `TrailForm.java`, `forms/renderers/ParticleFormRenderer.java`, `BBSMod.java`,
  mẫu `assets/bbs/assets/particles/default_placeholder.json`.
- Effekseer: cây thuộc tính của EffekseerCore 1.80.6 qua `effekseer-ai property-list` (các panel `CommonValues`,
  `LocationValues`, `RotationValues`, `ScalingValues`, `LocationAbsValues`, `GenerationLocationValues`,
  `RendererCommonValues`, `DrawingValues`, …).

## 2. BBS FS 2.7 phát particle thế nào
| Mục | Thực tế trong mã 2.7 |
| --- | --- |
| Định dạng | JSON kiểu Bedrock/Snowstorm: `format_version` (không kiểm), `particle_effect.description` (`identifier`, `basic_render_parameters.material/texture`), `curves`, `components` (tiền tố `minecraft:` tùy chọn). Component lạ bị **bỏ qua im lặng**. |
| Vị trí file | `<game>/config/bbs/assets/particles/<id>.json` (`ParticleManager` → `BBSMod.getAssetsFolder()/particles`). Texture: link `assets:<path>` trong `<game>/config/bbs/assets/`. |
| Gắn vào film | `ParticleForm` (`effect` = id scheme, `texture` ghi đè, `paused`, `user1..6` cho MoLang). Form gắn actor; gắn xương qua `BodyPart.bone`. Một form = **một emitter** = một scheme. |
| Material | Chỉ 3: `particles_opaque`, `particles_alpha` (cắt alpha), `particles_blend` (`defaultBlendFunc` = SRC_ALPHA, 1−SRC_ALPHA). **Không có cộng sáng (additive), trừ, nhân, distortion.** |
| Curve | `linear`, `catmull_rom`. Không có bezier. |
| Thời gian | Emitter cập nhật theo tick **20 Hz**, nội suy khi vẽ. Biến MoLang theo giây (`age/20`). |
| Tua/seek | Không có seek: emitter mô phỏng liên tục; chỉ **khởi động lại** khi keyframe `paused` chuyển true→false. Ngẫu nhiên dùng `Math.random()` → hai lần chạy không giống hệt. |
| Component có | Emitter: `emitter_local_space`, `emitter_initialization`, `emitter_rate_instant/steady`, `emitter_lifetime_looping/once/expression`, `emitter_shape_point/sphere/disc/box/entity_aabb`. Particle: `particle_lifetime_expression`, `particle_expire_if_in/not_in_blocks`, `particle_kill_plane`, `particle_appearance_billboard` (size, `facing_camera_mode`, uv, `flipbook`), `particle_appearance_tinting` (màu/gradient + interpolant), `particle_appearance_lighting`, `particle_initial_speed`, `particle_initial_spin`, `particle_motion_dynamic`, `particle_motion_parametric`, `particle_motion_collision`. |
| Hướng billboard | `rotate_xyz`, `rotate_y`, `lookat_xyz`, `lookat_y`, `direction_x/y/z`, `derive_from_velocity`, `custom_direction`. |
| TrailForm | Form riêng: `texture`, `length`, `loop`, `paused` — vệt theo chuyển động của form, không phải ribbon theo particle. |

## 3. Bảng ánh xạ
Mức: **OK** chuyển được; **XẤP XỈ** chuyển được nhưng hình khác, xuất kèm cảnh báo; **CHẶN** không xuất node đó
(mặc định từ chối cả hiệu ứng; người dùng có thể cho phép bỏ node kèm cảnh báo).

### Cấu trúc
| Effekseer | BBS 2.7 | Mức |
| --- | --- | --- |
| Effect nhiều node | Mỗi node vẽ được → 1 scheme JSON + 1 `ParticleForm`; gom các form dưới một form cha (anchor) | OK |
| Node `None` (nhóm) ở gốc, transform tĩnh | Cộng transform vào `offset` của các con | OK |
| Node con sinh từ **từng hạt** của node cha (phân cấp) | Không có sub-emitter | CHẶN (trừ cha là `None` tĩnh) |
| Kế thừa vị trí/xoay/tỉ lệ từ cha theo thời gian | `emitter_local_space` chỉ theo form | XẤP XỈ |

### Kiểu vẽ (`DrawingValues/Type`)
| Effekseer | BBS 2.7 | Mức |
| --- | --- | --- |
| Sprite | `particle_appearance_billboard` | OK |
| Ribbon, Track | Không tương đương (TrailForm khác bản chất) | CHẶN |
| Ring | — | CHẶN |
| Model, ProceduralModel | — | CHẶN |
| GPU particles | — | CHẶN |

### Sinh hạt (`CommonValues`)
| Effekseer | BBS 2.7 | Mức |
| --- | --- | --- |
| `MaxGeneration`, `GenerationTime`, `GenerationTimeOffset` | `emitter_rate_steady` (`spawn_rate` = 60 / GenerationTime hạt/giây, `max_particles`) hoặc `emitter_rate_instant` khi sinh cùng lúc; `emitter_lifetime_once.active_time` = MaxGeneration × GenerationTime / 60; `GenerationTimeOffset` (trễ trước hạt đầu) qua `emitter_lifetime_expression.activation_expression` (`variable.emitter_age >= offset`) — chưa kiểm trong game | OK (offset: XẤP XỈ), lượng tử 1/20 s |
| `MaxGeneration/Infinite` | `emitter_lifetime_looping` | OK |
| `Life` (frame, ngẫu nhiên min–max) | `particle_lifetime_expression.max_lifetime` = `math.random(min,max)/60` | OK |
| Kill rules, trigger, dynamic input/equation | `user1..6` có thể dùng sau | CHẶN (giai đoạn này) |
| Sound | — | Bỏ + cảnh báo |

### Vị trí, xoay, tỉ lệ
| Effekseer | BBS 2.7 | Mức |
| --- | --- | --- |
| Location Fixed | `emitter_shape_point.offset` | OK |
| Location PVA (vị trí/vận tốc/gia tốc ± ngẫu nhiên) | shape `offset` + `direction` + `particle_initial_speed` + `particle_motion_dynamic.linear_acceleration` | OK |
| Location Easing | `particle_motion_parametric.relative_position` (biểu thức MoLang theo `particle_age`) | XẤP XỈ (đường easing lấy mẫu) |
| Location FCurve | `curves` linear (lấy mẫu bezier) + parametric | XẤP XỈ |
| Location NURBS, ViewOffset | — | CHẶN |
| Generation location Point/Sphere/Circle | `emitter_shape_point/sphere/disc` | OK |
| Generation location Line | `emitter_shape_box` dẹt | XẤP XỈ |
| Generation location Model | — | CHẶN |
| Attraction: gravity | `linear_acceleration` | OK |
| Attraction: attractive force, vortex, turbulence | — | CHẶN (turbulence: CẢNH BÁO nếu cho bỏ) |
| Rotation quanh trục nhìn (Fixed/PVA) | `particle_initial_spin` (rotation, rotation_rate) | OK |
| Rotation 3D trên billboard không quay về camera | `custom_direction`/`direction_*` | XẤP XỈ |
| Scale Fixed/PVA/Easing/FCurve | `billboard.size` = biểu thức + `curves` | OK (FCurve: XẤP XỈ) |

### Hiển thị (`RendererCommonValues`, `DrawingValues/Sprite`)
| Effekseer | BBS 2.7 | Mức |
| --- | --- | --- |
| Color texture (1 ảnh PNG) | `basic_render_parameters.texture` → chép vào `config/bbs/assets/textures/vfx/<effect>/`, link `assets:` | OK |
| AlphaBlend = Blend | `particles_blend` | OK |
| AlphaBlend = Opacity | `particles_opaque` | OK |
| AlphaBlend = **Add** (phổ biến nhất) | **Không chặn** (người dùng chốt 2026-10-22). Fallback: `particles_blend` (blend alpha) và **tăng sáng màu** để bù. Không cộng dồn, không loá khi chồng nhiều lớp. Mỗi node Add phải có một mục trong `warnings[]` của báo cáo xuất (đường dẫn node, blend gốc, fallback đã dùng). | XẤP XỈ + cảnh báo bắt buộc |
| AlphaBlend = Sub, Mul | — | CHẶN |
| Color Fixed/Random/Easing/FCurve | `particle_appearance_tinting` (solid / gradient + `interpolant`) | OK (FCurve: XẤP XỈ) |
| UV Fixed | `billboard.uv` | OK |
| UV Animation (flipbook) | `billboard.flipbook` (`frames_per_second`, `max_frame`, `loop`, `stretch_to_lifetime`) | OK |
| UV Scroll, Fcurve UV | — | CHẶN |
| Billboard / RotatedBillboard / YAxisFixed / Fixed | `rotate_xyz` / `rotate_xyz`+spin / `rotate_y` / `custom_direction` | OK |
| Distortion, Material (`.efkmat`), texture thứ 2, alpha texture, UV distortion, edge/falloff, soft particle, emissive | — | CHẶN |
| Depth, z-sort, ánh sáng | `particle_appearance_lighting` chỉ có bật/tắt | Bỏ + cảnh báo |

## 4. Đơn vị và hệ trục
- Thời gian: Effekseer 60 frame/giây → giây = frame/60; BBS mô phỏng 20 tick/giây. Sự kiện ngắn hơn 1/20 s bị gộp → cảnh báo
  khi `GenerationTime` < 3 frame hoặc `Life` < 3 frame.
- Độ dài: đề xuất 1 đơn vị Effekseer = 1 block nhân hệ số `scale` của profile; **phải hiệu chuẩn** bằng một mẫu đo
  (vòng tròn bán kính 1) trong BBS 2.7 trước khi chốt. Trục: cả hai Y-up; dấu trục X/Z của Bedrock particle so với
  Effekseer RH cần đo cùng mẫu đó.

## 5. Gate khi xuất (thiết kế)
1. **Cấu trúc**: JSON chỉ dùng component có trong `ParticleParser` 2.7 (bảng §2); không component lạ (BBS bỏ im lặng → phải chặn ở phía mình).
2. **Hỗ trợ**: quét toàn bộ node; một mục CHẶN → từ chối hiệu ứng (exit ≠ 0) và liệt kê đường dẫn node + thuộc tính; XẤP XỈ → ghi `warnings[]`.
3. **Hình ảnh**: render Effekseer gốc (`tools/render_preview.py`) đặt cạnh ảnh của bản BBS — cần đường render BBS (chưa có, xem §6).
4. **Chạy trong BBS FS 2.7** (gate MVP): nạp JSON trong game, đặt `ParticleForm` vào film, chụp ở các tick đã định; PASS chỉ khi có ảnh trong game. Không hiệu ứng nào vào gói BBS FS khi gate này chưa PASS.

## 6. Việc còn mở
- Không có renderer BBS ngoài game: preview tự động chỉ có phía Effekseer. Cách đối chiếu khả thi: (a) người dùng chụp trong game,
  (b) tự động qua công cụ chụp màn hình có sẵn trên máy (`MCP_SCREEN_CAPTURE`, chưa đọc), (c) viết trình xem Snowstorm riêng — tốn công, sai khác renderer.
- Tính ngẫu nhiên không tái lập được trong BBS (`Math.random`) → so sánh hình theo số liệu tổng (số hạt, vùng phủ) chứ không theo hash.
- Converter chưa viết (giao Codex). Bước đầu đề xuất: `tools/to_bbs_particle.py` cho tập OK (Sprite + PVA + màu + flipbook) và báo cáo CHẶN/XẤP XỈ,
  thử trên `Sample/00_Basic` (đa số dùng Add → sẽ có cảnh báo).

## 7. Khảo sát AAA Particles (hướng addon, chỉ đọc)
Nguồn: https://github.com/ChloePrime/AAAParticles nhánh `master` commit `c1f3bbb` (2026-10-18), MIT, bản **2.3.4** cho
Minecraft **1.20.1**, có cả **Fabric** (fabric-loader 0.16.9, fabric-api 0.90.4) và Forge; README ghi dùng Effekseer **1.80.7**.

| Câu hỏi | Kết quả |
| --- | --- |
| Định dạng nạp | `.efkefc` (và `.efkpkg`) trong `assets/<namespace>/effeks/`; texture tìm tương đối theo file (`EffekAssetLoader`). Không dùng `.efk`. |
| API phát | Client: `EffekseerManager.createParticle(effect)` → `ParticleEmitter`; common/server: `ParticleEmitterInfo.create(level, location)` với `position/rotation/scale/speed/parameter/trigger/bindOnEntity/entitySpaceRelativePosition`. |
| Tua theo thời gian film | Có `ParticleEmitter.setProgress(frame)` → native `UpdateHandleToMoveToFrame` (Effekseer tự mô phỏng tới frame). Có `pause/resume/stop/setSpeed/setTransformMatrix`. Chưa kiểm độ chính xác và chi phí khi tua ngược. |
| Gắn xương | Không có khái niệm xương BBS; addon phải tự tính ma trận xương từ BBS rồi gọi `setTransformMatrix` mỗi frame. |
| Phiên bản | Effekseer runtime 1.80.7 trong AAA vs editor 1.80.6 của App 4: cùng nhánh 1.80, cần kiểm file 1.80.6 nạp đúng. |

Kết luận khảo sát: hướng addon khả thi về API (có seek + transform), giữ đủ tính năng Effekseer (additive, ribbon, model, distortion),
nhưng cần mod AAA trong instance của người dùng và một addon Java cho BBS FS 2.7. Chưa viết Java (theo quyết định).
