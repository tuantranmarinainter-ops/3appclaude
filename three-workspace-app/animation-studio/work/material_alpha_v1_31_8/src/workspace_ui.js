// Move the existing controls, so their event handlers and project data stay intact.
function setupStudioWorkspace(){
 const original=[...document.querySelectorAll('[id]')];
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
 const group=(parent,label,nodes)=>{const e=make('div','studio-group');e.setAttribute('role','group');e.setAttribute('aria-label',label);e.append(...nodes.filter(Boolean));parent.append(e);return e;};
 const header=document.querySelector('body>header'),actions=header.querySelector('.header-actions');
 $('buildBadge').textContent='1.33.0';$('buildBadge').title='Animation Studio 1.33.0';
 const name=$('clipName').closest('label');name.classList.add('studio-project-name');name.firstChild.textContent='Dự án';
 const identity=make('div','studio-identity');identity.append(name);const state=make('span','studio-save-state');state.id='studioSaveState';identity.append(state);header.querySelector('.brand').after(identity);
 group(actions,'Lịch sử',[$('undoBtn'),$('redoBtn')]);
 group(actions,'Dự án',[$('saveBtn'),$('exportQuick')]);
 group(actions,'Trợ giúp và cài đặt',[$('fileMenu'),$('settingsBtn'),$('helpBtn')]);
 const engine=document.querySelector('.studio-switch');engine.firstChild.textContent='Bộ công cụ ';$('studioMode').options[0].textContent='Animation';$('studioMode').options[1].textContent='Animation Lab';
 const tabs=document.querySelector('.minimal-tabs');tabs.setAttribute('role','tablist');
 const labels={properties:'Thuộc tính',rig:'Cây rig',pose:'Thư viện',material:'Vật liệu'};
 for(const[key,label]of Object.entries(labels)){const b=tabs.querySelector('[data-sidebar="'+key+'"]');b.textContent=label;b.id='studioTab-'+key;b.setAttribute('role','tab');tabs.append(b);}
 tabs.querySelector('[data-sidebar=export]').hidden=true;tabs.append($('closeMinimalSidebar'));
 $('closeMinimalSidebar').title='Thu gọn cột công cụ';
 const sidebarTitle=make('div','studio-sidebar-heading');sidebarTitle.id='studioSidebarHeading';tabs.before(sidebarTitle);
 const panelIds={properties:document.querySelector('.properties'),rig:$('treeSection'),pose:$('poseSection'),material:$('minimalMaterial')};
 for(const[key,p]of Object.entries(panelIds)){if(!p.id)p.id='studioPanel-'+key;p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby','studioTab-'+key);$('studioTab-'+key).setAttribute('aria-controls',p.id);}
 tabs.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||e.target.getAttribute('role')!=='tab')return;e.preventDefault();const bs=[...tabs.querySelectorAll('[role=tab]')],i=bs.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?bs.length-1:(i+(e.key==='ArrowRight'?1:-1)+bs.length)%bs.length;bs[next].click();bs[next].focus();});
 const props=document.querySelector('.properties');props.prepend($('selectedName'),$('selectedMeta'),$('selectionContext'));
 const behavior=make('details','studio-behavior');behavior.append(make('summary','','Thao tác chọn khớp'));
 const auto=$('autoRigMode').closest('label'),hint=auto.nextElementSibling;behavior.append(auto,hint);props.append(behavior);
 // Display preferences belong to the rig menu, not beside pose transforms.
 const display=$('showMesh').closest('details');$('rigPresetChoices').append($('rigTools'),display);
 $('minimalAdvanced').querySelector('summary').textContent='Điều khiển nâng cao · IK / Animation Lab';
 const transform=$('transformPanel');transform.querySelector('summary').textContent='Transform';
 const space=$('space').closest('label'),tool=$('transformMode').closest('label');group(transform,'Công cụ và không gian',[tool,space]);transform.prepend(transform.querySelector('summary'),transform.lastElementChild);
 const toolbar=document.querySelector('.stage-toolbar'),row=toolbar.querySelector(':scope>.row');
 group(row,'Camera và bố cục',[$('cameraPreset'),$('projectionBtn'),$('viewportLayout')]);
 group(row,'Điều khiển rig',[document.querySelector('.minimal-rig-actions'),document.querySelector('.onion-actions')]);
 group(row,'Hiển thị',[$('minimalViewMenu')]);
 group(row,'Cột công cụ',[$('toggleTree'),$('toggleProperties'),$('toggleTimeline')]);
 toolbar.prepend(row);toolbar.append(engine,$('motionLayerToggle'));
 $('toggleTree').textContent='Cây rig';$('toggleProperties').textContent='Thuộc tính';
 const displayNames={meshPointBtn:'Point · Điểm',meshLineBtn:'Line · Cạnh',meshFaceBtn:'Face · Bề mặt',meshFrontBtn:'Chỉ điểm / cạnh phía trước',viewportSettingsBtn:'Cài đặt khung 3D',textureEditor:'Vật liệu / Texture'};
 for(const[id,label]of Object.entries(displayNames))$(id).textContent=label;
 const transport=document.querySelector('.transport');
 group(transport,'Thời gian',[$('frameInput').closest('label'),$('timeReadout'),$('playbackDiagnostics')]);
 group(transport,'Phát animation',[$('restartBtn'),$('prevFrame'),$('playBtn'),$('nextFrame')]);
 group(transport,'Tùy chọn phát',[$('inPlace').closest('label'),$('loop').closest('label'),$('minimalSpeed')]);
 $('restartBtn').setAttribute('aria-label','Về đầu animation');$('restartBtn').title='Về đầu animation';$('prevFrame').title='Lùi một frame';$('nextFrame').title='Tiến một frame';
 const keyTools=make('div','studio-key-tools');keyTools.id='studioKeyTools';
 keyTools.append($('keySelectionScope').closest('label'),$('selectBodyKeys'),$('timelineUnit').closest('label'),$('fps').closest('label'));$('minimalKeyOptions').before(keyTools);
 $('selectBodyKeys').textContent='Chọn key tại đây';$('selectBodyKeys').title='Chọn toàn thân tại frame hiện tại';
 $('minimalKeyOptions').querySelector('summary').textContent='Chỉnh key · Nội suy · Thời lượng';
 const help=$('help').querySelector('ol');help.children[2].textContent='Trong Animation, bật Control Rig ở thanh 3D. Chọn khớp rồi mở tab Thuộc tính bên phải để chỉnh FK/IK, Snap và Transform.';
 const graphOptions=make('details','studio-graph-options');graphOptions.append(make('summary','','Chỉnh đường cong ▾'),document.querySelector('.graph-editbar'));$('graphPanel').append(graphOptions);
 setupStudioAdvancedTools();setupStudioSettings();setupStudioCompare();setupStudioMenus();setupStudioTextureDrag();setupStudioSceneWorkspace();setupStudioPaneSizing();
 const timelineGrip=document.querySelector('[data-resize=timeline]');timelineGrip.title='Kéo để đổi chiều cao editor · khung 3D giữ ít nhất 45% cửa sổ';
 const fitTimeline=()=>{if(mode!=='compare')clampStudioTimelineHeight(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-height'))||240);};
 const sizing=new ResizeObserver(fitTimeline);for(const el of [document.querySelector('.stage'),toolbar,transport])sizing.observe(el);fitTimeline();
 const observer=new MutationObserver(()=>syncStudioWorkspace());observer.observe($('saveBtn'),{childList:true,subtree:true});observer.observe($('selectedName'),{childList:true,subtree:true});
 $('clipName').addEventListener('input',syncStudioWorkspace);
 // Fail visibly if a future layout edit accidentally removes an existing control.
 const missing=original.filter(e=>!e.isConnected);if(missing.length)throw Error('UI mất điều khiển: '+missing.map(e=>e.id).join(', '));
 document.body.dataset.uiVersion='1.33.0';syncStudioWorkspace();
}

function syncStudioWorkspace(){
 if(!$('studioSidebarHeading'))return;
 const tab=$('uiSidebarTab').value,names={properties:'Thuộc tính',rig:'Cây rig',pose:'Thư viện pose',material:'Vật liệu / Texture',export:'Xuất animation'};
 const heading=$('studioSidebarHeading'),label=names[tab]||names.properties;if(heading.textContent!==label)heading.textContent=label;
 for(const b of document.querySelectorAll('.minimal-tabs [role=tab]')){const active=b.dataset.sidebar===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
 if(tab==='export')$('studioTab-properties').tabIndex=0;
 const state=$('studioSaveState'),labelState=$('saveBtn').textContent.includes('•')?'Chưa lưu thay đổi':'Không có thay đổi';if(state.textContent!==labelState)state.textContent=labelState;
 state.classList.toggle('unsaved',labelState==='Chưa lưu thay đổi');$('clipName').disabled=mode==='compare';syncQuickAnimation();
}

function selectStudioSettings(key){
 const root=$('studioSettingsBody');if(!root)return;
 const keys=[...root.children].map(p=>p.dataset.settingsPage);if(!keys.includes(key))key='input';
 for(const p of root.children)p.hidden=p.dataset.settingsPage!==key;
 for(const b of document.querySelectorAll('[data-settings-tab]')){const on=b.dataset.settingsTab===key;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}
 root.scrollTop=0;
}

function setupStudioSettings(){
 const form=$('settings').querySelector('form'),items=[...form.children].filter(e=>e.id!=='settingsTitle');
 const nav=document.createElement('div');nav.className='studio-settings-nav';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Nhóm cài đặt');nav.setAttribute('aria-orientation','vertical');
 const body=document.createElement('div');body.id='studioSettingsBody';
 const titles={input:'Điều khiển',appearance:'Giao diện',viewport:'Khung 3D',rig:'Xương & Control Rig',timeline:'Animation & Timeline',presets:'Preset & dự án'},pages={};
 for(const[key,title]of Object.entries(titles)){
  const b=document.createElement('button');b.type='button';b.textContent=title;b.dataset.settingsTab=key;b.id='settingsTab-'+key;b.setAttribute('role','tab');b.setAttribute('aria-controls','settingsPage-'+key);b.onclick=()=>selectStudioSettings(key);nav.append(b);
  const p=document.createElement('section');p.id='settingsPage-'+key;p.dataset.settingsPage=key;p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby',b.id);const h=document.createElement('h3');h.textContent=title;p.append(h);pages[key]=p;body.append(p);
 }
 const targets={appearance:['minimalThemeSettings','uiLanguage','theme','themeColor'],input:['mouseSettings','focusDistance'],viewport:['viewportDisplaySettings','renderSettings','viewGridXZ','viewGridXY','viewGridYZ','viewWorldAxes','meshDoubleSided','viewportSplitX','viewportSplitY','background'],rig:['rigPresetSettings','jointLimitSettings','boneGroupSettings','boneColor','boneStyle','nodeSize','axisSize'],timeline:['onionSettings','motionLayerSettings','timelineSettings']};
 let previous='presets';for(const item of items){const key=Object.keys(targets).find(k=>targets[k].some(id=>item.id===id||item.querySelector('#'+id)))||(item.tagName==='SMALL'?previous:'presets');pages[key].append(item);previous=key;}
 const layout=document.createElement('div');layout.className='studio-settings-layout';layout.append(nav,body);form.append(layout);
 nav.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const bs=[...nav.children],i=bs.indexOf(e.target);if(i<0)return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?bs.length-1:(i+(e.key==='ArrowDown'?1:-1)+bs.length)%bs.length;bs[n].click();bs[n].focus();});
 selectStudioSettings('input');
}

function setupStudioCompare(){
 const sidebar=$('compareSidebar'),title=document.createElement('h3');title.textContent='Đối chiếu xương';sidebar.prepend(title);
 for(const side of ['A','B']){
  const pane=document.querySelector('.compare-pane[data-area="'+side+'"]'),head=pane.querySelector('.pane-head'),menu=document.createElement('details');menu.className='studio-import-menu studio-popover';
  const summary=document.createElement('summary');summary.textContent='Nhập model ▾';summary.setAttribute('aria-label','Nhập model '+side);menu.append(summary);const content=document.createElement('div');menu.append(content);
  for(const el of [...head.children])if(!el.matches('b,[data-maximize]')&&!['compareCamera'+side,'compareProjection'+side].includes(el.id))content.append(el);
  head.insertBefore(menu,head.querySelector('[data-maximize]'));const camera=document.createElement('div');camera.className='studio-compare-camera';camera.append($('compareCamera'+side),$('compareProjection'+side));head.append(camera);
  const details=document.createElement('details');details.className='studio-compare-info';details.open=true;details.id='studioCompareInfo'+side;const name=document.createElement('summary');name.textContent='Model '+side+' · Trục & dữ liệu';details.append(name);
  const axes=pane.querySelector('.compare-axis-controls'),stats=$('compareStats'+side);if(axes)details.append(axes);if(stats)details.append(stats);details.append($('comparePlacement'+side));
  const armature=document.createElement('label');armature.className='field';armature.textContent='Armature';armature.append($('compareRig'+side));details.append(armature);sidebar.append(details);
  const row=$('compareClip'+side)?.closest('.row');if(row)row.classList.add('studio-compare-playback');
 }
 const tools=document.querySelector('.compare-tools'),advanced=document.createElement('details');advanced.className='studio-compare-options';advanced.open=true;const heading=document.createElement('summary');heading.textContent='Trục khớp & Euler';advanced.append(heading);
 for(const id of ['compareJointScope','compareAxisSize','compareEulerSpace','eulerOrder'])advanced.append($(id).closest('label'));sidebar.append(advanced);
 const reports=document.createElement('div');reports.className='studio-group';reports.setAttribute('role','group');reports.setAttribute('aria-label','Xuất báo cáo');reports.append($('reportJson'),$('reportCsv'));tools.append(reports);
}

function setupStudioMenus(){
 const selector='#fileMenu,#rigPresetMenu,#minimalViewMenu,#minimalSpeed,.studio-import-menu,.studio-advanced-tools';
 for(const menu of document.querySelectorAll(selector))menu.addEventListener('toggle',()=>{if(menu.open)for(const other of document.querySelectorAll(selector))if(other!==menu)other.open=false;});
 document.addEventListener('pointerdown',e=>{for(const m of document.querySelectorAll(selector))if(!m.contains(e.target))m.open=false;});
 document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;for(const m of document.querySelectorAll(selector))if(m.open){m.open=false;m.querySelector('summary').focus();}});
 for(const b of document.querySelectorAll('.studio-import-menu button,.studio-import-menu label'))b.addEventListener('click',()=>{b.closest('details').open=false;});
}

function setupStudioTextureDrag(){
 const panel=$('texturePanel'),handle=panel.querySelector('header');let drag=null;
 handle.addEventListener('pointerdown',e=>{if(e.button||e.target.closest('button'))return;const r=panel.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};handle.setPointerCapture(e.pointerId);e.preventDefault();});
 handle.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;panel.style.right='auto';panel.style.left=Math.max(0,Math.min(innerWidth-panel.offsetWidth,drag.left+e.clientX-drag.x))+'px';panel.style.top=Math.max(0,Math.min(innerHeight-60,drag.top+e.clientY-drag.y))+'px';});
 const end=()=>{const id=drag?.id;drag=null;if(id!==undefined&&handle.hasPointerCapture(id))handle.releasePointerCapture(id);};for(const ev of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(ev,end);window.addEventListener('blur',end);$('textureClose').addEventListener('click',end);
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();$('textureClose').click();}});
}

// Keep the original nodes and listeners: advanced tools have one shared entry point.
function setupStudioAdvancedTools(){
 const menu=document.createElement('details');menu.id='studioAdvancedTools';menu.className='studio-advanced-tools studio-popover';
 const title=document.createElement('summary');title.textContent='Công cụ nâng cao';menu.append(title);
 const body=document.createElement('div');body.className='studio-advanced-body';menu.append(body);
 const compare=document.createElement('section');compare.setAttribute('aria-label','Đối chiếu xương');compare.append($('modeCompare'));body.append(compare);
 const target=document.createElement('section');target.setAttribute('aria-label','Bộ xương đích và mapping');
 const heading=document.createElement('h3');heading.textContent='Bộ xương đích / Mapping';target.append(heading);
 target.append($('exportProfile').closest('label'),$('targetInput').closest('label'),$('targetSummary'),$('mappingBtn'));body.append(target);
 $('modeCreate').parentElement.append(menu);menu.open=false;
 $('toggleTree').hidden=true;$('toggleProperties').hidden=true;
 // The palette buttons remain connected for compatibility; the select is the visible preset entry.
 $('themeSwatches').hidden=true;
}

// ScenePanel is created later by its existing controller. Dock it without changing scene operations.
function setupStudioSceneWorkspace(){
 const workspace=$('createWorkspace');
 let saved=null;
 const originalShow=sceneShow,originalExit=sceneExit;
 sceneShow=async function(...args){if(!sceneMode){persistLayout();saved=C.clone(workspaceLayouts);}return originalShow(...args);};
 sceneExit=function(...args){const result=originalExit(...args);workspace.classList.remove('studio-scene-mode','studio-scene-editing');if(saved){workspaceLayouts=saved;saved=null;applyWorkspaceLayout();persistLayout();}return result;};
 const connect=()=>{
  const panel=$('sceneStudioDialog'),button=$('sceneStudioBtn');if(!panel||!button)return false;
  workspace.append(panel);$('modeCreate').after(button);
  const title=panel.querySelector('.scene-title');
  title.addEventListener('pointerdown',event=>{if(!event.target.closest('button'))event.stopImmediatePropagation();},true);
  const sync=()=>{
   workspace.classList.toggle('studio-scene-mode',!!sceneMode);
   workspace.classList.toggle('studio-scene-editing',!!sceneEditing);
   button.setAttribute('aria-pressed',String(!!sceneMode));
   editView.dirty=true;
  };
  const observer=new MutationObserver(sync);observer.observe(panel,{attributes:true,attributeFilter:['hidden'],childList:true,subtree:true});sync();
  return true;
 };
 if(connect())return;
 const ready=new MutationObserver(()=>{if(connect())ready.disconnect();});ready.observe(document.body,{childList:true,subtree:true});
}

// View preferences are deliberately separate from workspaceSnapshot/project/history.
function setupStudioPaneSizing(){
 const root=document.documentElement,workspace=$('createWorkspace'),key='animation-studio-pane-sizes-v1';
 let sizes={};try{const value=JSON.parse(localStorage.getItem(key)||'{}');if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))if(Number.isFinite(v))sizes[k]=v;}catch{}
 const save=()=>{try{localStorage.setItem(key,JSON.stringify(sizes));}catch{}};
 const originalTimelineBounds=studioTimelineBounds;studioTimelineBounds=()=>{if(innerWidth>700)return originalTimelineBounds();const stage=document.querySelector('.stage'),fixed=[...stage.children].filter(el=>!['viewportGrid','viewportShell','animationArea'].includes(el.id)).reduce((sum,el)=>sum+el.getBoundingClientRect().height,0),max=Math.max(0,Math.min(500,stage.clientHeight-fixed-Math.min(Math.ceil(innerHeight*.45),Math.max(100,stage.clientHeight-fixed-80))));return{min:Math.min(80,max),max};};
 const bounds=(min,max)=>[Math.min(min,Math.max(0,max)),Math.max(0,max)];
 const sizeKey=kind=>innerWidth<=700?'mobile-'+kind:kind;
 const widthBounds=()=>bounds(innerWidth<=700?140:180,Math.max(0,innerWidth<=700?workspace.clientWidth*.8:Math.min(workspace.clientWidth*.4,(workspace.clientWidth-240)/2)));
 const specs={
  scene:{variable:'--studio-scene-width',axis:'x',sign:-1,range:widthBounds,fallback:400},
  left:{variable:'--studio-left-width',axis:'x',sign:1,range:widthBounds,fallback:260},
  right:{variable:'--right-width',axis:'x',sign:-1,range:widthBounds,fallback:320},
  timeline:{variable:'--timeline-height',axis:'y',sign:-1,range:()=>{const b=studioTimelineBounds();return[b.min,b.max];},fallback:240},
  compareSide:{variable:'--compare-side-width',axis:'x',sign:-1,range:()=>bounds(innerWidth<=700?80:180,innerWidth*.45),fallback:300,target:$('compareWorkspace')},
  compareSplit:{variable:'--compare-split',axis:'x',sign:1,range:()=>[20,80],fallback:50,unit:'%',scale:()=>100/document.querySelector('.compare-grid').clientWidth,target:$('compareWorkspace')}
 };
 const handles=new Map();let drag=null;
 const apply=(kind,value)=>{const spec=specs[kind],[min,max]=spec.range(),n=Math.max(min,Math.min(max,value));(spec.target||root).style.setProperty(spec.variable,n+(spec.unit||'px'));const h=handles.get(kind);if(h){h.setAttribute('aria-valuemin',Math.round(min));h.setAttribute('aria-valuemax',Math.round(max));h.setAttribute('aria-valuenow',Math.round(n));}return n;};
 const restore=()=>{for(const[k,s]of Object.entries(specs))apply(k,sizes[sizeKey(k)]??s.fallback);};
 const bind=(handle,kind)=>{
  if(!handle)return;handles.set(kind,handle);const spec=specs[kind];handle.setAttribute('aria-orientation',spec.axis==='x'?'vertical':'horizontal');handle.tabIndex=0;
  const end=(cancel=false)=>{if(!drag||drag.handle!==handle)return;const d=drag;drag=null;if(cancel)apply(kind,d.start);else{sizes[sizeKey(kind)]=d.value;save();}if(handle.hasPointerCapture(d.id))handle.releasePointerCapture(d.id);document.body.classList.remove('studio-pane-dragging');};
  handle.addEventListener('pointerdown',e=>{if(e.button!==0||!e.isPrimary||workspace.dataset.maximized)return;e.stopImmediatePropagation();e.preventDefault();const start=parseFloat((spec.target||root).style.getPropertyValue(spec.variable))||spec.fallback;drag={handle,id:e.pointerId,start,value:start,position:spec.axis==='x'?e.clientX:e.clientY};handle.setPointerCapture(e.pointerId);handle.focus({preventScroll:true});document.body.classList.add('studio-pane-dragging');},true);
  handle.addEventListener('pointermove',e=>{if(drag?.handle!==handle||drag.id!==e.pointerId)return;e.stopImmediatePropagation();const position=spec.axis==='x'?e.clientX:e.clientY;drag.value=apply(kind,drag.start+(position-drag.position)*spec.sign*(spec.scale?.()||1));},true);
  for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,e=>{if(drag?.handle!==handle)return;e.stopImmediatePropagation();end(event==='pointercancel');},true);
  handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape'].includes(e.key))return;e.stopImmediatePropagation();e.preventDefault();if(e.key==='Escape'){end(true);return;}if(workspace.dataset.maximized)return;const[min,max]=spec.range(),current=parseFloat((spec.target||root).style.getPropertyValue(spec.variable))||spec.fallback;const n=e.key==='Home'?min:e.key==='End'?max:current+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)*spec.sign*(e.shiftKey?30:10)*(spec.unit==='%'?.1:1);sizes[sizeKey(kind)]=apply(kind,n);save();},true);
  window.addEventListener('blur',()=>end());
 };
 bind(document.querySelector('[data-resize=right]'),'right');bind(document.querySelector('[data-resize=timeline]'),'timeline');bind(document.querySelector('.compare-side-resize'),'compareSide');bind($('compareABResize'),'compareSplit');
 // The existing animation picker becomes the left dock; all buttons/listeners survive.
 const dock=()=>{const panel=$('floatingAnimationList');if(!panel||panel.dataset.paneDock)return;panel.dataset.paneDock='true';workspace.prepend(panel);const grip=document.createElement('div');grip.id='studioLeftDivider';grip.className='studio-left-divider';grip.setAttribute('role','separator');grip.setAttribute('aria-label','Đổi rộng danh sách animation');panel.after(grip);bind(grip,'left');const sync=()=>{workspace.classList.toggle('studio-left-open',!panel.hidden);if(innerWidth<=700){workspace.classList.toggle('studio-mobile-left-open',!panel.hidden);if(!panel.hidden)workspace.classList.remove('studio-mobile-right-open');}};new MutationObserver(sync).observe(panel,{attributes:true,attributeFilter:['hidden']});sync();};
 const sceneDock=()=>{const panel=$('sceneStudioDialog');if(!panel||$('studioSceneDivider'))return;const grip=document.createElement('div');grip.id='studioSceneDivider';grip.className='studio-scene-divider';grip.setAttribute('role','separator');grip.setAttribute('aria-label','Đổi rộng công cụ cảnh');panel.prepend(grip);bind(grip,'scene');};
 const ready=new MutationObserver(()=>{dock();sceneDock();});ready.observe(workspace,{childList:true,subtree:true});dock();sceneDock();
 const mobileTools=document.createElement('div');mobileTools.className='studio-mobile-pane-tools';
 for(const[kind,label]of [['left','Animation'],['right','Công cụ']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label','Mở / đóng '+label);button.dataset.mobilePane=kind;button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',kind==='left'?'floatingAnimationList':'minimalSidebar');button.addEventListener('click',()=>{const cls='studio-mobile-'+kind+'-open',open=!workspace.classList.contains(cls);workspace.classList.remove('studio-mobile-left-open','studio-mobile-right-open');if(open){if(kind==='left'&&$('floatingAnimationList')?.hidden)$('animationListToggle').click();workspace.classList.add(cls);}button.setAttribute('aria-expanded',String(open));});mobileTools.append(button);}
 const syncMobileButtons=()=>{for(const button of mobileTools.children)button.setAttribute('aria-expanded',String(workspace.classList.contains('studio-mobile-'+button.dataset.mobilePane+'-open')));};new MutationObserver(syncMobileButtons).observe(workspace,{attributes:true,attributeFilter:['class']});
 document.querySelector('.stage-toolbar').prepend(mobileTools);
 // Legacy layout application must not overwrite locally saved view sizes.
 const originalApply=applyWorkspaceLayout;applyWorkspaceLayout=(...args)=>{const result=originalApply(...args);restore();return result;};
 window.addEventListener('resize',restore);$('resetLayout').addEventListener('click',()=>{sizes={};save();restore();});restore();
}
