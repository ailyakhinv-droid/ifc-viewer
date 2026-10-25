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
const wireframeBtn = document.getElementById('wireframe-btn') as HTMLButtonElement;
const orthoBtn = document.getElementById('ortho-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const dropOverlay = document.getElementById('drop-overlay') as HTMLDivElement;
const propsPanel = document.getElementById('props-panel') as HTMLDivElement;
const propsClose = document.getElementById('props-close') as HTMLButtonElement;
const propsContent = document.getElementById('props-content') as HTMLDivElement;
const loadingOverlay = document.getElementById('loading') as HTMLDivElement;
const loadingText = document.getElementById('loading-text') as HTMLDivElement;

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
let selectedMesh: THREE.Mesh | null = null;
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
        });

        const mesh = new THREE.Mesh(geometry, material);

        // Apply transformation matrix
        const mat = new THREE.Matrix4();
        mat.fromArray(placedGeom.flatTransformation);
        mesh.applyMatrix4(mat);

        // Store expressID for picking
        mesh.userData.expressID = expressID;
        mesh.userData.modelID = modelID;

        originalMaterials.set(mesh, material);
        modelGroup.add(mesh);

        // Free geometry data
        geomData.delete();
      }
    }

    scene.add(modelGroup);
    fitCameraToModel();

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

  const box = new THREE.Box3().setFromObject(modelGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
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

  const intersects = raycaster.intersectObjects(modelGroup.children, false);

  // Restore hover
  if (hoveredMesh && hoveredMesh !== selectedMesh) {
    const orig = originalMaterials.get(hoveredMesh);
    if (orig) hoveredMesh.material = orig as THREE.Material;
  }
  hoveredMesh = null;

  if (intersects.length > 0) {
    const hit = intersects[0].object as THREE.Mesh;
    if (hit !== selectedMesh) {
      hoveredMesh = hit;
      hit.material = highlightMaterial;
    }
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

  const intersects = raycaster.intersectObjects(modelGroup.children, false);

  // Deselect previous
  if (selectedMesh) {
    const orig = originalMaterials.get(selectedMesh);
    if (orig) selectedMesh.material = orig as THREE.Material;
    selectedMesh = null;
  }

  if (intersects.length > 0) {
    const hit = intersects[0].object as THREE.Mesh;
    selectedMesh = hit;
    hit.material = selectedMaterial;
    showProperties(hit.userData.expressID, hit.userData.modelID);
  } else {
    propsPanel.classList.add('hidden');
  }
}

// ─── Properties Display ───────────────────────────────────
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

    // Show all other properties
    const skip = new Set(['type', 'expressID', 'Name', 'Description', 'GlobalId']);
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
wireframeBtn.addEventListener('click', toggleWireframe);
orthoBtn.addEventListener('click', toggleProjection);
propsClose.addEventListener('click', () => propsPanel.classList.add('hidden'));

// ─── Sample Model Loading ─────────────────────────────────
async function loadSampleModel() {
  showLoading('Загрузка тестовой модели...');
  try {
    const base = import.meta.env.BASE_URL || './';
    const sampleUrl = `${base.endsWith('/') ? base : base + '/'}sample.ifc`;
    const response = await fetch(sampleUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    await loadIFC(buffer, 'Building-Architecture.ifc');
  } catch (err) {
    console.error('Failed to load sample IFC:', err);
    setStatus(`❌ Ошибка загрузки примера: ${(err as Error).message}`);
    hideLoading();
  }
}

sampleBtn?.addEventListener('click', loadSampleModel);

// ─── Mouse Events ──────────────────────────────────────────
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('click', onMouseClick);

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
