# Ảnh duyệt qua camera shot (khung 3D App 2, có khoá người dùng)

1. Bật bộ nhận ảnh (chạy nền): `node <skill>/scripts/stills-recv.mjs <work>/frames 3147`
2. Mở **tab riêng** tới `http://127.0.0.1:<port>/?unified=<project>`, rồi dán đoạn JS dưới (thay `FRAMES`). Không cần mở dòng thời gian hay chế độ camera.
3. Ghép ảnh: `python -I <skill>/scripts/sheet.py <work>/frames <work>/contact.jpg 0,52,101,150,299 [cols]`, gửi bằng SendUserFile.
4. Tắt bộ nhận ảnh (TaskStop). Không quay video khi người dùng chưa ra lệnh.

```js
await new Promise(r=>setTimeout(r,15000));   // chờ trang tải xong
const FRAMES=[0,52,101,150,299], PORT=3147;
const canvas=[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0]; let el=canvas, s=null; const seen=new Set();
function scan(o,d){ if(!o||typeof o!=='object'||seen.has(o)||d>4) return null; seen.add(o); if(o.characters instanceof Map && o.props instanceof Map && o.scene) return o; for(const k of Object.keys(o)){ try{ const r=scan(o[k],d+1); if(r) return r }catch{} } return null }
for(let i=0;i<12&&el&&!s;i++){ const fk=Object.keys(el).find(k=>k.startsWith('__reactFiber')); let f=fk?el[fk]:null; for(let j=0;j<60&&f&&!s;j++){ s=scan(f.memoizedProps,0)||scan(f.stateNode,0); let h=f.memoizedState; for(let n=0;n<20&&h&&!s;n++){ s=scan(h.memoizedState,0); h=h.next } f=f.return } el=el.parentElement }
const toUrl=(b)=>new Promise((res)=>{const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(b)});
for (const f of FRAMES) { let got=null; await s.captureFrame({ cameraId:'camera_1', width:1280, height:720, frame:f, userKeys:s.evalUserKeys, userKeysEnabled:true, chainCameraMotion:s.evalChainCameraMotion, onExport:(x)=>{got=x} });
  for (let i=0;i<50&&!got;i++) await new Promise(r=>setTimeout(r,100)); await fetch(`http://127.0.0.1:${PORT}/?f=${f}`, { method:'POST', body: await toUrl(got) }) }
FRAMES.join(',')
```

`captureFrame` trả ảnh qua `onExport` dưới dạng **Blob** (không phải chuỗi). Ảnh này giống khung 3D, có khoá người dùng. `stills.py` của w01-shot-edit thì bỏ qua khoá người dùng.
