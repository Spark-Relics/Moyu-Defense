import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const characterSources = {
  sunflower: { url: new URL('../assets/models-v2/sunflower-animated.glb', import.meta.url).href, height: 2.15 },
  peashooter: { url: new URL('../assets/models-v2/peashooter-animated.glb', import.meta.url).href, height: 2.15 },
  wallnut: { url: new URL('../assets/models-v2/wallnut.glb', import.meta.url).href, height: 2.7 },
  auditor: { url: new URL('../assets/models-v2/auditor.glb', import.meta.url).href, height: 3.2 },
  client: { url: new URL('../assets/models-v2/client-animated.glb', import.meta.url).href, height: 2.18 },
  kpi: { url: new URL('../assets/models-v2/kpi-animated.glb', import.meta.url).href, height: 1.82 },
  boss: { url: new URL('../assets/models-v2/boss.glb', import.meta.url).href, height: 2.02 },
  traitor: { url: new URL('../assets/models-v2/traitor.glb', import.meta.url).href, height: 2.22 },
};
const sourcePromises = new Map();

function loadCharacterSource(type) {
  if (!sourcePromises.has(type)) {
    sourcePromises.set(type, loader.loadAsync(characterSources[type].url).catch(error => {
      sourcePromises.delete(type); // Allow later placements to retry a transient network failure.
      throw error;
    }));
  }
  return sourcePromises.get(type);
}

export function preloadCharacterModels(types = ['sunflower', 'peashooter', 'client']) {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('balance')) return;
  for (const type of new Set(types)) {
    if (!characterSources[type]) continue;
    loadCharacterSource(type).catch((error) => {
      console.warn(`[CharacterModelLoader] ${type} preload failed.`, error);
    });
  }
}

function cloneMaterial(source) {
  const material = source.clone();
  // Runtime instances own their textures, so destroying one character cannot
  // invalidate another clone that came from the same cached GLB.
  for (const key of Object.keys(material)) {
    if (material[key]?.isTexture) material[key] = material[key].clone();
  }
  return material;
}

function cloneRuntimeScene(source) {
  const scene = cloneSkeleton(source);
  const materials = [];
  scene.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry = node.geometry.clone();
    node.material = Array.isArray(node.material)
      ? node.material.map(cloneMaterial)
      : cloneMaterial(node.material);
    materials.push(...(Array.isArray(node.material) ? node.material : [node.material]));
    node.castShadow = true;
    node.receiveShadow = true;
  });
  return { scene, materials };
}

function getBindPoseBounds(asset) {
  // 整个角色(含全部子 mesh 与变换链)的世界包围盒。
  // 不能只取第一个 mesh 的局部 geometry bbox：多部件模型(如审计员)
  // 的首 mesh 可能是小物件/带变换，会导致缩放错误与悬空。
  asset.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(asset, true);
}

async function attachCharacterModel(entity, type, fallbackParts, parent) {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('balance')) return null;
  try {
    const gltf = await loadCharacterSource(type);
    if (entity.dead || !entity.mesh.parent) return null;

    const runtime = cloneRuntimeScene(gltf.scene);
    const asset = runtime.scene;
    // Tripo outputs face +X. Convert to the project's +Z local-forward axis;
    // plant/zombie containers then turn +Z toward the incoming lane direction.
    asset.rotation.y = -Math.PI / 2;

    let mixer = null;
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(asset);
      mixer.clipAction(gltf.animations[0]).play();
      mixer.setTime(Math.random() * Math.min(gltf.animations[0].duration, 2));
    }

    const bounds = getBindPoseBounds(asset);
    const size = bounds.getSize(new THREE.Vector3());
    // bounds 已是 asset 旋转后的世界系包围盒，center 无需再手动旋转
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = characterSources[type].height / Math.max(size.y, 0.001);
    asset.scale.setScalar(scale);
    asset.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);

    const visual = new THREE.Group();
    visual.name = `${type}-tripo-visual`;
    visual.add(asset);
    parent.add(visual);

    entity.characterVisual = visual;
    entity.modelMixer = mixer;
    if (entity.mainMaterials) entity.mainMaterials.push(...runtime.materials.filter((material) => material.emissive));
    for (const part of fallbackParts) part.visible = false;
    return visual;
  } catch (error) {
    console.warn(`[CharacterModelLoader] ${type} GLB failed; keeping fallback.`, error);
    return null;
  }
}

export async function attachPlantModel(entity, type, fallbackParts) {
  return attachCharacterModel(entity, type, fallbackParts, entity.mesh);
}

export async function attachZombieModel(entity, fallbackParts) {
  return attachCharacterModel(entity, entity.type, fallbackParts, entity.model);
}

export async function attachSunflowerModel(entity, fallbackParts) {
  const visual = await attachPlantModel(entity, 'sunflower', fallbackParts);
  if (!visual) return;
  entity.headGroup = visual;
  entity.head = visual;
  entity.sweatDrops = null;
}
