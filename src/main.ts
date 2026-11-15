import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as WebIFC from 'web-ifc';
import './style.css';

// ─── DOM Elements ──────────────────────────────────────────
const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const loadBtn = document.getElementById('load-btn') as HTMLLabelElement;
const sampleBtn = document.getElementById('sample-btn') as HTMLButtonElement | null;
const fitBtn = document.getElementById('fit-btn') as HTMLButtonElement;
const sectionBtn = document.getElementById('section-btn') as HTMLButtonElement;
const treeBtn = document.getElementById('tree-btn') as HTMLButtonElement;
const unhideAllBtn = document.getElementById('unhide-all-btn') as HTMLButtonElement;
const hiddenCountSpan = document.getElementById('hidden-count') as HTMLSpanElement;
const assemblyBtn = document.getElementById('assembly-btn') as HTMLButtonElement | null;
const wireframeBtn = document.getElementById('wireframe-btn') as HTMLButtonElement;
const orthoBtn = document.getElementById('ortho-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const dropOverlay = document.getElementById('drop-overlay') as HTMLDivElement;

const propsPanel = document.getElementById('props-panel') as HTMLDivElement;
const propsClose = document.getElementById('props-close') as HTMLButtonElement;
const propsContent = document.getElementById('props-content') as HTMLDivElement;
const hideElemBtn = document.getElementById('hide-elem-btn') as HTMLButtonElement;
const isolateElemBtn = document.getElementById('isolate-elem-btn') as HTMLButtonElement;

const loadingOverlay = document.getElementById('loading') as HTMLDivElement;
const loadingText = document.getElementById('loading-text') as HTMLDivElement;

// ─── Section Box DOM Elements ─────────────────────────────
const sectionPanel = document.getElementById('section-panel') as HTMLDivElement;
const sectionClose = document.getElementById('section-close') as HTMLButtonElement;
const sectionReset = document.getElementById('section-reset') as HTMLButtonElement;
const sectionFitVisible = document.getElementById('section-fit-visible') as HTMLButtonElement;
const showBoxToggle = document.getElementById('show-box-toggle') as HTMLInputElement;

const clipXMin = document.getElementById('clip-x-min') as HTMLInputElement;
const clipXMax = document.getElementById('clip-x-max') as HTMLInputElement;
const clipYMin = document.getElementById('clip-y-min') as HTMLInputElement;
const clipYMax = document.getElementById('clip-y-max') as HTMLInputElement;
const clipZMin = document.getElementById('clip-z-min') as HTMLInputElement;
const clipZMax = document.getElementById('clip-z-max') as HTMLInputElement;

const xVal = document.getElementById('x-val') as HTMLSpanElement;
const yVal = document.getElementById('y-val') as HTMLSpanElement;
const zVal = document.getElementById('z-val') as HTMLSpanElement;

// ─── Model Tree / Categories DOM Elements ─────────────────
const treePanel = document.getElementById('tree-panel') as HTMLDivElement;
const treeClose = document.getElementById('tree-close') as HTMLButtonElement;
const treeContent = document.getElementById('tree-content') as HTMLDivElement;
const treeSearchInput = document.getElementById('tree-search-input') as HTMLInputElement | null;
const hideHelpersBtn = document.getElementById('hide-helpers-btn') as HTMLButtonElement;
const treeShowAllBtn = document.getElementById('tree-show-all-btn') as HTMLButtonElement;

// ─── Three.js Scene Setup ──────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

// Grid helper
const gridHelper = new THREE.GridHelper(100, 100, 0x2a2a4a, 0x1f1f3a);
scene.add(gridHelper);

// Axes helper
const axesHelper = new THREE.AxesHelper(5);
scene.add(axesHelper);

// Perspective camera (default)
const perspCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 10000);
perspCamera.position.set(20, 20, 20);

// Orthographic camera
const orthoCamera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 10000);
orthoCamera.position.set(20, 20, 20);

let activeCamera: THREE.Camera = perspCamera;
let isOrtho = false;

// Renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;

// Orbit controls
const controls = new OrbitControls(activeCamera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(50, 80, 50);
dirLight.castShadow = true;
scene.add(dirLight);

const hemiLight = new THREE.HemisphereLight(0xaaccff, 0x445566, 0.4);
scene.add(hemiLight);

// ─── State ─────────────────────────────────────────────────
let modelGroup: THREE.Group | null = null;
let wireframeMode = false;
let ifcAPI: WebIFC.IfcAPI | null = null;
let currentModelID = -1;

// Raycasting for element picking
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredMesh: THREE.Mesh | null = null;
let hoveredMeshes: THREE.Mesh[] = [];
let selectedMesh: THREE.Mesh | null = null;
let selectedMeshes: THREE.Mesh[] = [];
let assemblyModeEnabled = true;
const highlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xe94560,
  transparent: true,
  opacity: 0.6,
  depthTest: true,
});
const selectedMaterial = new THREE.MeshStandardMaterial({
  color: 0xff6b81,
  transparent: true,
  opacity: 0.7,
  depthTest: true,
});

// Store original materials
const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

// ─── Section Box (3D Clipping) State & Objects ────────────
let sectionBoxEnabled = false;
const modelBounds = new THREE.Box3();
const currentMin = new THREE.Vector3();
const currentMax = new THREE.Vector3();

// 6 Planes (points with dot product >= 0 are kept):
// +X keeps x >= min.x, -X keeps x <= max.x
// +Y keeps y >= min.y, -Y keeps y <= max.y
// +Z keeps z >= min.z, -Z keeps z <= max.z
const clippingPlanes = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
  new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), 0),
];

const sectionBoxGroup = new THREE.Group();
sectionBoxGroup.visible = false;
scene.add(sectionBoxGroup);

// Semi-transparent box volume
const boxMaterial = new THREE.MeshBasicMaterial({
  color: 0x00d2ff,
  transparent: true,
  opacity: 0.06,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), boxMaterial);
sectionBoxGroup.add(boxMesh);

// Box border edges
const edgesGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const edgesMaterial = new THREE.LineBasicMaterial({
  color: 0x00f0ff,
  transparent: true,
  opacity: 0.85,
});
const boxEdges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
sectionBoxGroup.add(boxEdges);

// 6 Interactive Face Handles for 3D dragging
interface FaceHandle {
  mesh: THREE.Mesh;
  axis: 'x' | 'y' | 'z';
  direction: 1 | -1;
  name: string;
}
const faceHandles: FaceHandle[] = [];

const handleGeometry = new THREE.PlaneGeometry(1, 1);
const handleMaterial = new THREE.MeshBasicMaterial({
  color: 0x00f0ff,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const handleDefs: { name: string; axis: 'x' | 'y' | 'z'; direction: 1 | -1; rot: [number, number, number] }[] = [
  { name: '+x', axis: 'x', direction: 1, rot: [0, Math.PI / 2, 0] },
  { name: '-x', axis: 'x', direction: -1, rot: [0, -Math.PI / 2, 0] },
  { name: '+y', axis: 'y', direction: 1, rot: [-Math.PI / 2, 0, 0] },
  { name: '-y', axis: 'y', direction: -1, rot: [Math.PI / 2, 0, 0] },
  { name: '+z', axis: 'z', direction: 1, rot: [0, 0, 0] },
  { name: '-z', axis: 'z', direction: -1, rot: [0, Math.PI, 0] },
];

for (const def of handleDefs) {
  const mesh = new THREE.Mesh(handleGeometry, handleMaterial.clone());
  mesh.rotation.set(...def.rot);
  mesh.userData = { isHandle: true, axis: def.axis, direction: def.direction, name: def.name };
  sectionBoxGroup.add(mesh);
  faceHandles.push({ mesh, axis: def.axis, direction: def.direction, name: def.name });
}

// ─── Model Elements & Visibility State ─────────────────────
interface ModelElement {
  mesh: THREE.Mesh;
  expressID: number;
  modelID: number;
  typeName: string;
  name: string;
}
const allModelElements: ModelElement[] = [];
const hiddenMeshSet = new Set<THREE.Mesh>();

function getVisibleModelBounds(): THREE.Box3 {
  const box = new THREE.Box3();
  if (modelGroup) {
    modelGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.visible) {
        box.expandByObject(child);
      }
    });
  }
  if (box.isEmpty()) {
    box.set(new THREE.Vector3(-5, -5, -5), new THREE.Vector3(5, 5, 5));
  }
  return box;
}

function applyClippingPlanes(enable: boolean) {
  const planes = enable ? clippingPlanes : [];
  if (modelGroup) {
    modelGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => {
            m.clippingPlanes = planes;
            m.clipShadows = true;
            m.needsUpdate = true;
          });
        } else if (child.material) {
          child.material.clippingPlanes = planes;
          child.material.clipShadows = true;
          child.material.needsUpdate = true;
        }
      }
    });
  }
  highlightMaterial.clippingPlanes = planes;
  highlightMaterial.needsUpdate = true;
  selectedMaterial.clippingPlanes = planes;
  selectedMaterial.needsUpdate = true;
}

function updateSectionBoxVisual() {
  const size = new THREE.Vector3().subVectors(currentMax, currentMin);
  const center = new THREE.Vector3().addVectors(currentMin, currentMax).multiplyScalar(0.5);

  boxMesh.position.copy(center);
  boxMesh.scale.copy(size);

  boxEdges.position.copy(center);
  boxEdges.scale.copy(size);

  const minDim = Math.max(0.5, Math.min(size.x, size.y, size.z) * 0.35);

  for (const h of faceHandles) {
    if (h.axis === 'x') {
      const x = h.direction === 1 ? currentMax.x : currentMin.x;
      h.mesh.position.set(x, center.y, center.z);
      h.mesh.scale.set(Math.min(minDim, size.z * 0.8), Math.min(minDim, size.y * 0.8), 1);
    } else if (h.axis === 'y') {
      const y = h.direction === 1 ? currentMax.y : currentMin.y;
      h.mesh.position.set(center.x, y, center.z);
      h.mesh.scale.set(Math.min(minDim, size.x * 0.8), Math.min(minDim, size.z * 0.8), 1);
    } else if (h.axis === 'z') {
      const z = h.direction === 1 ? currentMax.z : currentMin.z;
      h.mesh.position.set(center.x, center.y, z);
      h.mesh.scale.set(Math.min(minDim, size.x * 0.8), Math.min(minDim, size.y * 0.8), 1);
    }
  }

  clippingPlanes[0].set(new THREE.Vector3(1, 0, 0), -currentMin.x);
  clippingPlanes[1].set(new THREE.Vector3(-1, 0, 0), currentMax.x);
  clippingPlanes[2].set(new THREE.Vector3(0, 1, 0), -currentMin.y);
  clippingPlanes[3].set(new THREE.Vector3(0, -1, 0), currentMax.y);
  clippingPlanes[4].set(new THREE.Vector3(0, 0, 1), -currentMin.z);
  clippingPlanes[5].set(new THREE.Vector3(0, 0, -1), currentMax.z);
}

function updateSectionUI() {
  const totalSize = new THREE.Vector3().subVectors(modelBounds.max, modelBounds.min);

  const xMinPct = totalSize.x > 0 ? ((currentMin.x - modelBounds.min.x) / totalSize.x) * 100 : 0;
  const xMaxPct = totalSize.x > 0 ? ((currentMax.x - modelBounds.min.x) / totalSize.x) * 100 : 100;
  const yMinPct = totalSize.y > 0 ? ((currentMin.y - modelBounds.min.y) / totalSize.y) * 100 : 0;
  const yMaxPct = totalSize.y > 0 ? ((currentMax.y - modelBounds.min.y) / totalSize.y) * 100 : 100;
  const zMinPct = totalSize.z > 0 ? ((currentMin.z - modelBounds.min.z) / totalSize.z) * 100 : 0;
  const zMaxPct = totalSize.z > 0 ? ((currentMax.z - modelBounds.min.z) / totalSize.z) * 100 : 100;

  clipXMin.value = xMinPct.toFixed(1);
  clipXMax.value = xMaxPct.toFixed(1);
  clipYMin.value = yMinPct.toFixed(1);
  clipYMax.value = yMaxPct.toFixed(1);
  clipZMin.value = zMinPct.toFixed(1);
  clipZMax.value = zMaxPct.toFixed(1);

  xVal.textContent = `${Math.round(xMinPct)}% – ${Math.round(xMaxPct)}%`;
  yVal.textContent = `${Math.round(yMinPct)}% – ${Math.round(yMaxPct)}%`;
  zVal.textContent = `${Math.round(zMinPct)}% – ${Math.round(zMaxPct)}%`;
}

function onSliderInput() {
  const totalSize = new THREE.Vector3().subVectors(modelBounds.max, modelBounds.min);

  let x0 = parseFloat(clipXMin.value) / 100;
  let x1 = parseFloat(clipXMax.value) / 100;
  if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }

  let y0 = parseFloat(clipYMin.value) / 100;
  let y1 = parseFloat(clipYMax.value) / 100;
  if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }

  let z0 = parseFloat(clipZMin.value) / 100;
  let z1 = parseFloat(clipZMax.value) / 100;
  if (z0 > z1) { const t = z0; z0 = z1; z1 = t; }

  currentMin.x = modelBounds.min.x + x0 * totalSize.x;
  currentMax.x = modelBounds.min.x + x1 * totalSize.x;
  currentMin.y = modelBounds.min.y + y0 * totalSize.y;
  currentMax.y = modelBounds.min.y + y1 * totalSize.y;
  currentMin.z = modelBounds.min.z + z0 * totalSize.z;
  currentMax.z = modelBounds.min.z + z1 * totalSize.z;

  xVal.textContent = `${Math.round(x0 * 100)}% – ${Math.round(x1 * 100)}%`;
  yVal.textContent = `${Math.round(y0 * 100)}% – ${Math.round(y1 * 100)}%`;
  zVal.textContent = `${Math.round(z0 * 100)}% – ${Math.round(z1 * 100)}%`;

  updateSectionBoxVisual();
}

function resetSectionBox() {
  currentMin.copy(modelBounds.min);
  currentMax.copy(modelBounds.max);
  updateSectionBoxVisual();
  updateSectionUI();
}

function fitSectionBoxToVisible() {
  if (!modelGroup || modelGroup.children.length === 0) return;

  const box = getVisibleModelBounds();
  const size = box.getSize(new THREE.Vector3());
  const margin = Math.max(0.1, size.length() * 0.005);

  modelBounds.min.copy(box.min).subScalar(margin);
  modelBounds.max.copy(box.max).addScalar(margin);

  currentMin.copy(modelBounds.min);
  currentMax.copy(modelBounds.max);

  updateSectionBoxVisual();
  updateSectionUI();
  setStatus('🎯 Границы куба подрезки подогнаны под видимые конструкции');
}

function toggleSectionBox() {
  if (!modelGroup || modelGroup.children.length === 0) {
    setStatus('⚠️ Сначала загрузите модель');
    return;
  }

  sectionBoxEnabled = !sectionBoxEnabled;
  sectionBtn.classList.toggle('active', sectionBoxEnabled);

  if (sectionBoxEnabled) {
    fitSectionBoxToVisible();
    sectionBoxGroup.visible = showBoxToggle.checked;
    sectionPanel.classList.remove('hidden');

    applyClippingPlanes(true);
    setStatus('✂️ Куб подрезки включён: двигайте ползунки или тяните грани в 3D');
  } else {
    sectionBoxGroup.visible = false;
    sectionPanel.classList.add('hidden');
    applyClippingPlanes(false);
    setStatus('✂️ Куб подрезки выключен');
  }
}

// ─── Visibility Management Functions ──────────────────────
function setMeshVisibility(mesh: THREE.Mesh, visible: boolean) {
  mesh.visible = visible;
  if (visible) {
    hiddenMeshSet.delete(mesh);
  } else {
    hiddenMeshSet.add(mesh);
  }
}

function updateHiddenStatus() {
  const count = hiddenMeshSet.size;
  hiddenCountSpan.textContent = String(count);
  if (count > 0) {
    unhideAllBtn.classList.remove('hidden');
  } else {
    unhideAllBtn.classList.add('hidden');
  }
  renderTreePanel();
}

function showAllElements() {
  for (const elem of allModelElements) {
    elem.mesh.visible = true;
  }
  hiddenMeshSet.clear();
  updateHiddenStatus();
  setStatus('👁️ Все элементы снова отображаются');

  if (sectionBoxEnabled) {
    fitSectionBoxToVisible();
  }
}

function hideElementByMesh(mesh: THREE.Mesh) {
  const isMulti = selectedMeshes.includes(mesh) && selectedMeshes.length > 1;
  const targets = isMulti ? [...selectedMeshes] : [mesh];
  const count = targets.length;

  for (const m of targets) {
    const id = m.userData.expressID;
    for (const elem of allModelElements) {
      if (elem.expressID === id) {
        setMeshVisibility(elem.mesh, false);
      }
    }
  }

  clearSelection();
  propsPanel.classList.add('hidden');
  updateHiddenStatus();

  if (sectionBoxEnabled) {
    fitSectionBoxToVisible();
  }

  setStatus(isMulti ? `👁️ Скрыта сборка (${count} элементов). Куб подрезки обновлён.` : `👁️ Элемент #${mesh.userData.expressID} скрыт. Куб подрезки обновлён.`);
}

function isolateElementByMesh(mesh: THREE.Mesh) {
  const isMulti = selectedMeshes.includes(mesh) && selectedMeshes.length > 1;
  const targets = isMulti ? [...selectedMeshes] : [mesh];
  const count = targets.length;
  const targetIds = new Set(targets.map((m) => m.userData.expressID));

  for (const elem of allModelElements) {
    if (targetIds.has(elem.expressID)) {
      setMeshVisibility(elem.mesh, true);
    } else {
      setMeshVisibility(elem.mesh, false);
    }
  }

  updateHiddenStatus();
  if (sectionBoxEnabled) {
    fitSectionBoxToVisible();
  }
  fitCameraToModel();
  setStatus(isMulti ? `🎯 Изолирована сборка (${count} элементов)` : `🎯 Изолирован элемент #${mesh.userData.expressID}`);
}

function hideAuxiliarySurfaces() {
  let count = 0;
  for (const elem of allModelElements) {
    const nameLower = (elem.name || '').toLowerCase();
    const typeLower = (elem.typeName || '').toLowerCase();

    // Catch geo-reference, origin, gross volume, sand bedding, site, surface proxies
    if (
      nameLower.includes('geo-reference') ||
      nameLower.includes('origin') ||
      nameLower.includes('gross volume') ||
      nameLower.includes('sand bedding') ||
      nameLower.includes('поверхн') ||
      nameLower.includes('площад') ||
      nameLower.includes('рельеф') ||
      nameLower.includes('земл') ||
      nameLower.includes('участ') ||
      nameLower.includes('генплан') ||
      nameLower.includes('топограф') ||
      nameLower.includes('terrain') ||
      nameLower.includes('surface') ||
      nameLower.includes('topograph') ||
      nameLower.includes('environment') ||
      nameLower.includes('ground') ||
      nameLower.includes('site') ||
      typeLower.includes('site') ||
      typeLower.includes('geographic') ||
      typeLower.includes('surface') ||
      typeLower.includes('terrain') ||
      typeLower.includes('civil') ||
      typeLower.includes('earth')
    ) {
      setMeshVisibility(elem.mesh, false);
      count++;
    }
  }

  if (selectedMesh && !selectedMesh.visible) {
    const orig = originalMaterials.get(selectedMesh);
    if (orig) selectedMesh.material = orig as THREE.Material;
    selectedMesh = null;
    propsPanel.classList.add('hidden');
  }

  updateHiddenStatus();
  if (sectionBoxEnabled) {
    fitSectionBoxToVisible();
  }
  fitCameraToModel();
  setStatus(`🚫 Скрыты вспомогательные поверхности (${count} эл.). Куб подрезки подогнан.`);
}

function isFrameElement(name: string, typeName: string): boolean {
  const n = (name || '').toLowerCase();
  const t = (typeName || '').toLowerCase();
  const isProxyOrGeneric = t.includes('proxy') || t.includes('обобщенные') || t.includes('ifcelement');
  const hasFrameKeyword =
    n.includes('vg_карка') ||
    n.includes('фитинг') ||
    n.includes('стойка') ||
    n.includes('профиль пола') ||
    n.includes('профиль потолка');
  return isProxyOrGeneric && hasFrameKeyword;
}

function getAssemblyElements(target: ModelElement): ModelElement[] {
  if (!assemblyModeEnabled) {
    return [target];
  }
  if (isFrameElement(target.name, target.typeName)) {
    return allModelElements.filter((e) => isFrameElement(e.name, e.typeName));
  }
  return [target];
}

function clearSelection() {
  for (const m of selectedMeshes) {
    const orig = originalMaterials.get(m);
    if (orig) m.material = orig as THREE.Material;
  }
  selectedMeshes = [];
  selectedMesh = null;
}

function selectElementOrAssembly(elem: ModelElement) {
  clearSelection();
  const assembly = getAssemblyElements(elem);
  const isAssembly = assembly.length > 1;

  for (const item of assembly) {
    if (item.mesh.visible) {
      item.mesh.material = selectedMaterial;
      selectedMeshes.push(item.mesh);
    }
  }
  selectedMesh = selectedMeshes[0] || null;

  if (isAssembly) {
    const mainProxy = assembly.find((e) => e.name.toLowerCase().includes('карка')) || elem;
    showAssemblyProperties(mainProxy, assembly);
  } else {
    showProperties(elem.expressID, elem.modelID);
  }
}

function selectElementByID(expressID: number) {
  const elem = allModelElements.find((e) => e.expressID === expressID);
  if (!elem) return;
  selectElementOrAssembly(elem);
}

function renderTreePanel() {
  if (!treePanel || treePanel.classList.contains('hidden')) return;

  const searchQuery = (treeSearchInput?.value || '').trim().toLowerCase();

  const categories = new Map<string, ModelElement[]>();
  for (const elem of allModelElements) {
    const list = categories.get(elem.typeName) || [];
    list.push(elem);
    categories.set(elem.typeName, list);
  }

  let html = '';
  for (const [typeName, elements] of categories) {
    // If search active, filter elements
    const matchingElements = searchQuery
      ? elements.filter(
          (e) =>
            e.name.toLowerCase().includes(searchQuery) ||
            e.typeName.toLowerCase().includes(searchQuery) ||
            String(e.expressID).includes(searchQuery)
        )
      : elements;

    if (searchQuery && matchingElements.length === 0) {
      continue; // Skip categories that don't match search
    }

    const noneVisible = elements.every((e) => !e.mesh.visible);
    const eyeClass = noneVisible ? 'off' : '';
    const eyeIcon = noneVisible ? '👁️‍🗨️' : '👁️';
    const isAutoExpanded = Boolean(searchQuery);

    const frameInThisCat = matchingElements.filter((e) => isFrameElement(e.name, e.typeName));
    let frameAssemblyHtml = '';
    if (frameInThisCat.length > 1 && !searchQuery) {
      const anyFrameVis = frameInThisCat.some((e) => e.mesh.visible);
      frameAssemblyHtml = `
        <div class="tree-item-row" data-frame-assembly="true" style="background: rgba(56,189,248,0.12); border-left: 3px solid #38bdf8; font-weight:600; color:#38bdf8; padding: 6px 8px; margin: 2px 0;" title="Выбрать весь каркас блок-контейнера">
          <span>📦 Каркас блок-контейнера (${frameInThisCat.length} дет.)</span>
          <button class="tree-eye-btn ${anyFrameVis ? '' : 'off'}" data-frame-eye="true" title="Скрыть/показать весь каркас">
            ${anyFrameVis ? '👁️' : '👁️‍🗨️'}
          </button>
        </div>
      `;
    }

    html += `
      <div class="tree-cat-card">
        <div class="tree-cat-header" data-category="${typeName}">
          <div class="tree-cat-title">
            <button class="tree-eye-btn ${eyeClass}" data-cat-eye="${typeName}" title="Скрыть/показать категорию">${eyeIcon}</button>
            <span>${typeName}</span>
          </div>
          <span class="tree-badge">${matchingElements.length}${searchQuery ? ` / ${elements.length}` : ''}</span>
        </div>
        <div class="tree-items-list ${isAutoExpanded ? '' : 'hidden'}" id="cat-list-${typeName}">
          ${frameAssemblyHtml}
          ${matchingElements
            .map(
              (e) => `
            <div class="tree-item-row ${e.mesh.visible ? '' : 'hidden-item'}" data-elem-id="${e.expressID}" title="Кликните для выбора в 3D">
              <span>${e.name || `#${e.expressID}`}</span>
              <button class="tree-eye-btn ${e.mesh.visible ? '' : 'off'}" data-item-eye="${e.expressID}" title="Скрыть/показать этот элемент">
                ${e.mesh.visible ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  if (searchQuery && html === '') {
    html = `<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:12px;">По запросу «${searchQuery}» ничего не найдено</div>`;
  }

  treeContent.innerHTML = html;

  treeContent.querySelectorAll('[data-cat-eye]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cat = (btn as HTMLElement).dataset.catEye;
      if (!cat) return;
      const elems = categories.get(cat) || [];
      const anyVisible = elems.some((el) => el.mesh.visible);
      for (const el of elems) {
        setMeshVisibility(el.mesh, !anyVisible);
      }
      updateHiddenStatus();
      if (sectionBoxEnabled) fitSectionBoxToVisible();
    });
  });

  treeContent.querySelectorAll('.tree-cat-header').forEach((header) => {
    header.addEventListener('click', () => {
      const cat = (header as HTMLElement).dataset.category;
      const list = document.getElementById(`cat-list-${cat}`);
      list?.classList.toggle('hidden');
    });
  });

  treeContent.querySelectorAll('[data-item-eye]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt((btn as HTMLElement).dataset.itemEye || '-1');
      const elems = allModelElements.filter((el) => el.expressID === id);
      const anyVisible = elems.some((el) => el.mesh.visible);
      for (const el of elems) {
        setMeshVisibility(el.mesh, !anyVisible);
      }
      updateHiddenStatus();
      if (sectionBoxEnabled) fitSectionBoxToVisible();
    });
  });

  treeContent.querySelectorAll('.tree-item-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = parseInt((row as HTMLElement).dataset.elemId || '-1');
      if (id > 0) selectElementByID(id);
    });
  });

  treeContent.querySelectorAll('[data-frame-assembly]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-frame-eye]')) return;
      const frameElems = allModelElements.filter((el) => isFrameElement(el.name, el.typeName));
      if (frameElems.length > 0) {
        selectElementOrAssembly(frameElems[0]);
      }
    });
  });

  treeContent.querySelectorAll('[data-frame-eye]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const frameElems = allModelElements.filter((el) => isFrameElement(el.name, el.typeName));
      const anyVisible = frameElems.some((el) => el.mesh.visible);
      for (const el of frameElems) {
        setMeshVisibility(el.mesh, !anyVisible);
      }
      updateHiddenStatus();
      if (sectionBoxEnabled) fitSectionBoxToVisible();
      renderTreePanel();
    });
  });
}

function isPointInsideSectionBox(point: THREE.Vector3): boolean {
  if (!sectionBoxEnabled) return true;
  const eps = 0.01;
  return (
    point.x >= currentMin.x - eps && point.x <= currentMax.x + eps &&
    point.y >= currentMin.y - eps && point.y <= currentMax.y + eps &&
    point.z >= currentMin.z - eps && point.z <= currentMax.z + eps
  );
}

// ─── web-ifc init ──────────────────────────────────────────
async function initIfcAPI(): Promise<WebIFC.IfcAPI> {
  if (ifcAPI) return ifcAPI;

  const api = new WebIFC.IfcAPI();

  // Resolve base URL for WASM (works both locally and on GitHub Pages)
  const base = import.meta.env.BASE_URL || './';
  const wasmDir = base.endsWith('/') ? base : base + '/';

  api.SetWasmPath(wasmDir, true);

  try {
    await api.Init();
  } catch (err) {
    console.warn('Local WASM loading failed, trying unpkg CDN...', err);
    api.SetWasmPath('https://unpkg.com/web-ifc@0.0.78/', true);
    await api.Init();
  }

  ifcAPI = api;
  return api;
}

// ─── IFC Loading ───────────────────────────────────────────
async function loadIFC(buffer: ArrayBuffer, fileName: string) {
  showLoading(`Загрузка ${fileName}...`);

  try {
    const api = await initIfcAPI();

    // Clean up old model
    if (modelGroup) {
      scene.remove(modelGroup);
      modelGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      originalMaterials.clear();
      allModelElements.length = 0;
      hiddenMeshSet.clear();
      updateHiddenStatus();
    }

    if (currentModelID >= 0) {
      api.CloseModel(currentModelID);
    }

    // Open the IFC model
    const data = new Uint8Array(buffer);
    const modelID = api.OpenModel(data);
    currentModelID = modelID;

    modelGroup = new THREE.Group();

    // Get all mesh geometries from the IFC
    const flatMeshes = api.LoadAllGeometry(modelID);

    setLoadingText(`Обработка ${flatMeshes.size()} объектов...`);

    for (let i = 0; i < flatMeshes.size(); i++) {
      const flatMesh = flatMeshes.get(i);
      const expressID = flatMesh.expressID;

      // Extract IFC entity name and type
      let typeName = 'IfcElement';
      let elemName = `#${expressID}`;
      try {
        const line = api.GetLine(modelID, expressID);
        typeName = getIfcTypeName(line.type);
        elemName = line.Name?.value || `${typeName} #${expressID}`;
      } catch (e) {
        // Fallback
      }

      for (let j = 0; j < flatMesh.geometries.size(); j++) {
        const placedGeom = flatMesh.geometries.get(j);
        const geomData = api.GetGeometry(modelID, placedGeom.geometryExpressID);

        // Vertices
        const verts = api.GetVertexArray(
          geomData.GetVertexData(),
          geomData.GetVertexDataSize()
        );
        // Indices
        const indices = api.GetIndexArray(
          geomData.GetIndexData(),
          geomData.GetIndexDataSize()
        );

        const geometry = new THREE.BufferGeometry();

        // web-ifc vertices: [x,y,z, nx,ny,nz] per vertex
        const posFloats = new Float32Array(verts.length / 2);
        const normFloats = new Float32Array(verts.length / 2);
        for (let k = 0; k < verts.length; k += 6) {
          const idx = k / 6;
          posFloats[idx * 3] = verts[k];
          posFloats[idx * 3 + 1] = verts[k + 1];
          posFloats[idx * 3 + 2] = verts[k + 2];
          normFloats[idx * 3] = verts[k + 3];
          normFloats[idx * 3 + 1] = verts[k + 4];
          normFloats[idx * 3 + 2] = verts[k + 5];
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(posFloats, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normFloats, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        // Color from IFC
        const color = placedGeom.color;
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(color.x, color.y, color.z),
          transparent: color.w < 1.0,
          opacity: color.w,
          side: THREE.DoubleSide,
          roughness: 0.6,
          metalness: 0.1,
          clippingPlanes: sectionBoxEnabled ? clippingPlanes : [],
          clipShadows: true,
        });

        const mesh = new THREE.Mesh(geometry, material);

        // Apply transformation matrix
        const mat = new THREE.Matrix4();
        mat.fromArray(placedGeom.flatTransformation);
        mesh.applyMatrix4(mat);

        // Store IFC metadata for picking, tree, and hiding
        mesh.userData.expressID = expressID;
        mesh.userData.modelID = modelID;
        mesh.userData.typeName = typeName;
        mesh.userData.name = elemName;

        allModelElements.push({
          mesh,
          expressID,
          modelID,
          typeName,
          name: elemName,
        });

        originalMaterials.set(mesh, material);
        modelGroup.add(mesh);

        // Free geometry data
        geomData.delete();
      }
    }

    scene.add(modelGroup);
    updateHiddenStatus();
    fitCameraToModel();

    if (sectionBoxEnabled) {
      fitSectionBoxToVisible();
      applyClippingPlanes(true);
    } else {
      applyClippingPlanes(false);
    }

    const meshCount = modelGroup.children.length;
    setStatus(`✅ ${fileName} — ${meshCount} элементов`);

    hideLoading();
  } catch (err) {
    console.error('Error loading IFC:', err);
    setStatus(`❌ Ошибка: ${(err as Error).message}`);
    hideLoading();
  }
}

// ─── Camera Fit ────────────────────────────────────────────
function fitCameraToModel() {
  if (!modelGroup || modelGroup.children.length === 0) return;

  const box = getVisibleModelBounds();
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1.0);
  const distance = maxDim * 1.5;

  perspCamera.position.copy(center).add(new THREE.Vector3(distance * 0.7, distance * 0.7, distance * 0.7));
  perspCamera.lookAt(center);
  perspCamera.near = maxDim * 0.001;
  perspCamera.far = maxDim * 100;
  perspCamera.updateProjectionMatrix();

  const aspect = window.innerWidth / window.innerHeight;
  const halfSize = maxDim * 0.8;
  orthoCamera.left = -halfSize * aspect;
  orthoCamera.right = halfSize * aspect;
  orthoCamera.top = halfSize;
  orthoCamera.bottom = -halfSize;
  orthoCamera.near = maxDim * -100;
  orthoCamera.far = maxDim * 100;
  orthoCamera.position.copy(perspCamera.position);
  orthoCamera.lookAt(center);
  orthoCamera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

// ─── Element Picking (Raycasting) ──────────────────────────
function onMouseMove(event: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, activeCamera);

  if (!modelGroup) return;

  const rawIntersects = raycaster.intersectObjects(modelGroup.children, false);
  const intersects = rawIntersects.filter((hit) => isPointInsideSectionBox(hit.point));

  // Restore hover
  for (const m of hoveredMeshes) {
    if (!selectedMeshes.includes(m)) {
      const orig = originalMaterials.get(m);
      if (orig) m.material = orig as THREE.Material;
    }
  }
  hoveredMeshes = [];
  hoveredMesh = null;

  if (intersects.length > 0) {
    const hit = intersects[0].object as THREE.Mesh;
    const elem = allModelElements.find((e) => e.mesh === hit);
    const targets = elem ? getAssemblyElements(elem).map((e) => e.mesh) : [hit];

    for (const m of targets) {
      if (!selectedMeshes.includes(m)) {
        hoveredMeshes.push(m);
        m.material = highlightMaterial;
      }
    }
    hoveredMesh = hit;
    canvas.style.cursor = 'pointer';
  } else {
    canvas.style.cursor = 'default';
  }
}

function onMouseClick(event: MouseEvent) {
  // Ignore right clicks
  if (event.button !== 0) return;

  raycaster.setFromCamera(mouse, activeCamera);
  if (!modelGroup) return;

  const rawIntersects = raycaster.intersectObjects(modelGroup.children, false);
  const intersects = rawIntersects.filter((hit) => isPointInsideSectionBox(hit.point));

  if (intersects.length > 0) {
    const hit = intersects[0].object as THREE.Mesh;
    const elem = allModelElements.find((e) => e.mesh === hit);
    if (elem) {
      selectElementOrAssembly(elem);
    }
  } else {
    clearSelection();
    propsPanel.classList.add('hidden');
  }
}

// ─── 3D Section Box Pointer Interaction ────────────────────
let activeHandle: FaceHandle | null = null;
let hoveredHandle: FaceHandle | null = null;
const dragPlane = new THREE.Plane();
const dragPlaneIntersect = new THREE.Vector3();

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;

  if (sectionBoxEnabled && showBoxToggle.checked) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, activeCamera);

    const handleMeshes = faceHandles.map((h) => h.mesh);
    const hits = raycaster.intersectObjects(handleMeshes, false);

    if (hits.length > 0) {
      const hit = hits[0];
      const handle = faceHandles.find((h) => h.mesh === hit.object);
      if (handle) {
        activeHandle = handle;
        controls.enabled = false;

        const camDir = new THREE.Vector3();
        activeCamera.getWorldDirection(camDir);
        dragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), hit.point);
        event.stopPropagation();
        return;
      }
    }
  }

  onMouseClick(event);
}

function onPointerMove(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, activeCamera);

  if (activeHandle) {
    if (raycaster.ray.intersectPlane(dragPlane, dragPlaneIntersect)) {
      const axis = activeHandle.axis;
      const dir = activeHandle.direction;
      const val = dragPlaneIntersect[axis];

      if (dir === 1) {
        const clamped = Math.max(currentMin[axis] + 0.1, Math.min(modelBounds.max[axis], val));
        currentMax[axis] = clamped;
      } else {
        const clamped = Math.min(currentMax[axis] - 0.1, Math.max(modelBounds.min[axis], val));
        currentMin[axis] = clamped;
      }

      updateSectionBoxVisual();
      updateSectionUI();
    }
    canvas.style.cursor = 'grabbing';
    return;
  }

  // Hover over face handles
  if (sectionBoxEnabled && showBoxToggle.checked) {
    const handleMeshes = faceHandles.map((h) => h.mesh);
    const hits = raycaster.intersectObjects(handleMeshes, false);

    if (hoveredHandle) {
      (hoveredHandle.mesh.material as THREE.MeshBasicMaterial).color.set(0x00f0ff);
      (hoveredHandle.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35;
      hoveredHandle = null;
    }

    if (hits.length > 0) {
      const handle = faceHandles.find((h) => h.mesh === hits[0].object);
      if (handle) {
        hoveredHandle = handle;
        (handle.mesh.material as THREE.MeshBasicMaterial).color.set(0xe94560);
        (handle.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75;
        canvas.style.cursor = 'grab';
        return;
      }
    }
  }

  onMouseMove(event);
}

function onPointerUp() {
  if (activeHandle) {
    activeHandle = null;
    controls.enabled = true;
    canvas.style.cursor = 'default';
  }
}

// ─── Properties Display ───────────────────────────────────
interface PsetProperty {
  name: string;
  value: string;
}

interface PsetGroup {
  name: string;
  properties: PsetProperty[];
}

function getElementPropertySets(modelID: number, expressID: number): PsetGroup[] {
  if (!ifcAPI) return [];
  const psetGroups: PsetGroup[] = [];
  const visitedPsetIds = new Set<number>();

  const parsePset = (psetId: number) => {
    if (visitedPsetIds.has(psetId)) return;
    visitedPsetIds.add(psetId);
    try {
      const pset = ifcAPI!.GetLine(modelID, psetId);
      if (!pset) return;
      const psetName = pset.Name && pset.Name.value ? pset.Name.value : `Pset #${psetId}`;
      const properties: PsetProperty[] = [];

      if (pset.HasProperties && Array.isArray(pset.HasProperties)) {
        for (const propRef of pset.HasProperties) {
          if (!propRef || propRef.value === undefined) continue;
          const prop = ifcAPI!.GetLine(modelID, propRef.value);
          if (!prop) continue;
          const name = prop.Name && prop.Name.value ? prop.Name.value : 'Параметр';
          let val = '';
          if (prop.NominalValue !== undefined && prop.NominalValue !== null) {
            val = prop.NominalValue.value !== undefined ? String(prop.NominalValue.value) : String(prop.NominalValue);
          } else if (prop.Description && prop.Description.value) {
            val = String(prop.Description.value);
          }
          if (name && val !== '') {
            properties.push({ name, value: val });
          }
        }
      }

      if (pset.Quantities && Array.isArray(pset.Quantities)) {
        for (const qRef of pset.Quantities) {
          if (!qRef || qRef.value === undefined) continue;
          const q = ifcAPI!.GetLine(modelID, qRef.value);
          if (!q) continue;
          const name = q.Name && q.Name.value ? q.Name.value : 'Величина';
          let val = '';
          for (const k of ['LengthValue', 'AreaValue', 'VolumeValue', 'CountValue', 'WeightValue']) {
            if (q[k] !== undefined && q[k] !== null) {
              const num = q[k].value !== undefined ? q[k].value : q[k];
              val = typeof num === 'number' ? num.toFixed(2) : String(num);
              break;
            }
          }
          if (name && val !== '') {
            properties.push({ name, value: val });
          }
        }
      }

      if (properties.length > 0) {
        psetGroups.push({ name: psetName, properties });
      }
    } catch (e) {
      console.warn('Error reading Pset:', e);
    }
  };

  // 1. Прямые PSET экземпляра через IFCRELDEFINESBYPROPERTIES
  try {
    const relProps = ifcAPI.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES);
    for (let i = 0; i < relProps.size(); i++) {
      const rel = ifcAPI.GetLine(modelID, relProps.get(i));
      if (!rel || !rel.RelatedObjects) continue;
      for (const obj of rel.RelatedObjects) {
        if (obj && obj.value === expressID && rel.RelatingPropertyDefinition) {
          parsePset(rel.RelatingPropertyDefinition.value);
        }
      }
    }
  } catch (e) {}

  // 2. PSET типа через IFCRELDEFINESBYTYPE
  try {
    const relTypes = ifcAPI.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYTYPE);
    for (let i = 0; i < relTypes.size(); i++) {
      const rel = ifcAPI.GetLine(modelID, relTypes.get(i));
      if (!rel || !rel.RelatedObjects) continue;
      let matches = false;
      for (const obj of rel.RelatedObjects) {
        if (obj && obj.value === expressID) { matches = true; break; }
      }
      if (matches && rel.RelatingType) {
        const typeId = rel.RelatingType.value;
        const typeObj = ifcAPI.GetLine(modelID, typeId);
        // A. Через HasPropertySets у объекта типа
        if (typeObj && typeObj.HasPropertySets && Array.isArray(typeObj.HasPropertySets)) {
          for (const pRef of typeObj.HasPropertySets) {
            if (pRef && pRef.value !== undefined) parsePset(pRef.value);
          }
        }
        // B. Через IFCRELDEFINESBYPROPERTIES у объекта типа
        try {
          const relProps = ifcAPI.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES);
          for (let j = 0; j < relProps.size(); j++) {
            const r = ifcAPI.GetLine(modelID, relProps.get(j));
            if (!r || !r.RelatedObjects) continue;
            for (const obj of r.RelatedObjects) {
              if (obj && obj.value === typeId && r.RelatingPropertyDefinition) {
                parsePset(r.RelatingPropertyDefinition.value);
              }
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  return psetGroups;
}

function showAssemblyProperties(mainElem: ModelElement, assembly: ModelElement[]) {
  if (!ifcAPI) return;

  propsPanel.classList.remove('hidden');
  propsContent.innerHTML = '';

  const isFrame = isFrameElement(mainElem.name, mainElem.typeName);
  const title = isFrame ? '📦 Каркас блок-контейнера' : '📦 Сборка элементов';
  const subtitle = isFrame
    ? 'Несущий стальной каркас модуля 6000×2400×2600 мм (стойки, фитинги, швеллеры обвязки пола и потолка)'
    : mainElem.name;

  let html = `
    <div class="prop-group" style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:700; color:#38bdf8; font-size:14px;">${title}</span>
        <span style="background:#0284c7; color:#fff; border-radius:12px; padding:2px 8px; font-size:11px; font-weight:600;">${assembly.length} дет.</span>
      </div>
      <div style="font-size:11px; color:#bae6fd; margin-top:5px; line-height:1.4;">
        ${subtitle}
      </div>
    </div>
  `;

  // Add Psets from mainElem (or any element that has Psets)
  let psets = getElementPropertySets(mainElem.modelID, mainElem.expressID);
  if (psets.length === 0) {
    for (const item of assembly) {
      psets = getElementPropertySets(item.modelID, item.expressID);
      if (psets.length > 0) break;
    }
  }

  if (psets.length > 0) {
    for (const pset of psets) {
      const isArctic = pset.name.includes('Арктика');
      const titleStyle = isArctic
        ? 'color: #38bdf8; font-weight: 700; border-bottom: 1px solid rgba(56,189,248,0.3); padding-bottom: 3px; margin-bottom: 6px;'
        : 'color: var(--accent); font-weight: 600; margin-bottom: 4px;';
      const icon = isArctic ? '❄️ ' : '📁 ';
      const cardStyle = isArctic
        ? 'background: rgba(56,189,248,0.08); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(56,189,248,0.25); margin-bottom: 10px;'
        : 'margin-bottom: 12px;';

      html += `<div class="prop-group" style="${cardStyle}">
        <div class="prop-group-title" style="${titleStyle}">${icon}${pset.name}</div>`;
      for (const prop of pset.properties) {
        html += `<div class="prop-row">
          <span class="prop-key" style="color: ${isArctic ? '#bae6fd' : 'var(--text-muted)'};">${prop.name}</span>
          <span class="prop-value" style="${isArctic ? 'color: #f8fafc; font-weight: 600;' : ''}">${prop.value}</span>
        </div>`;
      }
      html += '</div>';
    }
  }

  // Breakdown of assembly parts
  const partCounts = new Map<string, number>();
  for (const item of assembly) {
    const clean = item.name.replace(/^[^:]+:\s*/, '');
    partCounts.set(clean, (partCounts.get(clean) || 0) + 1);
  }

  html += `
    <div class="prop-group" style="margin-top: 10px;">
      <div class="prop-group-title" style="color: var(--accent); font-weight: 600; margin-bottom: 6px;">
        🔩 Состав сборки (${assembly.length} шт.):
      </div>
  `;

  for (const [partName, count] of partCounts) {
    html += `
      <div class="prop-row" style="font-size:11px; padding:3px 0;">
        <span class="prop-key" style="color:var(--text);">${partName}</span>
        <span class="prop-value" style="font-weight:600; color:#38bdf8;">${count} шт.</span>
      </div>
    `;
  }
  html += '</div>';

  propsContent.innerHTML = html;
}

function showProperties(expressID: number, modelID: number) {
  if (!ifcAPI) return;

  propsPanel.classList.remove('hidden');
  propsContent.innerHTML = '';

  try {
    const props = ifcAPI.GetLine(modelID, expressID);

    // Basic info
    let html = `<div class="prop-group">
      <div class="prop-group-title">Основная информация</div>
      <div class="prop-row"><span class="prop-key">Express ID</span><span class="prop-value">${expressID}</span></div>`;

    if (props.type !== undefined) {
      const typeName = getIfcTypeName(props.type);
      html += `<div class="prop-row"><span class="prop-key">Тип IFC</span><span class="prop-value">${typeName}</span></div>`;
    }

    if (props.Name && props.Name.value) {
      html += `<div class="prop-row"><span class="prop-key">Имя</span><span class="prop-value">${props.Name.value}</span></div>`;
    }

    if (props.Description && props.Description.value) {
      html += `<div class="prop-row"><span class="prop-key">Описание</span><span class="prop-value">${props.Description.value}</span></div>`;
    }

    if (props.GlobalId && props.GlobalId.value) {
      html += `<div class="prop-row"><span class="prop-key">Global ID</span><span class="prop-value" style="font-size:10px">${props.GlobalId.value}</span></div>`;
    }

    html += '</div>';

    // PSETS (Custom Arctic Psets and Common Psets)
    const psets = getElementPropertySets(modelID, expressID);
    if (psets.length > 0) {
      for (const pset of psets) {
        const isArctic = pset.name.includes('Арктика');
        const titleStyle = isArctic
          ? 'color: #38bdf8; font-weight: 700; border-bottom: 1px solid rgba(56,189,248,0.3); padding-bottom: 3px; margin-bottom: 6px;'
          : 'color: var(--accent); font-weight: 600; margin-bottom: 4px;';
        const icon = isArctic ? '❄️ ' : '📁 ';
        const cardStyle = isArctic
          ? 'background: rgba(56,189,248,0.08); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(56,189,248,0.25); margin-bottom: 10px;'
          : 'margin-bottom: 12px;';

        html += `<div class="prop-group" style="${cardStyle}">
          <div class="prop-group-title" style="${titleStyle}">${icon}${pset.name}</div>`;
        for (const prop of pset.properties) {
          html += `<div class="prop-row">
            <span class="prop-key" style="color: ${isArctic ? '#bae6fd' : 'var(--text-muted)'};">${prop.name}</span>
            <span class="prop-value" style="${isArctic ? 'color: #f8fafc; font-weight: 600;' : ''}">${prop.value}</span>
          </div>`;
        }
        html += '</div>';
      }
    }

    // Show all other raw properties (excluding pointers)
    const skip = new Set(['type', 'expressID', 'Name', 'Description', 'GlobalId', 'Representation', 'ObjectPlacement', 'OwnerHistory', 'Tag']);
    const otherProps = Object.entries(props).filter(([key]) => !skip.has(key));

    if (otherProps.length > 0) {
      html += '<div class="prop-group"><div class="prop-group-title">Дополнительные свойства</div>';
      for (const [key, val] of otherProps) {
        const displayVal = formatPropValue(val);
        if (displayVal !== null) {
          html += `<div class="prop-row"><span class="prop-key">${key}</span><span class="prop-value">${displayVal}</span></div>`;
        }
      }
      html += '</div>';
    }

    propsContent.innerHTML = html;
  } catch (err) {
    propsContent.innerHTML = `<div class="prop-group">
      <div class="prop-group-title">Элемент</div>
      <div class="prop-row"><span class="prop-key">Express ID</span><span class="prop-value">${expressID}</span></div>
    </div>`;
  }
}

function formatPropValue(val: any): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') {
    if (val.value !== undefined && val.value !== null) {
      return String(val.value);
    }
    if (val.expressID !== undefined) {
      return `→ #${val.expressID}`;
    }
    if (Array.isArray(val)) {
      return val.length > 0 ? `[${val.length} элем.]` : '[]';
    }
    return null;
  }
  return String(val);
}

function getIfcTypeName(typeCode: number): string {
  try {
    if (ifcAPI) {
      const resolved = ifcAPI.GetNameFromTypeCode(typeCode);
      if (resolved) return resolved;
    }
  } catch (e) {
    // Fallback to static table
  }

  // Common IFC types
  const typeNames: Record<number, string> = {
    [WebIFC.IFCWALL]: 'IfcWall',
    [WebIFC.IFCWALLSTANDARDCASE]: 'IfcWallStandardCase',
    [WebIFC.IFCSLAB]: 'IfcSlab',
    [WebIFC.IFCCOLUMN]: 'IfcColumn',
    [WebIFC.IFCBEAM]: 'IfcBeam',
    [WebIFC.IFCDOOR]: 'IfcDoor',
    [WebIFC.IFCWINDOW]: 'IfcWindow',
    [WebIFC.IFCROOF]: 'IfcRoof',
    [WebIFC.IFCSTAIR]: 'IfcStair',
    [WebIFC.IFCSTAIRFLIGHT]: 'IfcStairFlight',
    [WebIFC.IFCRAILING]: 'IfcRailing',
    [WebIFC.IFCPLATE]: 'IfcPlate',
    [WebIFC.IFCMEMBER]: 'IfcMember',
    [WebIFC.IFCFURNISHINGELEMENT]: 'IfcFurnishingElement',
    [WebIFC.IFCSPACE]: 'IfcSpace',
    [WebIFC.IFCOPENINGELEMENT]: 'IfcOpeningElement',
    [WebIFC.IFCFLOWSEGMENT]: 'IfcFlowSegment',
    [WebIFC.IFCFLOWTERMINAL]: 'IfcFlowTerminal',
    [WebIFC.IFCBUILDINGELEMENTPROXY]: 'IfcBuildingElementProxy',
    [WebIFC.IFCCOVERING]: 'IfcCovering',
    [WebIFC.IFCCURTAINWALL]: 'IfcCurtainWall',
    [WebIFC.IFCFOOTING]: 'IfcFooting',
    [WebIFC.IFCPILE]: 'IfcPile',
  };
  return typeNames[typeCode] || `IFC Type (${typeCode})`;
}

// ─── Wireframe Toggle ──────────────────────────────────────
function toggleWireframe() {
  wireframeMode = !wireframeMode;
  wireframeBtn.classList.toggle('active', wireframeMode);

  if (!modelGroup) return;

  modelGroup.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.MeshStandardMaterial;
      if (mat.wireframe !== undefined) {
        mat.wireframe = wireframeMode;
      }
    }
  });

  // Also update special materials
  highlightMaterial.wireframe = wireframeMode;
  selectedMaterial.wireframe = wireframeMode;
}

// ─── Projection Toggle ────────────────────────────────────
function toggleProjection() {
  isOrtho = !isOrtho;
  orthoBtn.classList.toggle('active', isOrtho);

  if (isOrtho) {
    // Copy position from perspective to ortho
    orthoCamera.position.copy(perspCamera.position);
    orthoCamera.rotation.copy(perspCamera.rotation);
    orthoCamera.zoom = 1;
    orthoCamera.updateProjectionMatrix();
    activeCamera = orthoCamera;
  } else {
    perspCamera.position.copy(orthoCamera.position);
    perspCamera.rotation.copy(orthoCamera.rotation);
    perspCamera.updateProjectionMatrix();
    activeCamera = perspCamera;
  }

  controls.object = activeCamera;
  controls.update();
}

// ─── Drag & Drop ───────────────────────────────────────────
let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.remove('hidden');
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dropOverlay.classList.add('hidden');
    dragCounter = 0;
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.add('hidden');

  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const file = files[0];
  if (!file.name.toLowerCase().endsWith('.ifc')) {
    setStatus('⚠️ Пожалуйста, выберите файл в формате .ifc');
    return;
  }

  const buffer = await file.arrayBuffer();
  await loadIFC(buffer, file.name);
});

// ─── File Input ────────────────────────────────────────────
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  const buffer = await file.arrayBuffer();
  await loadIFC(buffer, file.name);
  fileInput.value = '';
});

// ─── Button Events ─────────────────────────────────────────
fitBtn.addEventListener('click', fitCameraToModel);
sectionBtn.addEventListener('click', toggleSectionBox);
treeBtn.addEventListener('click', () => {
  treePanel.classList.toggle('hidden');
  renderTreePanel();
});
treeClose.addEventListener('click', () => treePanel.classList.add('hidden'));
treeSearchInput?.addEventListener('input', () => {
  renderTreePanel();
});
unhideAllBtn.addEventListener('click', showAllElements);
treeShowAllBtn.addEventListener('click', showAllElements);
hideHelpersBtn.addEventListener('click', hideAuxiliarySurfaces);

wireframeBtn.addEventListener('click', toggleWireframe);
orthoBtn.addEventListener('click', toggleProjection);

assemblyBtn?.addEventListener('click', () => {
  assemblyModeEnabled = !assemblyModeEnabled;
  if (assemblyModeEnabled) {
    assemblyBtn.classList.add('active');
    assemblyBtn.innerHTML = '📦 Сборка: Вкл';
    assemblyBtn.title = 'Режим выбора: сборка целиком (каркас). Кликните для перехода к отдельным деталям.';
    setStatus('📦 Включен режим выбора сборок (каркас выбирается целиком)');
  } else {
    assemblyBtn.classList.remove('active');
    assemblyBtn.innerHTML = '🔹 Элемент: Вкл';
    assemblyBtn.title = 'Режим выбора: отдельные детали. Кликните для выбора сборок целиком.';
    setStatus('🔹 Включен режим выбора отдельных элементов');
  }
  if (selectedMeshes.length > 0) {
    const first = selectedMeshes[0];
    const elem = allModelElements.find((e) => e.mesh === first);
    if (elem) selectElementOrAssembly(elem);
  }
});

propsClose.addEventListener('click', () => propsPanel.classList.add('hidden'));

hideElemBtn.addEventListener('click', () => {
  if (selectedMesh) hideElementByMesh(selectedMesh);
});
isolateElemBtn.addEventListener('click', () => {
  if (selectedMesh) isolateElementByMesh(selectedMesh);
});

// ─── Section Box Events ───────────────────────────────────
sectionClose.addEventListener('click', () => toggleSectionBox());
sectionReset.addEventListener('click', resetSectionBox);
sectionFitVisible.addEventListener('click', fitSectionBoxToVisible);
showBoxToggle.addEventListener('change', () => {
  sectionBoxGroup.visible = showBoxToggle.checked && sectionBoxEnabled;
});
[clipXMin, clipXMax, clipYMin, clipYMax, clipZMin, clipZMax].forEach((input) => {
  input.addEventListener('input', onSliderInput);
});

// ─── Sample Model Loading ─────────────────────────────────
async function loadSampleModel() {
  showLoading('Загрузка тестовой модели...');
  try {
    const base = import.meta.env.BASE_URL || './';
    const sampleUrl = `${base.endsWith('/') ? base : base + '/'}sample.ifc`;
    const response = await fetch(sampleUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    await loadIFC(buffer, 'Модуль_Арктика.ifc');
  } catch (err) {
    console.error('Failed to load sample IFC:', err);
    setStatus(`❌ Ошибка загрузки примера: ${(err as Error).message}`);
    hideLoading();
  }
}

sampleBtn?.addEventListener('click', loadSampleModel);

// ─── Pointer & Mouse Events ────────────────────────────────
canvas.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);

// ─── Resize ────────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;

  perspCamera.aspect = w / h;
  perspCamera.updateProjectionMatrix();

  const aspect = w / h;
  const halfHeight = (orthoCamera.top - orthoCamera.bottom) / 2;
  orthoCamera.left = -halfHeight * aspect;
  orthoCamera.right = halfHeight * aspect;
  orthoCamera.updateProjectionMatrix();

  renderer.setSize(w, h);
});

// ─── Helpers ───────────────────────────────────────────────
function setStatus(text: string) {
  statusEl.textContent = text;
}

function showLoading(text: string) {
  loadingText.textContent = text;
  loadingOverlay.classList.remove('hidden');
}

function setLoadingText(text: string) {
  loadingText.textContent = text;
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

// ─── Animation Loop ────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, activeCamera);
}

animate();
