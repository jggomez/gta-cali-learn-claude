import * as THREE from 'three';

const DEFAULT_MAX_PARTICLES = 220;
const COLLISION_SPARK_THRESHOLD = 0.12;

interface ParticleDraft {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  g: number;
  b: number;
  startSize: number;
  endSize: number;
  baseAlpha: number;
  lifetime: number;
  drag: number;
  gravity: number;
  softness: number;
  isSmoke: 0 | 1;
}

const PARTICLE_VERTEX_SHADER = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aSoftness;

varying vec3 vColor;
varying float vAlpha;
varying float vSoftness;

void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vSoftness = aSoftness;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  if (aAlpha <= 0.001 || aSize <= 0.001) {
    gl_PointSize = 0.0;
    return;
  }

  float depth = max(-mvPosition.z, 1.0);
  gl_PointSize = clamp(aSize * (300.0 / depth), 1.0, 96.0);
}
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSoftness;

void main() {
  if (vAlpha <= 0.001) {
    discard;
  }

  vec2 centered = gl_PointCoord - vec2(0.5);
  float dist = length(centered) * 2.0;
  if (dist > 1.0) {
    discard;
  }

  float smokeFalloff = pow(1.0 - dist, 1.75);
  float energyCore = exp(-dist * dist * 4.2);
  float mask = mix(energyCore, smokeFalloff, clamp(vSoftness, 0.0, 1.0));

  vec3 hotCore = mix(vec3(1.0), vColor, clamp(dist * 1.15 + vSoftness * 0.7, 0.0, 1.0));
  gl_FragColor = vec4(hotCore, mask * vAlpha);
}
`;

export class ParticleSystem {
  readonly group: THREE.Group;

  private readonly maxParticles: number;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;

  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly softness: Float32Array;

  private readonly posAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly softAttr: THREE.BufferAttribute;

  private readonly active: Uint8Array;
  private readonly age: Float32Array;
  private readonly lifetime: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly startSize: Float32Array;
  private readonly endSize: Float32Array;
  private readonly baseAlpha: Float32Array;
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;
  private readonly isSmoke: Uint8Array;

  /** Pre-allocated scratch record reused on every emit to avoid per-frame allocations. */
  private readonly draft: ParticleDraft = {
    px: 0,
    py: 0,
    pz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    r: 1,
    g: 1,
    b: 1,
    startSize: 0.5,
    endSize: 1.0,
    baseAlpha: 0.8,
    lifetime: 0.5,
    drag: 1.0,
    gravity: 0,
    softness: 0,
    isSmoke: 0,
  };

  private activeCount = 0;
  private cursor = 0;
  private dirtyBuffers = false;
  private disposed = false;
  private rngState = 0x51a7c9e3;

  constructor(maxParticles = DEFAULT_MAX_PARTICLES) {
    this.maxParticles = Math.max(1, Math.floor(maxParticles));
    this.group = new THREE.Group();
    this.group.name = 'cali_particle_system';

    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);
    this.alphas = new Float32Array(this.maxParticles);
    this.softness = new Float32Array(this.maxParticles);

    this.active = new Uint8Array(this.maxParticles);
    this.age = new Float32Array(this.maxParticles);
    this.lifetime = new Float32Array(this.maxParticles);
    this.vx = new Float32Array(this.maxParticles);
    this.vy = new Float32Array(this.maxParticles);
    this.vz = new Float32Array(this.maxParticles);
    this.startSize = new Float32Array(this.maxParticles);
    this.endSize = new Float32Array(this.maxParticles);
    this.baseAlpha = new Float32Array(this.maxParticles);
    this.drag = new Float32Array(this.maxParticles);
    this.gravity = new Float32Array(this.maxParticles);
    this.isSmoke = new Uint8Array(this.maxParticles);

    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1);
    this.softAttr = new THREE.BufferAttribute(this.softness, 1);

    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.softAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aColor', this.colorAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aSoftness', this.softAttr);

    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  emitDriftSmoke(
    x: number,
    y: number,
    z: number,
    heading: number,
    count = 4,
  ): void {
    if (this.disposed || count <= 0) {
      return;
    }

    const emitCount = Math.min(24, Math.floor(count));
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);
    const d = this.draft;

    for (let i = 0; i < emitCount; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const lateralSpeed = 1.1 + this.nextRand() * 1.4;
      const rearSpeed = 0.7 + this.nextRand() * 1.2;
      const tint = this.nextRand() * 0.12;

      d.px = x - forwardX * 1.55 + rightX * side * 0.85 + (this.nextRand() - 0.5) * 0.32;
      d.py = y + 0.14 + this.nextRand() * 0.12;
      d.pz = z - forwardZ * 1.55 + rightZ * side * 0.85 + (this.nextRand() - 0.5) * 0.32;
      d.vx = rightX * side * lateralSpeed - forwardX * rearSpeed + (this.nextRand() - 0.5) * 0.6;
      d.vy = 0.85 + this.nextRand() * 0.95;
      d.vz = rightZ * side * lateralSpeed - forwardZ * rearSpeed + (this.nextRand() - 0.5) * 0.6;
      d.r = 0.78 + tint;
      d.g = 0.74 + tint * 0.8;
      d.b = 0.84 + tint;
      d.startSize = 0.55 + this.nextRand() * 0.35;
      d.endSize = 2.3 + this.nextRand() * 1.15;
      d.baseAlpha = 0.52 + this.nextRand() * 0.18;
      d.lifetime = 0.55 + this.nextRand() * 0.4;
      d.drag = 1.85;
      d.gravity = 0.45;
      d.softness = 1.0;
      d.isSmoke = 1;

      this.commitDraft();
    }

    this.markBuffersDirty();
  }

  emitCollisionSparks(
    x: number,
    y: number,
    z: number,
    intensity: number,
  ): void {
    if (this.disposed || intensity <= COLLISION_SPARK_THRESHOLD) {
      return;
    }

    const power = Math.min(1.6, intensity);
    const emitCount = Math.max(6, Math.min(28, Math.round(power * 24)));
    const d = this.draft;

    for (let i = 0; i < emitCount; i += 1) {
      const azimuth = this.nextRand() * Math.PI * 2;
      const horizSpeed = (3.8 + this.nextRand() * 7.8) * (0.65 + power * 0.5);
      const hot = this.nextRand();

      d.px = x + (this.nextRand() - 0.5) * 0.4;
      d.py = y + 0.35 + this.nextRand() * 0.35;
      d.pz = z + (this.nextRand() - 0.5) * 0.4;
      d.vx = Math.cos(azimuth) * horizSpeed;
      d.vy = (2.6 + this.nextRand() * 5.8) * (0.7 + power * 0.4);
      d.vz = Math.sin(azimuth) * horizSpeed;
      d.r = 1.0;
      d.g = 0.7 + hot * 0.28;
      d.b = 0.22 + hot * 0.68;
      d.startSize = 0.24 + this.nextRand() * 0.16;
      d.endSize = 0.04;
      d.baseAlpha = 0.95;
      d.lifetime = 0.26 + this.nextRand() * 0.34;
      d.drag = 1.1;
      d.gravity = -18.5;
      d.softness = 0.0;
      d.isSmoke = 0;

      this.commitDraft();
    }

    this.markBuffersDirty();
  }

  emitNitroTrail(x: number, y: number, z: number, heading: number): void {
    if (this.disposed) {
      return;
    }

    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);
    const d = this.draft;

    // Twin tailpipes streaming electric-cyan and neon-magenta plasma exhaust
    for (let i = 0; i < 4; i += 1) {
      const pipeSide = i % 2 === 0 ? -1 : 1;
      const isCyan = i < 2;
      const jetSpeed = 7.5 + this.nextRand() * 5.2;

      d.px = x - forwardX * 1.95 + rightX * pipeSide * 0.46 + (this.nextRand() - 0.5) * 0.1;
      d.py = y + 0.28 + (this.nextRand() - 0.5) * 0.08;
      d.pz = z - forwardZ * 1.95 + rightZ * pipeSide * 0.46 + (this.nextRand() - 0.5) * 0.1;
      d.vx = -forwardX * jetSpeed + (this.nextRand() - 0.5) * 0.85;
      d.vy = 0.15 + (this.nextRand() - 0.5) * 0.45;
      d.vz = -forwardZ * jetSpeed + (this.nextRand() - 0.5) * 0.85;
      d.r = isCyan ? 0.06 : 1.0;
      d.g = isCyan ? 0.95 : 0.18;
      d.b = isCyan ? 1.0 : 0.6;
      d.startSize = 0.44 + this.nextRand() * 0.2;
      d.endSize = 0.08;
      d.baseAlpha = 0.92;
      d.lifetime = 0.18 + this.nextRand() * 0.18;
      d.drag = 3.2;
      d.gravity = 0.2;
      d.softness = 0.18;
      d.isSmoke = 0;

      this.commitDraft();
    }

    this.markBuffersDirty();
  }

  update(dt: number): void {
    if (this.disposed || dt <= 0 || !Number.isFinite(dt)) {
      return;
    }
    if (this.activeCount === 0 && !this.dirtyBuffers) {
      return;
    }

    for (let i = 0; i < this.maxParticles; i += 1) {
      if ((this.active[i] ?? 0) === 0) {
        continue;
      }

      const nextAge = (this.age[i] ?? 0) + dt;
      const life = this.lifetime[i] ?? 0.001;

      if (nextAge >= life) {
        this.active[i] = 0;
        this.sizes[i] = 0;
        this.alphas[i] = 0;
        this.activeCount = Math.max(0, this.activeCount - 1);
        continue;
      }

      this.age[i] = nextAge;
      const t = nextAge / life;

      const damping = Math.exp(-(this.drag[i] ?? 0) * dt);
      const grav = this.gravity[i] ?? 0;

      const curVx = (this.vx[i] ?? 0) * damping;
      let curVy = ((this.vy[i] ?? 0) + grav * dt) * damping;
      const curVz = (this.vz[i] ?? 0) * damping;

      const i3 = i * 3;
      const nextX = (this.positions[i3] ?? 0) + curVx * dt;
      let nextY = (this.positions[i3 + 1] ?? 0) + curVy * dt;
      const nextZ = (this.positions[i3 + 2] ?? 0) + curVz * dt;

      if (grav < 0 && nextY < 0.04) {
        nextY = 0.04;
        curVy = Math.abs(curVy) * 0.35;
      }

      this.vx[i] = curVx;
      this.vy[i] = curVy;
      this.vz[i] = curVz;
      this.positions[i3] = nextX;
      this.positions[i3 + 1] = nextY;
      this.positions[i3 + 2] = nextZ;

      const s0 = this.startSize[i] ?? 0;
      const s1 = this.endSize[i] ?? 0;
      this.sizes[i] = s0 + (s1 - s0) * t;

      const fadeOut = (1 - t) * (1 - t);
      const smokeFadeIn = (this.isSmoke[i] ?? 0) === 1 ? Math.min(1, t / 0.12) : 1;
      this.alphas[i] = (this.baseAlpha[i] ?? 0) * fadeOut * smokeFadeIn;
    }

    this.markBuffersDirty();
    this.dirtyBuffers = false;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.active.fill(0);
    this.sizes.fill(0);
    this.alphas.fill(0);
    this.activeCount = 0;
    this.dirtyBuffers = false;
    this.geometry.dispose();
    this.material.dispose();
  }

  private allocateSlot(): number {
    for (let offset = 0; offset < this.maxParticles; offset += 1) {
      const slot = (this.cursor + offset) % this.maxParticles;
      if ((this.active[slot] ?? 0) === 0) {
        this.active[slot] = 1;
        this.activeCount += 1;
        this.cursor = (slot + 1) % this.maxParticles;
        return slot;
      }
    }

    // Pool is full: recycle the oldest particle slot to respect maxParticles cap
    let oldestSlot = 0;
    let maxProgress = -1;
    for (let i = 0; i < this.maxParticles; i += 1) {
      const progress = (this.age[i] ?? 0) / Math.max(0.001, this.lifetime[i] ?? 1);
      if (progress > maxProgress) {
        maxProgress = progress;
        oldestSlot = i;
      }
    }
    this.cursor = (oldestSlot + 1) % this.maxParticles;
    return oldestSlot;
  }

  private commitDraft(): void {
    const slot = this.allocateSlot();
    const i3 = slot * 3;
    const d = this.draft;

    this.positions[i3] = d.px;
    this.positions[i3 + 1] = d.py;
    this.positions[i3 + 2] = d.pz;

    this.colors[i3] = d.r;
    this.colors[i3 + 1] = d.g;
    this.colors[i3 + 2] = d.b;

    this.sizes[slot] = d.startSize;
    this.alphas[slot] = d.isSmoke === 1 ? d.baseAlpha * 0.25 : d.baseAlpha;
    this.softness[slot] = d.softness;

    this.age[slot] = 0;
    this.lifetime[slot] = d.lifetime;
    this.vx[slot] = d.vx;
    this.vy[slot] = d.vy;
    this.vz[slot] = d.vz;
    this.startSize[slot] = d.startSize;
    this.endSize[slot] = d.endSize;
    this.baseAlpha[slot] = d.baseAlpha;
    this.drag[slot] = d.drag;
    this.gravity[slot] = d.gravity;
    this.isSmoke[slot] = d.isSmoke;

    this.dirtyBuffers = true;
  }

  private markBuffersDirty(): void {
    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.softAttr.needsUpdate = true;
  }

  private nextRand(): number {
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }
}
