import * as T from 'three';

const canon = name => name.replace(/^mixamorig[:_]?/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const side = name => /left|\.l\b|_l\b/i.test(name) ? 'left' : /right|\.r\b|_r\b/i.test(name) ? 'right' : 'body';
const colorFor = (def, settings) => (def.id === settings.selected || def.id === settings.selectedJoint || def.id === settings.selectedPole) ? 0x62e896 : def.id === settings.hover ? 0xffffff : settings[def.side === 'body' ? 'bodyColor' : def.side];

export function build(view, rig) {
  clear(view);
  const layer = new T.Group();
  layer.name = 'Control Rig display only';
  view.scene.add(layer);
  view.controlLayer = layer;
  const defs = [];
  const add = (id, label, kind, group, anchor, chain = null, part = 'body') => {
    const shape = new T.Group();
    let drawn, hit;
    const visual = new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide, transparent: true, opacity: .92, depthTest: false, depthWrite: false });
    const collider = new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    if (kind === 'ring' || kind === 'root') {
      drawn = new T.Mesh(new T.RingGeometry(.78, 1, 40), visual);
      hit = new T.Mesh(new T.RingGeometry(.57, 1.23, 40), collider);
    } else if (kind === 'box') {
      drawn = new T.Mesh(new T.BoxGeometry(1.7, 1.3, .28), new T.MeshBasicMaterial({ color: 0xffffff, wireframe: true, depthTest: false }));
      hit = new T.Mesh(new T.BoxGeometry(1.9, 1.6, .5), collider);
    } else {
      drawn = new T.Mesh(new T.OctahedronGeometry(1), new T.MeshBasicMaterial({ color: 0xffffff, wireframe: true, depthTest: false }));
      hit = new T.Mesh(new T.SphereGeometry(1.2, 8, 6), collider);
    }
    drawn.renderOrder = 20;
    shape.add(drawn, hit);
    layer.add(shape);
    defs.push({ id, label, kind, group, anchor, chain, side: part, shape, drawn, hit,restWorldQ:anchor.getWorldQuaternion(new T.Quaternion()) });
  };
  if (rig.roots.length === 1) add('root', 'Root', 'root', 'body', rig.root);
  else for (const root of rig.roots) add(root.id, 'Root · ' + root.name, 'root', 'body', root.o);
  const belongs = (rec, rootId) => { while (rec && rec.id !== rootId) rec = rig.records.find(r => r.id === rec.parent); return !!rec; };
  for (const root of rig.roots) for (const [label, names] of [
    ['Hông', ['hips', 'spine']], ['Ngực', ['spine2', 'spine1', 'chest', 'spine003']],
    ['Đầu', ['head', 'spine006']]
  ]) {
    const rec = names.map(n => rig.records.find(r => canon(r.name) === n && belongs(r, root.id))).find(Boolean);
    if (rec && !defs.some(d => d.id === rec.id)) add(rec.id, label, 'ring', 'body', rec.o);
  }
  for (const chain of rig.chains) {
    const part = /left/i.test(chain.id) ? 'left' : 'right';
    const group = /arm/i.test(chain.id) ? 'arms' : 'legs';
    for (const rec of [chain.a, chain.b, chain.c]) add(rec.id, rec.name, 'ring', group, rec.o, chain, part);
    add('ik_' + chain.id, 'IK ' + chain.label, 'box', group, rig.controls['ik_' + chain.id].object, chain, part);
    add('pole_' + chain.id, 'Pole ' + chain.label, 'pole', group, rig.controls['pole_' + chain.id].object, chain, part);
  }
  for (const rec of rig.records) {
    const n = canon(rec.name);
    if (!/(thumb|index|middle|ring|pinky|little)/.test(n) || !/(1$|01$)/.test(n)) continue;
    if (defs.some(d => d.id === rec.id)) continue;
    add(rec.id, rec.name, 'ring', 'fingers', rec.o, null, side(rec.name));
  }
  view.widgets = defs;
  const leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leaders.classList.add('rig-leaders'); view.container.append(leaders); view.rigLeaders = leaders;
  for (const d of defs) {
    const button = document.createElement('button'); button.className = 'rig-label'; button.hidden = true;
    button.textContent = ['box','pole'].includes(d.kind) ? (d.kind==='box'?'IK · ':'Pole · ') + (d.side === 'left' ? 'Trái' : 'Phải') + (d.group === 'arms' ? ' · Tay' : ' · Chân') : d.label.replace(/^mixamorig[:_]?/i, '');
    button.title = d.label; button.dataset.controlId = d.id;
    button.addEventListener('click', () => view.container.dispatchEvent(new CustomEvent('rig-select', {detail: d.id})));
    view.container.append(button); d.labelButton = button;
    d.leader = document.createElementNS(leaders.namespaceURI, 'line'); leaders.append(d.leader);
  }
  return defs;
}

export function clear(view) {
  view.rigLeaders?.remove(); view.rigLeaders = null;
  for (const d of view.widgets || []) d.labelButton?.remove();
  if (!view.controlLayer) return;
  view.scene.remove(view.controlLayer);
  view.controlLayer.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  view.controlLayer = null;
  view.widgets = [];
}

function outline(d, style, width) {
  const material = new T.MeshBasicMaterial({color: 0xffffff, depthTest: false, depthWrite: false, transparent: true});
  const points = [];
  const oval = (rx, rz, y = 0, count = 48) => Array.from({length: count + 1}, (_, i) => new T.Vector3(Math.cos(i / count * Math.PI * 2) * rx, y, Math.sin(i / count * Math.PI * 2) * rz));
  const loop = coords => coords.map(p => new T.Vector3(...p));
  if (d.kind === 'root') points.push(oval(1, 1), loop([[0,0,-1],[0,0,-1.45],[-.2,0,-1.2],[0,0,-1.45],[.2,0,-1.2]]));
  else if (d.kind === 'pole') points.push(loop([[0,1,0],[.65,0,0],[0,-1,0],[-.65,0,0],[0,1,0]]));
  else if (d.kind === 'box') {
    if(d.group==='legs')points.push(loop([[-.45,0,-.5],[.45,0,-.5],[.65,0,1.2],[-.65,0,1.2],[-.45,0,-.5]]));
    else if (style === 'classic') points.push(loop([[-.8,0,-.65],[.8,0,-.65],[.8,0,.65],[-.8,0,.65],[-.8,0,-.65]]));

    else {
      for (const y of [-.45,.45]) points.push(loop([[-.8,y,-.65],[.8,y,-.65],[.8,y,.65],[-.8,y,.65],[-.8,y,-.65]]));
      for (const x of [-.8,.8]) for (const z of [-.65,.65]) points.push(loop([[x,-.45,z],[x,.45,z]]));
    }
  } else if(d.group!=='body'){points.push(oval(1,1));const ring=oval(1,1);points.push(ring.map(p=>new T.Vector3(p.x,p.z,0)),ring.map(p=>new T.Vector3(0,p.x,p.z)));}
  else if (style === 'minimal' || style === 'classic') points.push(oval(1,1));
  else if (d.label === 'Hông') points.push(oval(2,1),oval(2,1,.35));
  else if (d.label === 'Ngực') points.push(loop([[-1.6,0,-.8],[-2,.3,0],[-1.4,.6,.8],[0,.45,1],[1.4,.6,.8],[2,.3,0],[1.6,0,-.8],[0,-.15,-1],[-1.6,0,-.8]]));
  else if (d.label === 'Đầu') points.push(oval(1.4,1.15,.7),loop([[-1.4,.7,0],[-1.2,1.4,0],[0,1.6,0],[1.2,1.4,0],[1.4,.7,0]]));
  else points.push(oval(1,1));
  const group = new T.Group();
  for (const path of points) {
    const curve = new T.CurvePath(); for (let i=1;i<path.length;i++) curve.add(new T.LineCurve3(path[i-1],path[i]));
    group.add(new T.Mesh(new T.TubeGeometry(curve,Math.max(16,path.length*2),.023*width*(style==='touch'?1.4:1),5,false),material));
  }
  group.traverse(o => o.renderOrder = 20); return group;
}

export function update(view, rig, settings) {
  if (!view.widgets) return;
  const size = Math.max(.6, Math.min(1.8, Number(settings.size) || 1));
  const style = settings.style || 'hybrid', signature = style + ':' + settings.lineWidth;
  for (const d of view.widgets) {
    if (d.signature !== signature) {
      d.shape.remove(d.drawn); d.drawn.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
      d.drawn = style === 'basic' && !(d.kind==='box'&&d.group==='legs') ? new T.Mesh((d.kind==='box'?new T.BoxGeometry(1.7,1.3,.28):d.kind==='pole'?new T.OctahedronGeometry(1):new T.RingGeometry(.78,1,40)),new T.MeshBasicMaterial({color:0xffffff,side:T.DoubleSide,wireframe:['box','pole'].includes(d.kind),transparent:true,depthTest:false})) : outline(d,style,Number(settings.lineWidth)||1);
      // Keep the original hit shapes for basic; hybrid uses a generous box at IK targets.
      if(d.kind==='box'&&d.group==='legs'){d.hit.geometry.dispose();const shape=new T.Shape();shape.moveTo(-.45,-.5);shape.lineTo(.45,-.5);shape.lineTo(.65,1.2);shape.lineTo(-.65,1.2);shape.closePath();d.hit.geometry=new T.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:false});d.hit.geometry.translate(0,0,-.09);d.hit.geometry.rotateX(Math.PI/2);}
      if(d.kind==='ring'&&d.group!=='body'&&style!=='basic'){d.hit.geometry.dispose();d.hit.geometry=new T.SphereGeometry(1.1,12,8);}d.shape.add(d.drawn); d.hit.rotation.x=(d.kind==='root'||d.kind==='ring')&&style!=='basic'?-Math.PI/2:0; d.signature = signature;
    }
    let rec = rig.records.find(r => r.id === d.id);
    while (rec && rec.id !== rig.activeRoot) rec = rig.records.find(r => r.id === rec.parent);
    const isActive = !rig.activeRoot || d.id === 'root' || d.chain?.root === rig.activeRoot || !!rec;
    const allowed = d.id===settings.selectedJoint || style !== 'ik' || ['root','box','pole'].includes(d.kind);
    const sideSetting=settings[d.group+(d.side==='left'?'Left':'Right')];const enabled = !!(settings.mode && settings[d.group] && sideSetting!==false && isActive && allowed);
    d.shape.visible = enabled && !!settings.visible;
    const anchor = d.kind === 'box' && d.chain?.mode === 'fk' ? d.chain.c.o : d.anchor;
    d.shape.position.copy(anchor.getWorldPosition(new T.Vector3()));
    if (d.kind === 'root') { d.shape.quaternion.identity(); if(style !== 'basic') d.shape.rotation.x=Math.PI/2; }
    else if(d.kind==='box'&&d.group==='legs')d.shape.quaternion.copy(anchor.getWorldQuaternion(new T.Quaternion()).multiply(d.restWorldQ.clone().invert()).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),Math.PI/2)));
    else if (style === 'basic' || d.kind === 'pole') d.shape.quaternion.copy(view.camera.quaternion);
    else d.shape.quaternion.copy(anchor.getWorldQuaternion(new T.Quaternion()));
    d.shape.scale.setScalar((d.kind === 'root' ? .42 : d.kind === 'box' ? .14 : d.kind === 'pole' ? .09 : .105) * size * (style === 'minimal' ? .8 : style === 'touch' ? 1.3 : 1));
    const normal=view.camera.getWorldDirection(new T.Vector3()).negate();if(settings.depthPart==='back')normal.negate();d.clipPlane=settings.depthPart&&settings.depthPart!=='all'?new T.Plane().setFromNormalAndCoplanarPoint(normal,d.shape.position):null;d.inFront=settings.inFront!==false;
    const color = colorFor(d, settings);
    d.drawn.traverse(o=>{if(o.material){o.material.color.setHex(color);o.material.side=T.DoubleSide;o.material.depthWrite=false;o.material.depthTest=!d.inFront;o.material.clippingPlanes=d.clipPlane?[d.clipPlane]:null;o.material.opacity=(d.id===settings.selected||d.id===settings.selectedJoint||d.id===settings.selectedPole)?.98:d.chain&&d.kind==='ring'&&d.chain.mode==='ik'?.22:d.chain&&d.kind==='box'&&d.chain.mode==='fk'?.48:.85;}});
    d.labelEnabled = enabled && !!settings.labels && (d.id === settings.selected || d.id === settings.selectedPole || d.kind === 'box' || d.kind === 'pole' && d.chain?.mode==='ik' || d.group === 'body');
  }
  updateLabels(view,settings);
}

function updateLabels(view,settings) {
  const w=view.container.clientWidth,h=view.container.clientHeight,pad=8,selected=settings.selected;
  const candidates=view.widgets.filter(d=>d.labelEnabled).sort((a,b)=>(b.id===selected)-(a.id===selected)||(b.chain?.mode==='ik')-(a.chain?.mode==='ik')||(b.kind==='box')-(a.kind==='box'));
  const limit=w<620?Math.max(1,Math.floor(h/85)):7,occupied=[];
  const object=view.gizmo?.object,point=object?.getWorldPosition(new T.Vector3()).project(view.camera),radius=view.gizmoAvoidRadius||view.gizmoRadius||60;
  if(point)occupied.push({x:(point.x+1)*w/2-radius,y:(1-point.y)*h/2-radius,w:radius*2,h:radius*2});
  occupied.push({x:w-104,y:h-108,w:104,h:108});
  let count=0;
  for(const d of view.widgets){d.labelButton.hidden=true;d.leader.style.display='none';}
  for(const d of candidates){
    if(count>=limit)break;
    const p=d.shape.position.clone().project(view.camera);if(p.z< -1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1)continue;
    const ax=(p.x+1)*w/2,ay=(1-p.y)*h/2,label=d.labelButton;
    label.style.fontSize=settings.labelSize+'px';label.hidden=false;label.classList.toggle('selected',d.id===selected||d.id===settings.selectedPole||d.id===settings.selectedJoint);label.setAttribute('aria-pressed',String(d.id===selected));
    const lw=label.offsetWidth,lh=label.offsetHeight,direction=ax>w/2?1:-1;
    let placed=null;
    for(const gap of [24,48,80,112,144]){
      for(const [dx,dy]of [[direction,0],[-direction,0],[direction,-1],[direction,1],[-direction,-1],[-direction,1],[0,-1],[0,1]]){
        const x=ax+(dx>0?gap:dx<0?-gap-lw:-lw/2),y=ay+(dy>0?gap:dy<0?-gap-lh:-lh/2);
        if(x<pad||x+lw>w-pad||y<30||y+lh>h-pad||occupied.some(r=>x<r.x+r.w+5&&x+lw+5>r.x&&y<r.y+r.h+5&&y+lh+5>r.y))continue;
        const ex=Math.max(x,Math.min(x+lw,ax)),ey=Math.max(y,Math.min(y+lh,ay));
        if(Math.hypot(ax-ex,ay-ey)>150)continue;
        placed={x,y,ex,ey};break;
      }if(placed)break;
    }
    if(!placed){label.hidden=true;continue;}
    const {x,y,ex,ey}=placed;label.style.left=x+'px';label.style.top=y+'px';occupied.push({x,y,w:lw,h:lh});count++;
    d.leader.style.display='';for(const [name,value]of Object.entries({x1:ax,y1:ay,x2:ex,y2:ey}))d.leader.setAttribute(name,value);
    d.leader.setAttribute('stroke',d.id===selected||d.id===settings.selectedPole||d.id===settings.selectedJoint?'#62e896':'#'+new T.Color(settings[d.side==='body'?'bodyColor':d.side]).getHexString());
  }
}

export function pick(view, event) {
  if (!view.widgets?.length) return null;
  const rect = view.renderer.domElement.getBoundingClientRect();
  const ray = new T.Raycaster();
  ray.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), view.camera);
  view.scene.updateMatrixWorld(true);
  const visible=view.widgets.filter(d=>d.shape.visible),hits=[];
  for(const d of visible){
    const precise=ray.intersectObject(d.drawn,true),padded=ray.intersectObject(d.hit,true);
    const valid=hit=>!d.clipPlane||d.clipPlane.distanceToPoint(hit.point)>=-1e-6;
    const hit=precise.find(valid)||padded.find(valid);if(!hit)continue;
    if(!d.inFront){const meshHit=ray.intersectObjects(view.rig.mesh.filter(m=>m.visible),false)[0];if(meshHit&&meshHit.distance<hit.distance-1e-4)continue;}
    const p=d.shape.position.clone().project(view.camera),center=Math.hypot(event.clientX-rect.left-(p.x+1)*rect.width/2,event.clientY-rect.top-(1-p.y)*rect.height/2);
    hits.push({d,distance:hit.distance,center,priority:['pole','box'].includes(d.kind)&&center<14?0:precise.some(valid)?1:2});
  }
  hits.sort((a,b)=>a.priority-b.priority||(a.priority===0?a.center-b.center:a.distance-b.distance));
  return hits[0]?.d||null;
}

export function dragPlane(view, point, root = false) {
  return new T.Plane().setFromNormalAndCoplanarPoint(root ? new T.Vector3(0, 0, 1) : view.camera.getWorldDirection(new T.Vector3()), point);
}

export function pointerOnPlane(view, event, plane) {
  const rect = view.renderer.domElement.getBoundingClientRect();
  const ray = new T.Raycaster();
  ray.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), view.camera);
  return ray.ray.intersectPlane(plane, new T.Vector3());
}
