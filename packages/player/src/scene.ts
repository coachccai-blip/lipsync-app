import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { SceneConfig } from "@avatar/shared";

export interface WebGLInfo {
  renderer: string;
  vendor: string;
  software: boolean;
}

/** Vérifie qu'un contexte WebGL existe et identifie le rendu logiciel (SwiftShader, llvmpipe). */
export function probeWebGL(): WebGLInfo {
  const canvas = document.createElement("canvas");
  const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
  if (!gl) throw new Error("Impossible de créer un contexte WebGL : vérifiez les options de lancement de Chrome (--use-gl=angle --use-angle=swiftshader) ou les pilotes graphiques.");
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  const vendor = ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR));
  const software = /swiftshader|llvmpipe|software|mesa offscreen/i.test(renderer + " " + vendor);
  return { renderer, vendor, software };
}

/**
 * Scène : renderer, caméra, éclairage trois points + lumière d'accroche, bulle CSS.
 * Aucune horloge : tout est piloté par renderFrame(t).
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly page: HTMLElement;
  readonly bubble: HTMLElement;
  readonly ring: HTMLElement;
  readonly diameter: number;
  private keyLight!: THREE.DirectionalLight;
  private lights: THREE.Object3D[] = [];
  private pmrem?: THREE.PMREMGenerator;

  constructor(readonly cfg: SceneConfig, background: "green" | "transparent") {
    this.page = document.getElementById("page")!;
    this.bubble = document.getElementById("bubble")!;
    this.ring = document.getElementById("ring")!;
    const { width, height } = cfg.resolution;
    document.documentElement.style.setProperty("--page-w", `${width}px`);
    document.documentElement.style.setProperty("--page-h", `${height}px`);
    document.documentElement.style.setProperty("--page-bg", cfg.background.color);
    document.body.classList.toggle("transparent", background === "transparent");

    this.diameter = cfg.bubble.diameter === "auto" ? Math.min(width, height) - 2 * cfg.bubble.margin : cfg.bubble.diameter;
    const d = this.diameter;
    Object.assign(this.bubble.style, {
      width: `${d}px`,
      height: `${d}px`,
      left: `${Math.round((width - d) / 2)}px`,
      top: `${Math.round((height - d) / 2)}px`,
      background: cfg.bubble.background,
    });
    this.ring.style.boxShadow = cfg.bubble.ring.enabled ? `inset 0 0 0 ${cfg.bubble.ring.width}px ${cfg.bubble.ring.color}` : "none";

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(d, d, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = cfg.lighting.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.bubble.insertBefore(this.renderer.domElement, this.ring);

    this.camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, 0.05, 100);
    this.setupLights();
  }

  private setupLights(): void {
    for (const l of this.lights) this.scene.remove(l);
    this.lights = [];
    const L = this.cfg.lighting;
    const add = (o: THREE.Object3D) => {
      if (o instanceof THREE.Light) o.userData.basePosition = o.position.clone();
      this.scene.add(o);
      this.lights.push(o);
    };
    add(new THREE.AmbientLight(new THREE.Color(L.ambient.color), L.ambient.intensity));

    const key = new THREE.DirectionalLight(new THREE.Color(L.key.color), L.key.intensity);
    key.position.set(...L.key.position);
    key.castShadow = L.key.shadows;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    add(key);
    add(key.target);
    this.keyLight = key;

    const fill = new THREE.DirectionalLight(new THREE.Color(L.fill.color), L.fill.intensity);
    fill.position.set(...L.fill.position);
    add(fill);
    add(fill.target);

    const rim = new THREE.DirectionalLight(new THREE.Color(L.rim.color), L.rim.intensity);
    rim.position.set(...L.rim.position);
    add(rim);
    add(rim.target);

    const eye = new THREE.PointLight(new THREE.Color(L.eyeCatch.color), L.eyeCatch.intensity, 6, 2);
    eye.position.set(...L.eyeCatch.position);
    add(eye);

    if (L.environment.enabled) {
      this.pmrem ??= new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = L.environment.intensity;
    } else {
      this.scene.environment = null;
    }
  }

  /**
   * Cadre le buste : du bas défini par bottomRatio jusqu'au-dessus de la tête avec marge.
   * Les lumières visent le centre du cadre et l'ombre de la lumière principale couvre le modèle.
   */
  frame(box: THREE.Box3): void {
    const c = this.cfg.camera;
    const size = new THREE.Vector3();
    box.getSize(size);
    const H = size.y || 1;
    const bottom = box.min.y + c.bottomRatio * H;
    const top = box.max.y + c.marginTop * H;
    const centerY = (bottom + top) / 2 + c.heightOffset * H;
    const centerX = (box.min.x + box.max.x) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;
    const target = new THREE.Vector3(centerX, centerY, centerZ);
    if (c.autoFrame) {
      const frameH = top - bottom;
      const dist = (frameH / 2 / Math.tan(THREE.MathUtils.degToRad(c.fov) / 2)) * c.distanceScale + size.z / 2;
      this.camera.position.set(centerX, centerY, centerZ + dist);
      this.camera.lookAt(target);
    } else {
      this.camera.position.set(...c.position);
      this.camera.lookAt(new THREE.Vector3(...c.target));
    }
    this.camera.fov = c.fov;
    this.camera.near = 0.05;
    this.camera.far = 100;
    this.camera.updateProjectionMatrix();

    // les positions des lumières (config) sont relatives au centre du cadre
    for (const l of this.lights) {
      if (!(l instanceof THREE.Light) || l instanceof THREE.AmbientLight) continue;
      const base = l.userData.basePosition as THREE.Vector3;
      l.position.copy(target).add(base);
      if (l instanceof THREE.DirectionalLight) {
        l.target.position.copy(target);
        l.target.updateMatrixWorld();
      }
    }
    const shadowCam = this.keyLight.shadow.camera;
    const r = Math.max(size.x, size.y, size.z) * 0.75;
    shadowCam.left = -r;
    shadowCam.right = r;
    shadowCam.top = r;
    shadowCam.bottom = -r;
    shadowCam.near = 0.1;
    shadowCam.far = 20;
    shadowCam.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    // s'assurer que toutes les commandes GL sont exécutées avant la capture
    this.renderer.getContext().finish();
  }

  dispose(): void {
    this.renderer.dispose();
    this.pmrem?.dispose();
  }
}
