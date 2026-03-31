/**
 * 3D Cricket Gameplay Scene
 * Transparent canvas over stadium background image
 * Only renders: ball, bat, wickets, pitch overlay, hit zone, particles
 */

import { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Trail, useTexture } from '@react-three/drei';
import * as THREE from 'three';

// ── Coordinate mapping ────────────────────────────────────
const PITCH_Z_START = -7;
const PITCH_Z_END = 6;
const PITCH_LENGTH = PITCH_Z_END - PITCH_Z_START;

function mapBallProgress(ballY: number): number {
  return (ballY - 50) / 530;
}

function mapBallZ(ballY: number): number {
  return PITCH_Z_START + mapBallProgress(ballY) * PITCH_LENGTH;
}

function mapBallHeight(ballY: number): number {
  const p = mapBallProgress(ballY);
  if (p < 0.15) {
    const t = p / 0.15;
    return 2.0 + 0.3 * Math.sin(t * Math.PI * 0.5) - t * 0.4;
  } else if (p < 0.52) {
    const t = (p - 0.15) / 0.37;
    return 1.9 * (1 - t * t);
  } else if (p < 0.58) {
    const t = (p - 0.52) / 0.06;
    return 0.03 + 0.02 * Math.sin(t * Math.PI);
  } else {
    const t = (p - 0.58) / 0.42;
    return 0.05 + Math.sin(t * Math.PI * 0.55) * 0.85;
  }
}

function mapX(x: number): number {
  return ((x - 200) / 60) * 1.2;
}

// ── Types ─────────────────────────────────────────────────
interface Ball {
  x: number; y: number; radius: number;
  speed: number; active: boolean; curve: number; hasSwung: boolean;
}

interface GameState {
  score: number; ballsPlayed: number;
  isGameOver: boolean; gameStarted: boolean;
  batX: number; targetBatX: number;
  isSwinging: boolean; isMuted: boolean;
  shotType: string;
  activePointerId: number | null;
}

interface Particle3D {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  color: THREE.Color;
  size: number;
}

interface SceneProps {
  ballRef: React.MutableRefObject<Ball>;
  gameStateRef: React.MutableRefObject<GameState>;
  crowdEnergyRef: React.MutableRefObject<number>;
  celebrationTypeRef: React.MutableRefObject<'six' | 'four' | 'wicket' | null>;
  shakeActiveRef: React.MutableRefObject<boolean>;
}

// ── Hit Zone Indicator ────────────────────────────────────
function HitZone({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const gs = gameStateRef.current;
    meshRef.current.visible = gs.gameStarted && !gs.isGameOver;
    if (meshRef.current.visible) {
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.06 * Math.sin(clock.elapsedTime * 3);
    }
  });

  const zStart = mapBallZ(430);
  const zEnd = mapBallZ(570);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, (zStart + zEnd) / 2]}>
      <planeGeometry args={[2.4, zEnd - zStart]} />
      <meshBasicMaterial color="#F5A623" transparent opacity={0.12} depthWrite={false} />
    </mesh>
  );
}

// ── Wickets ───────────────────────────────────────────────
function Wickets({ position }: { position: [number, number, number] }) {
  const stumpMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e8dcc8', roughness: 0.5, metalness: 0.05 }), []);
  const bailMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d4c4a0', roughness: 0.4 }), []);
  const bandMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#1a237e', transparent: true, opacity: 0.85 }), []);

  const stumpR = 0.022;
  const stumpH = 0.72;
  const spacing = 0.115;

  return (
    <group position={position}>
      {[-1, 0, 1].map(i => (
        <group key={i} position={[i * spacing, 0, 0]}>
          <mesh position={[0, stumpH / 2, 0]} castShadow material={stumpMat}>
            <cylinderGeometry args={[stumpR, stumpR + 0.002, stumpH, 8]} />
          </mesh>
          <mesh position={[0, stumpH * 0.35, 0]} material={bandMat}>
            <cylinderGeometry args={[stumpR + 0.003, stumpR + 0.003, 0.1, 8]} />
          </mesh>
          <mesh position={[0, stumpH * 0.7, 0]} material={bandMat}>
            <cylinderGeometry args={[stumpR + 0.003, stumpR + 0.003, 0.08, 8]} />
          </mesh>
        </group>
      ))}
      {[-0.5, 0.5].map(i => (
        <mesh key={i} position={[i * spacing, stumpH + 0.015, 0]} rotation={[0, 0, Math.PI / 2]} material={bailMat} castShadow>
          <cylinderGeometry args={[0.01, 0.01, spacing * 1.1, 6]} />
        </mesh>
      ))}
    </group>
  );
}

// ── Cricket Ball ──────────────────────────────────────────
function CricketBall({ ballRef, gameStateRef }: { ballRef: React.MutableRefObject<Ball>; gameStateRef: React.MutableRefObject<GameState> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const spinRef = useRef({ x: 0, z: 0 });

  const ballMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#cc2020', roughness: 0.2, metalness: 0.08,
    emissive: '#ff2200', emissiveIntensity: 0.35,
  }), []);

  const seamMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#f5f5dc', transparent: true, opacity: 0.7,
  }), []);

  // Glow ring material
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ff4422', transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false,
  }), []);

  useFrame((_, delta) => {
    const ball = ballRef.current;
    const gs = gameStateRef.current;
    if (!meshRef.current || !shadowRef.current) return;

    const visible = ball.active && !gs.isGameOver && gs.gameStarted;
    meshRef.current.visible = visible;
    shadowRef.current.visible = visible;
    if (!visible) return;

    const x = mapX(ball.x);
    const z = mapBallZ(ball.y);
    const y = mapBallHeight(ball.y);

    meshRef.current.position.set(x, y + 0.06, z);
    const progress = mapBallProgress(ball.y);
    const spinSpeed = progress < 0.55 ? 12 : 8;
    spinRef.current.x += spinSpeed * delta;
    spinRef.current.z += ball.curve * 2 * delta;
    meshRef.current.rotation.set(spinRef.current.x, 0, spinRef.current.z);

    shadowRef.current.position.set(x, 0.004, z);
    const shadowScale = Math.max(0.05, 0.2 - y * 0.06);
    shadowRef.current.scale.set(shadowScale + 0.05, shadowScale, shadowScale + 0.05);
    (shadowRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0.1, 0.5 - y * 0.15);
  });

  return (
    <>
      <Trail width={0.35} length={12} color="#ff4422" attenuation={(t) => t * t * t} target={meshRef}>
        <mesh ref={meshRef} castShadow>
          <sphereGeometry args={[0.08, 12, 12]} />
          <primitive object={ballMat} attach="material" />
          {/* Seam */}
          <mesh rotation={[Math.PI / 6, 0, Math.PI / 4]}>
            <torusGeometry args={[0.072, 0.005, 3, 16]} />
            <primitive object={seamMat} attach="material" />
          </mesh>
          {/* Outer glow ring — always faces camera */}
          <mesh>
            <ringGeometry args={[0.09, 0.16, 24]} />
            <primitive object={glowMat} attach="material" />
          </mesh>
        </mesh>
      </Trail>
      {/* Ground shadow */}
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.15, 12]} />
        <meshBasicMaterial color="#0a2a0a" transparent opacity={0.4} depthWrite={false} />
      </mesh>
    </>
  );
}

// ── Shot types and full body poses ────────────────────────
type ShotType = 'straight' | 'cover' | 'pull' | 'sweep' | 'uppercut' | 'flick' | 'defend';

interface BodyPose {
  armRx: number; armRy: number; armRz: number;
  torsoTwist: number; torsoLean: number;
  frontKnee: number; backKnee: number; stride: number;
  swingSpeed: number; returnSpeed: number; followThrough: number;
}

const READY: BodyPose = {
  armRx: 0.15, armRy: 0, armRz: 0,
  torsoTwist: 0.3, torsoLean: 0.05,
  frontKnee: 0.15, backKnee: 0.2, stride: 0,
  swingSpeed: 6, returnSpeed: 6, followThrough: 0,
};
const BACKLIFT: BodyPose = {
  armRx: -0.7, armRy: 0.2, armRz: -0.1,
  torsoTwist: 0.5, torsoLean: -0.1,
  frontKnee: 0.2, backKnee: 0.3, stride: -0.05,
  swingSpeed: 35, returnSpeed: 6, followThrough: 0,
};
const SHOTS: Record<ShotType, BodyPose> = {
  straight: { armRx: 1.3, armRy: 0, armRz: 0, torsoTwist: -0.1, torsoLean: 0.2, frontKnee: 0.05, backKnee: 0.4, stride: 0.15, swingSpeed: 28, returnSpeed: 5, followThrough: 0.3 },
  cover: { armRx: 1.2, armRy: 0.5, armRz: -0.2, torsoTwist: -0.4, torsoLean: 0.15, frontKnee: 0.05, backKnee: 0.35, stride: 0.2, swingSpeed: 26, returnSpeed: 5, followThrough: 0.4 },
  pull: { armRx: 1.0, armRy: -0.7, armRz: 0.3, torsoTwist: 0.6, torsoLean: -0.1, frontKnee: 0.3, backKnee: 0.1, stride: -0.05, swingSpeed: 30, returnSpeed: 4, followThrough: 0.5 },
  sweep: { armRx: 0.8, armRy: -0.9, armRz: 0.5, torsoTwist: 0.5, torsoLean: 0.3, frontKnee: 1.2, backKnee: 0.6, stride: 0.1, swingSpeed: 25, returnSpeed: 5, followThrough: 0.3 },
  uppercut: { armRx: 1.6, armRy: 0.2, armRz: -0.3, torsoTwist: 0.2, torsoLean: -0.2, frontKnee: 0.15, backKnee: 0.5, stride: -0.1, swingSpeed: 32, returnSpeed: 4, followThrough: 0.6 },
  flick: { armRx: 1.1, armRy: -0.4, armRz: 0.15, torsoTwist: 0.3, torsoLean: 0.1, frontKnee: 0.1, backKnee: 0.3, stride: 0.08, swingSpeed: 30, returnSpeed: 6, followThrough: 0.35 },
  defend: { armRx: 0.5, armRy: 0, armRz: 0, torsoTwist: 0, torsoLean: 0.15, frontKnee: 0.2, backKnee: 0.15, stride: 0.1, swingSpeed: 20, returnSpeed: 8, followThrough: 0.08 },
};

// ── Cricket Bat (bat only — reliable, no external model) ──
function CricketBat({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const groupRef = useRef<THREE.Group>(null);
  const swingPhase = useRef<'ready' | 'backswing' | 'swing' | 'follow' | 'return'>('ready');
  const swingTimer = useRef(0);
  const wasSwinging = useRef(false);
  const activeShotRef = useRef<BodyPose>(SHOTS.straight);
  const cur = useRef({ rx: -0.6, ry: 0.25, rz: 0.15 });

  const bladeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d4b896', roughness: 0.45, metalness: 0.02 }), []);
  const bladeBackMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c4a87a', roughness: 0.55 }), []);
  const handleMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.7 }), []);
  const gripMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3D45C3', roughness: 0.6 }), []);
  const logoTex = useTexture('/bat-logo.png');
  logoTex.minFilter = THREE.LinearFilter; logoTex.magFilter = THREE.LinearFilter; logoTex.generateMipmaps = false;
  const stickerMat = useMemo(() => new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, toneMapped: false }), [logoTex]);
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#050a05', transparent: true, opacity: 0.4, depthWrite: false }), []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const gs = gameStateRef.current;
    groupRef.current.position.x = mapX(gs.batX);

    if (gs.isSwinging && !wasSwinging.current) {
      wasSwinging.current = true; swingPhase.current = 'backswing'; swingTimer.current = 0;
      activeShotRef.current = SHOTS[gs.shotType as ShotType] || SHOTS.straight;
    }
    if (!gs.isSwinging) wasSwinging.current = false;

    const shot = activeShotRef.current;
    swingTimer.current += delta;

    let tRx = -0.6, tRy = 0.25, tRz = 0.15, sp = 6;
    switch (swingPhase.current) {
      case 'backswing':
        tRx = -0.9; tRy = shot.armRy * -0.3; tRz = shot.armRz * -0.2; sp = 35;
        if (swingTimer.current > 0.07) { swingPhase.current = 'swing'; swingTimer.current = 0; }
        break;
      case 'swing':
        tRx = shot.armRx; tRy = shot.armRy; tRz = shot.armRz; sp = shot.swingSpeed;
        if (swingTimer.current > 0.09) { swingPhase.current = 'follow'; swingTimer.current = 0; }
        break;
      case 'follow':
        tRx = shot.armRx + shot.followThrough; tRy = shot.armRy * 1.4; tRz = shot.armRz * 1.2;
        sp = shot.swingSpeed * 0.5;
        if (swingTimer.current > 0.18) { swingPhase.current = 'return'; swingTimer.current = 0; }
        break;
      case 'return':
        sp = shot.returnSpeed;
        if (Math.abs(cur.current.rx - (-0.6)) < 0.1) swingPhase.current = 'ready';
        break;
      default:
        tRx = -0.6 + Math.sin(swingTimer.current * 1.2) * 0.015;
        tRy = 0.25 + Math.sin(swingTimer.current * 0.7) * 0.008;
        sp = 6; break;
    }

    const f = Math.min(1, delta * sp);
    const c = cur.current;
    c.rx += (tRx - c.rx) * f; c.ry += (tRy - c.ry) * f; c.rz += (tRz - c.rz) * f;
    groupRef.current.rotation.set(c.rx, c.ry, c.rz);
  });

  return (
    <group ref={groupRef} position={[0, 1.2, 5]}>
      <mesh material={gripMat}><cylinderGeometry args={[0.022, 0.022, 0.1, 8]} /></mesh>
      <mesh position={[0, -0.19, 0]} material={handleMat} castShadow><cylinderGeometry args={[0.018, 0.015, 0.28, 8]} /></mesh>
      <mesh position={[0, -0.34, 0.003]} material={bladeMat}><boxGeometry args={[0.06, 0.04, 0.026]} /></mesh>
      <mesh position={[0, -0.58, 0.006]} material={bladeMat} castShadow><boxGeometry args={[0.15, 0.46, 0.027]} /></mesh>
      <mesh position={[0, -0.56, -0.012]} material={bladeBackMat} castShadow><boxGeometry args={[0.06, 0.4, 0.015]} /></mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * 0.07, -0.58, 0]} material={bladeBackMat}><boxGeometry args={[0.012, 0.44, 0.024]} /></mesh>
      ))}
      <mesh position={[0, -0.82, 0.004]} material={bladeMat}><boxGeometry args={[0.14, 0.04, 0.025]} /></mesh>
      <mesh position={[0, -0.54, 0.022]} material={stickerMat}><planeGeometry args={[0.13, 0.13]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.18, 0.1]} scale={[1, 0.5, 1]} material={shadowMat}>
        <circleGeometry args={[0.22, 12]} />
      </mesh>
    </group>
  );
}

// ── Celebration Particles ─────────────────────────────────
function CelebrationParticles({ celebrationTypeRef }: { celebrationTypeRef: React.MutableRefObject<'six' | 'four' | 'wicket' | null> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const particlesRef = useRef<Particle3D[]>([]);
  const lastType = useRef<string | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const MAX = 80;
  const tempColor = useMemo(() => new THREE.Color(), []); // #2.3: hoisted, no per-frame alloc

  useFrame((_, delta) => {
    const type = celebrationTypeRef.current;

    if (type && type !== lastType.current) {
      lastType.current = type;
      const parts = particlesRef.current;
      const batZ = PITCH_Z_END - 0.3;
      const colors = type === 'six'
        ? ['#FFD700', '#F5A623', '#FBBF24', '#FDE68A', '#ffffff']
        : type === 'four'
        ? ['#4ADE80', '#34D399', '#6EE7B7', '#ffffff']
        : ['#D4A574', '#C4956A', '#e8dcc8', '#8B7355'];
      const count = type === 'six' ? 45 : type === 'four' ? 22 : 14;

      for (let i = 0; i < count && parts.length < MAX; i++) {
        const angle = Math.random() * Math.PI * 2;
        const mag = 1.5 + Math.random() * (type === 'six' ? 5 : 3);
        const upForce = type === 'six' ? 4 + Math.random() * 6 : type === 'four' ? 3 + Math.random() * 4 : 2 + Math.random() * 5;
        parts.push({
          position: new THREE.Vector3(
            mapX(200) + (Math.random() - 0.5) * 0.6,
            type === 'wicket' ? 0.5 : 1.2,
            type === 'wicket' ? batZ + 0.5 : batZ - 0.3
          ),
          velocity: new THREE.Vector3(Math.cos(angle) * mag * 0.4, upForce, Math.sin(angle) * mag * 0.3 + (type === 'six' ? -2 : 0)),
          life: 1, maxLife: 1.8 + Math.random() * 1.2,
          color: new THREE.Color(colors[Math.floor(Math.random() * colors.length)]),
          size: 0.025 + Math.random() * 0.035,
        });
      }
    }
    if (!type) lastType.current = null;

    const parts = particlesRef.current;
    if (!meshRef.current) return;

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.velocity.y -= 9.8 * delta;
      p.position.addScaledVector(p.velocity, delta);
      p.life -= delta;
      if (p.life <= 0 || p.position.y < -1) parts.splice(i, 1);
    }

    for (let i = 0; i < MAX; i++) {
      if (i < parts.length) {
        const p = parts[i];
        const alpha = p.life / p.maxLife;
        dummy.position.copy(p.position);
        dummy.scale.setScalar(p.size * (0.3 + 0.7 * alpha));
        dummy.rotation.set(p.life * 10, p.life * 7, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        tempColor.copy(p.color);
        meshRef.current.setColorAt(i, tempColor);
      } else {
        dummy.position.set(0, -100, 0); dummy.scale.setScalar(0);
        dummy.updateMatrix(); meshRef.current.setMatrixAt(i, dummy.matrix);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

// ── Camera Controller ─────────────────────────────────────
function CameraController({ shakeActiveRef }: { shakeActiveRef: React.MutableRefObject<boolean> }) {
  const { camera } = useThree();
  const basePos = useMemo(() => new THREE.Vector3(0, 2.4, 11), []);
  const shakeIntensity = useRef(0);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const swayX = Math.sin(t * 0.25) * 0.03;
    const swayY = Math.sin(t * 0.18) * 0.01;

    if (shakeActiveRef.current) {
      shakeIntensity.current = Math.min(1, shakeIntensity.current + 0.35);
    } else {
      shakeIntensity.current *= 0.88;
    }

    const si = shakeIntensity.current;
    const shX = si * (Math.sin(t * 55) * 0.1 + Math.cos(t * 40) * 0.06);
    const shY = si * (Math.cos(t * 45) * 0.08 + Math.sin(t * 35) * 0.05);

    camera.position.set(basePos.x + swayX + shX, basePos.y + swayY + shY, basePos.z);
    camera.lookAt(0, 0.2, -2);
  });

  return null;
}

// ── Minimal pitch overlay (subtle, since BG image has the pitch) ──
function PitchOverlay() {
  return (
    <group>
      {/* Very subtle transparent pitch plane to catch shadows */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, -0.5]} receiveShadow>
        <planeGeometry args={[2.4, PITCH_LENGTH + 1.5]} />
        <shadowMaterial transparent opacity={0.3} />
      </mesh>
      {/* Large ground plane just for shadow receiving */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <shadowMaterial transparent opacity={0.2} />
      </mesh>
    </group>
  );
}

// ── Scene Content ─────────────────────────────────────────
function SceneContent(props: SceneProps) {
  return (
    <>
      <CameraController shakeActiveRef={props.shakeActiveRef} />

      {/* Lighting — night floodlit stadium */}
      <ambientLight intensity={0.3} color="#b0c4de" />
      <hemisphereLight args={['#1a1a40', '#0a2a0a', 0.25]} />
      {/* Floodlight simulation — warm top-down */}
      <directionalLight
        position={[5, 12, 3]}
        intensity={2.0}
        color="#ffeedd"
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
        shadow-camera-far={25}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.003}
      />
      {/* Cool fill from opposite side */}
      <directionalLight position={[-4, 6, -2]} intensity={0.5} color="#c0d0ff" />

      {/* Shadow-catching planes */}
      <PitchOverlay />

      {/* Hit zone */}
      <HitZone gameStateRef={props.gameStateRef} />

      {/* Wickets */}
      {/* Bowler's end — aligned with far crease */}
      {/* Bowler's end wickets — far end of pitch */}
      <Wickets position={[0, 0, PITCH_Z_START + 1]} />
      {/* Batsman's defending wickets — just behind the bat, visible */}
      <Wickets position={[0, 0, 5.8]} />

      {/* Ball */}
      <CricketBall ballRef={props.ballRef} gameStateRef={props.gameStateRef} />

      {/* Bat */}
      <CricketBat gameStateRef={props.gameStateRef} />

      {/* Particles */}
      <CelebrationParticles celebrationTypeRef={props.celebrationTypeRef} />
    </>
  );
}

// ── Exported Canvas (transparent, overlays on BG image) ───
export function GameScene(props: SceneProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      gl={{
        antialias: true,
        alpha: true, // transparent background
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.2,
      }}
      camera={{ fov: 42, near: 0.1, far: 100 }}
      style={{ position: 'absolute', inset: 0, zIndex: 1 }}
    >
      <Suspense fallback={null}>
        <SceneContent {...props} />
      </Suspense>
    </Canvas>
  );
}
