import './style.css';
import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'optica_virtual_frames_v1';
const colorMap = {
  'Negro':'#20242b','Dorado':'#b99550','Plateado':'#aeb7c2','Transparente':'#c9d1d8',
  'Carey':'#754b2e','Azul':'#355d91','Rosa':'#c9828c','Verde':'#426c5b','Marrón':'#6c4936'
};
const defaults = [
  {id:'classic-01',name:'Milano Classic',price:49.99,category:'Clásicos',colors:['Negro','Dorado','Carey'],modelUrl:'',imageUrl:''},
  {id:'modern-02',name:'Urban Square',price:59.99,category:'Modernos',colors:['Negro','Transparente','Azul'],modelUrl:'',imageUrl:''},
  {id:'elegant-03',name:'Luna Gold',price:69.50,category:'Elegantes',colors:['Dorado','Plateado','Rosa'],modelUrl:'',imageUrl:''},
  {id:'classic-04',name:'Aviator One',price:54.00,category:'Clásicos',colors:['Dorado','Negro','Verde'],modelUrl:'',imageUrl:''},
  {id:'modern-05',name:'Studio Clear',price:44.99,category:'Modernos',colors:['Transparente','Rosa','Negro'],modelUrl:'',imageUrl:''},
  {id:'elegant-06',name:'Heritage',price:74.99,category:'Elegantes',colors:['Carey','Marrón','Dorado'],modelUrl:'',imageUrl:''}
];
let frames = loadFrames();
let selectedId = frames[0]?.id ?? null;
let selectedColor = frames[0]?.colors[0] ?? 'Negro';
let currentFilter = 'Todos';
let favorites = new Set();
let stream = null, landmarker = null, tracking = false, lastVideoTime = -1;
let activeCamera = 'user', activeGlasses = null, activeModelUrl = '';
let scene, threeCamera, renderer, glassesRoot, frameMaterial, lensMaterial, animationFrame;
const video = $('video'), host = $('threeHost');

function loadFrames(){ try { const v=JSON.parse(localStorage.getItem(STORAGE_KEY)); return Array.isArray(v)&&v.length?v:defaults.map(x=>({...x})); } catch { return defaults.map(x=>({...x})); } }
function saveFrames(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(frames)); }
function selectedFrame(){ return frames.find(f=>f.id===selectedId) || frames[0]; }
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0)}
function miniGlasses(color){return `<div class="mini-glasses" style="--frame-color:${colorMap[color]||'#20242b'}"><span class="lens"></span><i class="bridge"></i><span class="lens"></span></div>`}
function renderCatalog(){
  const visible=frames.filter(f=>currentFilter==='Todos'||f.category===currentFilter);
  $('frameCount').textContent=`${frames.length} estilos`;
  $('frameGrid').innerHTML=visible.length?visible.map(f=>`<button class="frame-card ${f.id===selectedId?'selected':''}" data-id="${esc(f.id)}"><div class="frame-art">${f.imageUrl?`<img src="${esc(f.imageUrl)}" alt="${esc(f.name)}" onerror="this.style.display='none'">`:miniGlasses(colorMap[f.colors[0]]?f.colors[0]:'Negro')}</div><div class="frame-name">${esc(f.name)}</div><div class="frame-meta"><span>${esc(f.category)}</span><span class="frame-price">${fmt(f.price)}</span></div></button>`).join(''):`<div class="empty-state">No hay monturas en esta categoría.</div>`;
  $('frameGrid').querySelectorAll('.frame-card').forEach(b=>b.addEventListener('click',()=>selectFrame(b.dataset.id)));
  renderSelected();
}
function renderSelected(){
  const f=selectedFrame(); if(!f){$('selectedProduct').innerHTML='<strong>Agrega una montura desde Administración</strong>'; $('swatches').innerHTML='';return;}
  if(!f.colors.includes(selectedColor)) selectedColor=f.colors[0]||'Negro';
  $('selectedProduct').innerHTML=`<div><strong>${esc(f.name)}</strong><p>${esc(f.category)} · Modelo virtual</p></div><div class="selected-price">${fmt(f.price)}</div>`;
  $('colorName').textContent=selectedColor;
  $('swatches').innerHTML=(f.colors||['Negro']).map(c=>`<button class="swatch ${c===selectedColor?'selected':''}" title="${esc(c)}" aria-label="${esc(c)}" data-color="${esc(c)}" style="background:${colorMap[c]||'#20242b'}"></button>`).join('');
  $('swatches').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{selectedColor=b.dataset.color;$('colorName').textContent=selectedColor;renderSelected();updateGlassesColor();}));
  $('favoriteBtn').textContent=favorites.has(f.id)?'♥ Guardado en favoritos':'♡ Guardar en favoritos';
  updateGlasses();
}
function selectFrame(id){selectedId=id;const f=selectedFrame();selectedColor=f?.colors[0]||'Negro';renderCatalog();}
$('filters').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{currentFilter=b.dataset.filter;$('filters').querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b));renderCatalog();}));
$('favoriteBtn').addEventListener('click',()=>{const f=selectedFrame();if(!f)return;favorites.has(f.id)?favorites.delete(f.id):favorites.add(f.id);renderSelected();});

function initThree(){
  scene=new THREE.Scene();
  threeCamera=new THREE.OrthographicCamera(-1,1,1,-1,0.1,100);threeCamera.position.z=10;
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setSize(host.clientWidth||640,host.clientHeight||480);renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff,1.8));const light=new THREE.DirectionalLight(0xffffff,2.2);light.position.set(0,2,6);scene.add(light);
  glassesRoot=new THREE.Group();scene.add(glassesRoot);createProceduralGlasses('#20242b');
  const resize=()=>{const w=host.clientWidth||640,h=host.clientHeight||480;renderer.setSize(w,h,false);threeCamera.left=-w/2;threeCamera.right=w/2;threeCamera.top=h/2;threeCamera.bottom=-h/2;threeCamera.updateProjectionMatrix();};
  new ResizeObserver(resize).observe(host);resize();
  const animate=()=>{animationFrame=requestAnimationFrame(animate);renderer.render(scene,threeCamera);};animate();
}
function roundedRectShape(w,h,r){
  const s=new THREE.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s;
}
function createProceduralGlasses(hex){
  if(!glassesRoot)return;
  while(glassesRoot.children.length){const obj=glassesRoot.children.pop();obj.traverse?.(n=>{n.geometry?.dispose?.();if(n.material){(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m.dispose?.());}});}
  const color=new THREE.Color(hex);frameMaterial=new THREE.MeshStandardMaterial({color,metalness:hex==='#b99550'||hex==='#aeb7c2'?.72:.3,roughness:.28});
  lensMaterial=new THREE.MeshPhysicalMaterial({color:0x9db7c9,transparent:true,opacity:.13,roughness:.12,metalness:0,clearcoat:1,side:THREE.DoubleSide,depthWrite:false});
  const width=112,height=70,thickness=5, gap=13, corner=17;
  for(const side of [-1,1]){
    const x=side*(width/2+gap/2);
    const shape=roundedRectShape(width,height,corner);const geo=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:1.5,bevelThickness:1.5});
    const rim=new THREE.Mesh(geo,frameMaterial);rim.position.set(x,0,0);glassesRoot.add(rim);
    const lensShape=roundedRectShape(width-13,height-13,corner-5);const lensGeo=new THREE.ShapeGeometry(lensShape);const lens=new THREE.Mesh(lensGeo,lensMaterial);lens.position.set(x,0,thickness+1);glassesRoot.add(lens);
  }
  const bridge=new THREE.Mesh(new THREE.TorusGeometry(14,2.7,8,24,Math.PI),frameMaterial);bridge.rotation.z=Math.PI;bridge.position.set(0,2,thickness/2);glassesRoot.add(bridge);
  // Hinges and temples extend backward from the frame.
  for(const side of [-1,1]){
    const hinge=new THREE.Mesh(new THREE.BoxGeometry(14,5,5),frameMaterial);hinge.position.set(side*(width+gap/2-2),2,0);glassesRoot.add(hinge);
    const temple=new THREE.Mesh(new THREE.BoxGeometry(80,4,4),frameMaterial);temple.position.set(side*(width+gap/2+35),-1,-12);temple.rotation.y=side*.13;glassesRoot.add(temple);
  }
  activeGlasses='procedural';activeModelUrl='';
}
function updateGlassesColor(){const hex=colorMap[selectedColor]||'#20242b';if(activeGlasses==='procedural'){createProceduralGlasses(hex);}else{glassesRoot?.traverse(o=>{if(o.isMesh&&o.material&&o.userData?.isFrame){o.material.color.set(hex);}});}}
async function updateGlasses(){
  const f=selectedFrame();if(!f||!glassesRoot)return;
  const hex=colorMap[selectedColor]||'#20242b';
  if(f.modelUrl && f.modelUrl!==activeModelUrl){
    try{
      const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
      const loader=new GLTFLoader();const gltf=await loader.loadAsync(f.modelUrl);
      while(glassesRoot.children.length){const obj=glassesRoot.children.pop();obj.traverse?.(n=>{n.geometry?.dispose?.();});}
      const model=gltf.scene;model.scale.setScalar(1);const box=new THREE.Box3().setFromObject(model);const size=box.getSize(new THREE.Vector3());const max=Math.max(size.x,size.y,size.z)||1;model.scale.setScalar(240/max);const center=box.getCenter(new THREE.Vector3());model.position.set(-center.x*model.scale.x,-center.y*model.scale.y,-center.z*model.scale.z);model.traverse(o=>{if(o.isMesh&&o.material){o.material=o.material.clone();o.userData.isFrame=true;}});glassesRoot.add(model);activeGlasses='glb';activeModelUrl=f.modelUrl;updateGlassesColor();
    }catch(e){console.warn('No se pudo cargar el modelo GLB; se usará una montura de demostración.',e);createProceduralGlasses(hex);}
  }else if(!f.modelUrl){createProceduralGlasses(hex);}
}
function landmarkPoint(lm,w,h){return {x:(0.5-lm.x)*w,y:(0.5-lm.y)*h,z:lm.z};}
function trackFace(result){
  const lm=result.faceLandmarks?.[0];if(!lm||!glassesRoot){$('trackingStatus').textContent='No se detecta un rostro. Mira hacia la cámara.';$('cameraStatus').textContent='Buscando rostro…';glassesRoot.visible=false;return;}
  glassesRoot.visible=true;$('trackingStatus').textContent='Rostro detectado · mueve la cabeza suavemente';$('cameraStatus').textContent='Probador activo';
  const w=host.clientWidth,h=host.clientHeight;
  // Eye corners: 33/133 (viewer-left eye), 362/263 (viewer-right eye).
  const left=landmarkPoint(lm[33],w,h),right=landmarkPoint(lm[263],w,h);
  const eyeMid={x:(left.x+right.x)/2,y:(left.y+right.y)/2};
  const eyeDist=Math.hypot(right.x-left.x,right.y-left.y);
  // Face is mirrored in CSS; flip X coordinates for overlay to match the mirrored video.
  glassesRoot.position.set(eyeMid.x,eyeMid.y+3,0);
  const baseWidth=250;
  const scale=Math.max(.35,Math.min(1.65,eyeDist*2.35/baseWidth));
  glassesRoot.scale.set(scale,scale,scale);
  glassesRoot.rotation.z=Math.atan2(right.y-left.y,right.x-left.x);
}
async function startCamera(){
  if(!navigator.mediaDevices?.getUserMedia){alert('Tu navegador no permite acceder a la cámara. Usa Chrome o Safari actualizado y abre el sitio con HTTPS o localhost.');return;}
  try{
    $('startCamera').disabled=true;$('startCamera').textContent='Iniciando…';
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:activeCamera,width:{ideal:1280},height:{ideal:720}},audio:false});
    video.srcObject=stream;video.classList.add('visible');await video.play();$('cameraPlaceholder').hidden=true;$('cameraStatus').textContent='Cargando detección…';
    if(!landmarker){
      const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
      landmarker=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'},runningMode:'VIDEO',numFaces:1,outputFacialTransformationMatrixes:true});
    }
    tracking=true;lastVideoTime=-1;$('cameraStatus').textContent='Buscando rostro…';$('trackingStatus').textContent='Coloca tu rostro frente a la cámara';loop();
  }catch(e){console.error(e);alert('No se pudo iniciar la cámara o cargar el detector. Verifica el permiso de cámara y tu conexión a Internet.');stopCamera();}
  finally{$('startCamera').disabled=false;$('startCamera').textContent='Activar cámara';}
}
function loop(){
  if(!tracking)return;
  if(video.readyState>=2&&video.currentTime!==lastVideoTime){
    try{const result=landmarker.detectForVideo(video,performance.now());trackFace(result);lastVideoTime=video.currentTime;}catch(e){console.error(e);}
  }
  requestAnimationFrame(loop);
}
function stopCamera(){
  tracking=false;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}video.srcObject=null;video.classList.remove('visible');$('cameraPlaceholder').hidden=false;$('cameraStatus').textContent='Cámara apagada';$('trackingStatus').textContent='Activa la cámara para comenzar';if(glassesRoot)glassesRoot.visible=false;
}
$('startCamera').addEventListener('click',startCamera);$('stopCamera').addEventListener('click',stopCamera);
$('flipCamera').addEventListener('click',async()=>{if(!stream)return;activeCamera=activeCamera==='user'?'environment':'user';stopCamera();await startCamera();});

function showPage(page){
  const admin=page==='admin';$('tryOnPage').hidden=admin;$('adminPage').hidden=!admin;$('tryOnTab').classList.toggle('active',!admin);$('adminTab').classList.toggle('active',admin);
  if(admin)renderAdmin();
}
$('tryOnTab').addEventListener('click',()=>showPage('tryon'));$('adminTab').addEventListener('click',()=>showPage('admin'));
function resetForm(){ $('frameForm').reset();$('frameId').value='';$('formTitle').textContent='Agregar montura';$('saveFrame').textContent='Guardar montura';}
$('cancelEdit').addEventListener('click',resetForm);
$('frameForm').addEventListener('submit',e=>{
  e.preventDefault();
  const id=$('frameId').value||`frame-${Date.now()}`;
  const item={id,name:$('frameName').value.trim(),price:Number($('framePrice').value),category:$('frameCategory').value,colors:$('frameColors').value.split(',').map(x=>x.trim()).filter(Boolean),modelUrl:$('frameModel').value.trim(),imageUrl:$('frameImage').value.trim()};
  if(!item.colors.length){alert('Agrega al menos un color.');return;}
  const idx=frames.findIndex(f=>f.id===id);if(idx>=0)frames[idx]=item;else frames.push(item);
  saveFrames();if(!selectedId||idx<0)selectedId=id;selectedColor=item.colors[0];resetForm();renderCatalog();renderAdmin();
});
function renderAdmin(){
  $('adminCount').textContent=frames.length;
  $('adminList').innerHTML=frames.length?frames.map(f=>`<div class="admin-item"><div class="admin-thumb">${miniGlasses(f.colors?.[0]||'Negro')}</div><div class="admin-item-info"><strong>${esc(f.name)} · ${fmt(f.price)}</strong><small>${esc(f.category)} · ${esc((f.colors||[]).join(', '))}${f.modelUrl?' · GLB vinculado':''}</small></div><div class="admin-actions"><button class="small-btn" data-edit="${esc(f.id)}">Editar</button><button class="small-btn delete" data-delete="${esc(f.id)}">Eliminar</button></div></div>`).join(''):'<div class="empty-state">Todavía no hay monturas registradas.</div>';
  $('adminList').querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>{const f=frames.find(x=>x.id===b.dataset.edit);if(!f)return;$('frameId').value=f.id;$('frameName').value=f.name;$('framePrice').value=f.price;$('frameCategory').value=f.category;$('frameColors').value=f.colors.join(', ');$('frameModel').value=f.modelUrl||'';$('frameImage').value=f.imageUrl||'';$('formTitle').textContent='Editar montura';$('saveFrame').textContent='Guardar cambios';window.scrollTo({top:0,behavior:'smooth'});}));
  $('adminList').querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',()=>{const f=frames.find(x=>x.id===b.dataset.delete);if(!f||!confirm(`¿Eliminar ${f.name}?`))return;frames=frames.filter(x=>x.id!==f.id);if(selectedId===f.id)selectedId=frames[0]?.id||null;saveFrames();renderCatalog();renderAdmin();}));
}
window.addEventListener('beforeunload',()=>{stopCamera();if(animationFrame)cancelAnimationFrame(animationFrame);renderer?.dispose();});
initThree();renderCatalog();renderAdmin();if(glassesRoot)glassesRoot.visible=false;
