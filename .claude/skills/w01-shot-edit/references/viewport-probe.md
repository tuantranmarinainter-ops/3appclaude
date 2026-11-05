# Đọc khung 3D App 2 bằng số (không đoán từ ảnh)

Ảnh duyệt (`stills.py`, API review-capture) **bỏ qua khoá người dùng**. Khung 3D App 2 và xuất film thì dùng chúng.
Vì vậy luôn đo trong khung 3D trước khi báo người dùng là xong.

## 1. Lấy Stage qua React fiber (dán vào trang App 2, sau khi trang tải xong ~12 s)
```js
const canvas=[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0]; let el=canvas, found=null; const seen=new Set();
function scan(o,d){ if(!o||typeof o!=='object'||seen.has(o)||d>4) return null; seen.add(o); if(o.characters instanceof Map && o.props instanceof Map && o.scene) return o; for(const k of Object.keys(o)){ try{ const r=scan(o[k],d+1); if(r) return r }catch{} } return null }
for(let i=0;i<12&&el&&!found;i++){ const fk=Object.keys(el).find(k=>k.startsWith('__reactFiber')); let f=fk?el[fk]:null; for(let j=0;j<60&&f&&!found;j++){ found=scan(f.memoizedProps,0)||scan(f.stateNode,0); let h=f.memoizedState; for(let n=0;n<20&&h&&!found;n++){ found=scan(h.memoizedState,0); h=h.next } f=f.return } el=el.parentElement }
window.__stage=found; !!found
```

## 2. Tua bằng ô "Khung" của dòng thời gian (đơn vị theo nút Giây/Khung/Tick đang chọn)
Mở dòng thời gian bằng **click thật** vào nút "Dòng thời gian" (nút bật/tắt; trạng thái được nhớ giữa các lần tải trang).
```js
const lab=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Khung'); const inp=lab.control||lab.parentElement.querySelector('input')
window.__seek=async(v)=>{inp.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inp,String(v)); for(const t of ['input','change']) inp.dispatchEvent(new Event(t,{bubbles:true})); inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); inp.blur(); await new Promise(r=>setTimeout(r,800))}
```

## 3. Đọc transform đã tính (gồm userKeys) ở khung hiện tại
```js
const s=window.__stage; await window.__seek(1.8)   // giây nếu đang ở chế độ Giây
const t=s.frameOut.transforms.get('<nodeId>'); ({frame:s.currentFrame, pos:t.position, rot:t.rotation, scale:t.scale})
```
Bỏ lớp khoá người dùng để so sánh: `s.evaluate(frame, {}, false, false, true); s.frameOut.transforms.get(id)`.
Đọc đường cong chính thức: `s.fcurves.evalScalar(id, 'transform.position', 1, frame)`.

## 4. Ảnh bằng chứng trong khung 3D
Bấm "Vào chế độ xem camera" (nhìn qua camera shot), tua, **chờ ~2,5 s** rồi mới `zoom` vùng khung hình. Chụp ngay sau khi tua sẽ ra ảnh của lần tua trước.
