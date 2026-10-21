# Hợp đồng gói shot App 2 ↔ App 3 — v1.0.0

## 1. Phạm vi và nguyên tắc

App 2 (Scene) gửi một thư mục shot cho App 3 (Animation Studio). App 3 chỉ sửa nhân vật có
`editable: true`; camera, nhân vật còn lại và GLB tham chiếu chỉ để xem. Gói có thể chứa nhiều nhân vật
để giữ ngữ cảnh, nhưng mỗi phần tử `edits` chỉ trả thay đổi của một nhân vật. App 2 thay clip bằng
`newActionUuid`, giữ nguyên Action gốc và mọi thành phần không có trong `edits`.

Cả `shot.json`, `result.json` có `version: "1.0.0"`; validator nhận major 1 dạng `1.x.y`, không nhận
prerelease/build suffix. Trường bổ sung được bỏ qua để mở rộng tương thích; các trường trong bảng là bắt buộc.
JSON dùng UTF-8; số phải hữu hạn, boolean không được dùng thay số. UUID dùng chữ thường, dạng có dấu gạch ngang.
ID shot/scene/character là chuỗi không rỗng, không bắt buộc là UUID. SHA-256 là chuỗi 64 ký tự hex
(không phân biệt hoa thường), tính trên **byte file thực tế**, không chuẩn hoá hoặc serialize lại JSON.

GLB nhân vật vẫn theo hợp đồng GLB Mixamo65 v1.0.0 trong `DECISIONS.md`: Y-up, mét, 65 joint không prefix,
rest tham chiếu T-pose, bake 30 FPS, nhiều Action/GLB, manifest JSON riêng. Manifest giữ nguyên cấu trúc
App 1: `version`, `glbSha256`, `actions[].uuid`, tên/duration/FPS, nguồn, root policy và fingerprint.
`actionUuid` chọn đúng một Action trong GLB nhiều Action. `rootPolicy` chuỗi trong shot là lựa chọn phát,
khác với đối tượng `rootPolicy` trong manifest chuẩn hoá.

Mọi đường dẫn trong gói là POSIX tương đối với **gốc thư mục gói**, kể cả đường dẫn manifest; không phải
so với file GLB. Không chấp nhận đường dẫn tuyệt đối, Windows drive/UNC, dấu `\`, ký tự NUL, đoạn `..`
(kể cả đường dẫn sau khi rút gọn vẫn ở trong gói), symlink trỏ ra ngoài. Phải tham chiếu tới file tồn tại.
File GLB tham chiếu chỉ xem không cần manifest Mixamo65. Gói kết quả tự chứa file mới, không dùng `../shot/...`.

## 2. Gói shot — App 2 → App 3

| Trường | Kiểu / ý nghĩa |
| --- | --- |
| `version` | Semver major 1; bản này là `1.0.0` |
| `shotId`, `sceneId` | ID shot và cảnh nguồn |
| `fps` | Số nguyên `30` |
| `frameRange` | `[start, end]`, hai số nguyên, `0 <= start <= end`; **bao gồm cả hai đầu** |
| `camera.keys[]` | Không rỗng; `{frame, position, lookAt, fovYDegrees}` |
| `characters[]` | Nhân vật; ID duy nhất, ít nhất một nhân vật editable |
| `references[]` | Có thể rỗng; GLB cảnh/đạo cụ chỉ xem |

Mốc frame là frame tuyệt đối trong cảnh nguồn, không đánh lại từ 0. Thời gian từ đầu shot là
`(frame - start) / 30`; số mẫu bake là `end - start + 1`, khoảng thời gian hai đầu là `(end - start) / 30` giây.
Key camera và key placement phải là frame nguyên trong khoảng này, tăng nghiêm ngặt (không trùng).
Nếu không có key tại đầu/cuối thì giữ key gần nhất. Nội suy tuyến tính position/lookAt/FOV; yaw nội suy
qua cung ngắn nhất theo độ. Camera nhìn vào `lookAt` (tọa độ thế giới), trục up là +Y;
`fovYDegrees` là FOV dọc, `0 < fovYDegrees < 180`. Hai vector camera đều có ba số hữu hạn.

Mỗi nhân vật:

| Trường | Kiểu / ý nghĩa |
| --- | --- |
| `characterId` | Chuỗi duy nhất trong shot |
| `glb`, `manifest`, `glbSha256` | Đường dẫn GLB, manifest và hash byte GLB |
| `actionUuid` | UUID tồn tại trong `manifest.actions[].uuid` |
| `clip.sourceStartSeconds`, `clip.sourceEndSeconds` | Đoạn Action nguồn theo giây; `0 <= start <= end` |
| `clip.speed` | Số dương; hệ số tốc độ phát |
| `clip.loop`, `clip.reverse` | Boolean; lặp đoạn nguồn / phát ngược đoạn nguồn |
| `placement` | `{position: [x,y,z], yawDegrees}`, tại frame đầu shot |
| `rootPolicy` | `skeletal` (giữ root Action) hoặc `in-place` (bỏ dịch chuyển root khi phát) |
| `editable` | Boolean; `false` là chỉ xem |

`position` là vị trí thế giới tính bằng mét; yaw quay quanh +Y theo quy tắc bàn tay phải (độ),
không giới hạn vào 0–360. `speed` luôn dương; muốn phát ngược dùng `reverse`.
Với `t = (frame-start)/30`, độ tiến trong đoạn nguồn là `t * speed`; loop lấy modulo độ dài đoạn,
không loop thì kẹp ở cuối đoạn. Với reverse, lấy từ cuối về đầu. Đoạn dài 0 giữ đúng một pose.

Mỗi reference có `{file, sha256, transform}`. `transform` gồm ba vector ba số:
`position` (mét), `rotationDegrees` (Euler XYZ, độ, quay cục bộ theo thứ tự X rồi Y rồi Z), `scale`
(hệ số không đơn vị). Đây là transform GLB tham chiếu trong thế giới, không làm reference editable.

## 3. Gói kết quả — App 3 → App 2

| Trường | Kiểu / ý nghĩa |
| --- | --- |
| `version` | `1.0.0` (validator nhận `1.x.y`) |
| `shotId` | Phải bằng shot nguồn |
| `baseShotSha256` | SHA-256 chính xác byte `shot.json` đã nhận, tránh áp vào shot đã đổi |
| `edits[]` | Có thể rỗng khi không sửa; mỗi characterId xuất hiện tối đa một lần |
| `edits[].characterId` | Phải tồn tại trong shot và có `editable: true` |
| `edits[].originalActionUuid` | Bằng `actionUuid` của nhân vật trong shot; lưu nguồn gốc Action |
| `edits[].newActionUuid` | UUID mới, khác mọi UUID Action đang dùng trong shot, không trùng edit khác |
| `edits[].glb`, `manifest`, `glbSha256` | File mới tự chứa trong gói kết quả; SHA-256 phải đúng |
| `edits[].placementKeys[]` | Không rỗng; `{frame, position: [x,y,z], yawDegrees}`; nằm trong shot và tăng nghiêm ngặt |

`newActionUuid` phải có trong manifest mới. `originalActionUuid` trong result là nguồn gốc bắt buộc;
App 3 có thể lưu thêm trường cùng tên trong entry Action của manifest (validator không yêu cầu trường mở rộng này).
Manifest của cả hai gói phải có version major 1, `glbSha256` khớp file GLB, mảng `actions` không rỗng,
UUID Action hợp lệ và không trùng. Không sửa file hoặc manifest gốc. Các placement key là vị trí **tuyệt đối**,
không phải delta cộng thêm placement cũ.

### Chống cộng root hai lần — ĐỀ XUẤT, CHỜ NGƯỜI DÙNG CHỐT

Mặc định đề xuất: **vị trí nhân vật sửa trong App 3 ghi vào `placementKeys`; root của Action giữ như cũ**.
App 2 thay placement track bằng các key trả về, không cộng key vào placement cũ và không bake cùng delta
vào root Action. Với skeletal, transform placement chỉ áp một lần bên ngoài root skeletal; với in-place,
receiver xử lý bỏ dịch chuyển root đúng một lần theo `rootPolicy` của shot. Giữ nguyên rootPolicy khi round-trip.

Đây chưa phải quyết định đã chốt trong `DECISIONS.md`. Validator không thể suy ra root đã bị cộng hai lần
chỉ từ JSON/hash; chưa kiểm semantic bên trong GLB. Nếu người dùng chốt phương án bake vị trí vào root,
cần thống nhất lại hợp đồng trước khi hai app tích hợp, không tự đổi ý nghĩa các field hiện tại.

## 4. API, CLI và phạm vi kiểm tra

Chạy từ `three-workspace-app` (Python 3.11, chỉ thư viện chuẩn):

```bash
python -m agent.shot_package validate-shot /path/to/shot
python -m agent.shot_package validate-result /path/to/result --shot /path/to/shot
python -m unittest agent.test_shot_package agent.test_unified_cli agent.test_unified_mcp
```

API `validate_shot(dir)` và `validate_result(dir, shot_dir)` trả `list[Issue]`, mỗi Issue có ba chuỗi
`code`, `path`, `message`. Danh sách rỗng là hợp lệ; CLI in danh sách dạng JSON ra stdout.
Mã thoát: `0` hợp lệ, `1` có lỗi, `2` sai tham số (argparse ghi hướng dẫn ra stderr).
`path` dùng dạng `shot.json.characters[0].glb`; lỗi từ shot gốc khi kiểm result có prefix `shot/`.
Validator chỉ đọc, không tạo/chỉnh gói. Khi kiểm result, shot gốc cũng được kiểm đầy đủ.

| Mã lỗi | Ý nghĩa |
| --- | --- |
| `MISSING_FIELD`, `INVALID_TYPE`, `INVALID_VALUE` | Thiếu trường, sai kiểu hoặc giá trị không hợp lệ |
| `UNSUPPORTED_VERSION`, `INVALID_FPS`, `INVALID_FRAME_RANGE` | Version/FPS/khoảng frame không hợp lệ |
| `UNSAFE_PATH`, `FILE_NOT_FOUND`, `IO_ERROR`, `INVALID_JSON` | Đường dẫn, file hoặc JSON không đọc được |
| `INVALID_SHA256`, `SHA256_MISMATCH` | Sai định dạng hash hoặc nội dung file không khớp |
| `INVALID_UUID`, `ACTION_NOT_IN_MANIFEST`, `DUPLICATE_ACTION_UUID` | UUID không hợp lệ, thiếu hoặc trùng |
| `NO_EDITABLE_CHARACTER`, `DUPLICATE_CHARACTER_ID` | Không có nhân vật sửa được hoặc ID trùng |
| `INVALID_CLIP`, `INVALID_ROOT_POLICY` | Clip hoặc chính sách root không hợp lệ |
| `SHOT_ID_MISMATCH`, `UNKNOWN_CHARACTER`, `CHARACTER_NOT_EDITABLE` | Result không thuộc shot/nhân vật sửa được |
| `ORIGINAL_ACTION_MISMATCH`, `ACTION_UUID_REUSED` | Sai Action nguồn hoặc UUID mới chưa thực sự mới |
| `FRAME_OUT_OF_RANGE`, `KEYS_NOT_INCREASING` | Key ra ngoài shot, ngược thứ tự hoặc trùng frame |

Đây là validator **hợp đồng gói**, không phải bộ đọc GLB: chưa xác minh 65 joint, frame bake,
duration/FPS từng Action, mesh, texture, root motion hoặc fingerprint. Giữ nguyên metadata manifest App 1;
validator chỉ kiểm các trường manifest cần cho liên kết gói (version, hash, UUID Action).
Việc hash đúng không thay thế kiểm chất lượng GLB của App 1 và review của người điều phối.

## 5. Ví dụ đầy đủ và fixture chạy test

Hai JSON chính và hai manifest dưới đây là ví dụ được test đọc trực tiếp từ tài liệu, không chép lại
fixture trong assertion. Để kiểm validator độc lập không cần binary game, test tạo byte giả cho GLB:

| File | Byte UTF-8 (có đúng một LF cuối) |
| --- | --- |
| `shot/characters/hero.glb` | `shot-contract-fixture-v1\n` |
| `shot/references/stage.glb` | `shot-contract-reference-v1\n` |
| `result/edits/hero.glb` | `shot-contract-edited-v1\n` |

Các byte giả chỉ dùng test envelope/hash, **không phải model GLB mở được**. Gói thật dùng GLB theo hợp đồng
ở mục 1 và tính lại hash. Khi chép JSON từ các khối dưới đây: giữ nguyên indent, UTF-8 không BOM và đúng
một LF sau dấu `}` cuối; `baseShotSha256` dưới đây phụ thuộc chính xác cách lưu `shot.json` như vậy.

### `shot/shot.json`

<!-- example:shot/shot.json -->
```json
{
  "version": "1.0.0",
  "shotId": "shot-001",
  "sceneId": "scene-001",
  "fps": 30,
  "frameRange": [
    0,
    60
  ],
  "camera": {
    "keys": [
      {
        "frame": 0,
        "position": [
          0,
          2,
          5
        ],
        "lookAt": [
          0,
          1,
          0
        ],
        "fovYDegrees": 45
      },
      {
        "frame": 60,
        "position": [
          2,
          2,
          5
        ],
        "lookAt": [
          0,
          1,
          0
        ],
        "fovYDegrees": 45
      }
    ]
  },
  "characters": [
    {
      "characterId": "hero",
      "glb": "characters/hero.glb",
      "manifest": "characters/hero.manifest.json",
      "glbSha256": "7cb6a04f348453fe0ba1e4ce8c93ef0cfc61dafe74c25b1b9d40dfe2f519ac82",
      "actionUuid": "11111111-1111-4111-8111-111111111111",
      "clip": {
        "sourceStartSeconds": 0,
        "sourceEndSeconds": 2,
        "speed": 1,
        "loop": false,
        "reverse": false
      },
      "placement": {
        "position": [
          0,
          0,
          0
        ],
        "yawDegrees": 0
      },
      "rootPolicy": "skeletal",
      "editable": true
    },
    {
      "characterId": "observer",
      "glb": "characters/hero.glb",
      "manifest": "characters/hero.manifest.json",
      "glbSha256": "7cb6a04f348453fe0ba1e4ce8c93ef0cfc61dafe74c25b1b9d40dfe2f519ac82",
      "actionUuid": "11111111-1111-4111-8111-111111111111",
      "clip": {
        "sourceStartSeconds": 0,
        "sourceEndSeconds": 2,
        "speed": 1,
        "loop": false,
        "reverse": false
      },
      "placement": {
        "position": [
          0,
          0,
          0
        ],
        "yawDegrees": 0
      },
      "rootPolicy": "skeletal",
      "editable": false
    }
  ],
  "references": [
    {
      "file": "references/stage.glb",
      "sha256": "b8b39fd77202feaebf297d4abcf7e390a26e8d3b2e39cf4df749b484c209ad1e",
      "transform": {
        "position": [
          0,
          0,
          0
        ],
        "rotationDegrees": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    }
  ]
}
```

### `result/result.json`

<!-- example:result/result.json -->
```json
{
  "version": "1.0.0",
  "shotId": "shot-001",
  "baseShotSha256": "fd009bf505bca3d87acef8a104b35fe4e4e77e4a7f57d8db21b807ef84c66412",
  "edits": [
    {
      "characterId": "hero",
      "originalActionUuid": "11111111-1111-4111-8111-111111111111",
      "newActionUuid": "22222222-2222-4222-8222-222222222222",
      "glb": "edits/hero.glb",
      "manifest": "edits/hero.manifest.json",
      "glbSha256": "526ebb007c75c42752740111dc276130f8260e200d82abcc289f5dd50f9cbca3",
      "placementKeys": [
        {
          "frame": 0,
          "position": [
            0,
            0,
            0
          ],
          "yawDegrees": 0
        },
        {
          "frame": 60,
          "position": [
            1,
            0,
            0
          ],
          "yawDegrees": 45
        }
      ]
    }
  ]
}
```

### `shot/characters/hero.manifest.json`

<!-- example:shot/characters/hero.manifest.json -->
```json
{
  "version": "1.0.0",
  "glb": {
    "bytes": 25,
    "mode": "animation-only"
  },
  "glbSha256": "7cb6a04f348453fe0ba1e4ce8c93ef0cfc61dafe74c25b1b9d40dfe2f519ac82",
  "actions": [
    {
      "uuid": "11111111-1111-4111-8111-111111111111",
      "name": "Walk",
      "durationSeconds": 2,
      "fps": 30,
      "sourceActionIndex": 0,
      "glbAnimationIndex": 0
    }
  ],
  "rootPolicy": {
    "mode": "skeletal",
    "translationScale": 1,
    "units": "meters"
  },
  "source": {
    "file": "fixture.glb",
    "sha256": "7cb6a04f348453fe0ba1e4ce8c93ef0cfc61dafe74c25b1b9d40dfe2f519ac82"
  },
  "target": {
    "file": "fixture.glb",
    "sha256": "7cb6a04f348453fe0ba1e4ce8c93ef0cfc61dafe74c25b1b9d40dfe2f519ac82"
  },
  "fingerprint": {
    "boneLengthsMeters": {
      "Spine": 0.1
    },
    "hipsHeightMeters": 1
  }
}
```

### `result/edits/hero.manifest.json`

<!-- example:result/edits/hero.manifest.json -->
```json
{
  "version": "1.0.0",
  "glb": {
    "bytes": 24,
    "mode": "animation-only"
  },
  "glbSha256": "526ebb007c75c42752740111dc276130f8260e200d82abcc289f5dd50f9cbca3",
  "actions": [
    {
      "uuid": "22222222-2222-4222-8222-222222222222",
      "name": "Walk",
      "durationSeconds": 2,
      "fps": 30,
      "sourceActionIndex": 0,
      "glbAnimationIndex": 0
    }
  ],
  "rootPolicy": {
    "mode": "skeletal",
    "translationScale": 1,
    "units": "meters"
  },
  "source": {
    "file": "fixture.glb",
    "sha256": "526ebb007c75c42752740111dc276130f8260e200d82abcc289f5dd50f9cbca3"
  },
  "target": {
    "file": "fixture.glb",
    "sha256": "526ebb007c75c42752740111dc276130f8260e200d82abcc289f5dd50f9cbca3"
  },
  "fingerprint": {
    "boneLengthsMeters": {
      "Spine": 0.1
    },
    "hipsHeightMeters": 1
  }
}
```
