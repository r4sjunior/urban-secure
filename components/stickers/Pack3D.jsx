/**
 * components/stickers/Pack3D.jsx
 * Abertura 3D do pacote de figurinha (React Three Fiber).
 *
 * Máquina de estados dirigida pela prop `state`:
 *   tearing   → o pacote se parte em duas metades por uma borda irregular
 *   revealing → a figurinha sobe do interior, com burst de partículas
 *   revealed  → figurinha de frente, brilho varrendo em loop
 *
 * REGRAS DE PERFORMANCE (o alvo é 60fps num celular médio):
 *  - toda animação acontece em `useFrame` mutando refs; NENHUM setState por
 *    frame, porque cada um custaria um re-render de React a 60Hz
 *  - geometrias, materiais e atributos ficam em `useMemo` — alocar dentro do
 *    useFrame criaria lixo 60 vezes por segundo e o coletor apareceria como
 *    engasgo visível
 *  - dispose() explícito no desmonte: texturas e geometrias vivem na GPU e
 *    não são liberadas pelo GC do JS
 *
 * Quem decide se esta cena roda é o PackOpening (checa WebGL e
 * prefers-reduced-motion). Aqui assumimos que dá pra desenhar.
 */

import { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { rarityByKey } from '../../lib/stickers/rarity';

const TEAR_DURATION = 0.85;   // segundos até as metades saírem de quadro
const REVEAL_DURATION = 0.9;  // subida + escala da figurinha

/**
 * Borda irregular de papel rasgado.
 *
 * Um plano cortado em linha reta parece corte de guilhotina, não rasgo. O
 * recorte é gerado por ruído 1D somando senoides de frequências diferentes —
 * dá uma silhueta que parece fibra de papel cedendo, sem custo de textura.
 */
function makeTornHalf(width, height, side /* -1 esquerda, +1 direita */) {
  const SEGMENTS = 28;
  const shape = new THREE.Shape();
  const halfW = width / 2;
  const halfH = height / 2;

  const tearX = (t) => {
    // Três harmônicas: a base dá a ondulação, as outras a aspereza.
    const n =
      Math.sin(t * 7.3) * 0.055 +
      Math.sin(t * 17.1 + 1.7) * 0.028 +
      Math.sin(t * 31.7 + 4.2) * 0.013;
    return n * width;
  };

  if (side < 0) {
    shape.moveTo(-halfW, -halfH);
    shape.lineTo(-halfW, halfH);
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      shape.lineTo(tearX(t), halfH - t * height);
    }
  } else {
    shape.moveTo(halfW, -halfH);
    shape.lineTo(halfW, halfH);
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      shape.lineTo(tearX(t), halfH - t * height);
    }
  }
  shape.closePath();

  return new THREE.ShapeGeometry(shape);
}

/** Uma metade do pacote: gira pra fora e cai com gravidade fingida. */
function PackHalf({ side, tearing, color }) {
  const ref = useRef();
  const elapsed = useRef(0);

  const geometry = useMemo(() => makeTornHalf(2.0, 2.9, side), [side]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#14171C',
    metalness: 0.85,
    roughness: 0.28,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.12,
  }), [color]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;

    if (!tearing) {
      // Flutuação sutil enquanto o pacote está fechado.
      elapsed.current += delta;
      mesh.position.y = Math.sin(elapsed.current * 1.4) * 0.045;
      mesh.rotation.y = Math.sin(elapsed.current * 0.7) * 0.16;
      return;
    }

    elapsed.current += delta;
    const t = Math.min(1, elapsed.current / TEAR_DURATION);

    // Ease-out cúbico na saída lateral, gravidade quadrática na queda —
    // separar os dois eixos é o que faz parecer peso, e não uma translação.
    const ease = 1 - Math.pow(1 - t, 3);
    mesh.position.x = side * ease * 3.4;
    mesh.position.y = -(t * t) * 3.2;
    mesh.rotation.z = side * ease * 1.5;
    mesh.rotation.y = side * ease * 0.9;
    mesh.material.opacity = 1 - Math.max(0, t - 0.55) / 0.45;
    mesh.material.transparent = true;
  });

  return <mesh ref={ref} geometry={geometry} material={material} />;
}

/** Burst de partículas na cor da raridade. */
function Particles({ active, color, count = 60 }) {
  const ref = useRef();
  const elapsed = useRef(0);

  // Posições e velocidades sorteadas UMA vez. Recalcular por frame seria
  // alocação constante e as partículas não teriam trajetória coerente.
  const { positions, velocities, geometry, material } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      pos[i * 3] = 0; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0;
      // Direção esférica uniforme
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 1.2 + Math.random() * 2.4;
      vel[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      vel[i * 3 + 1] = Math.abs(Math.cos(phi)) * speed * 1.3;
      vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed * 0.5;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(color),
      size: 0.075,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    return { positions: pos, velocities: vel, geometry: geo, material: mat };
  }, [count, color]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useFrame((_, delta) => {
    if (!active || !ref.current) return;
    elapsed.current += delta;

    const attr = geometry.getAttribute('position');
    for (let i = 0; i < count; i++) {
      positions[i * 3] += velocities[i * 3] * delta;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * delta - 1.8 * elapsed.current * delta;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * delta;
    }
    attr.needsUpdate = true;

    material.opacity = Math.max(0, 1 - elapsed.current / 1.5);
  });

  if (!active) return null;
  return <points ref={ref} geometry={geometry} material={material} />;
}

/** A figurinha revelada. */
function StickerPlane({ revealing, imageUrl, color, isLegendary, onDone }) {
  const ref = useRef();
  const elapsed = useRef(0);
  const done = useRef(false);
  const [texture, setTexture] = useState(null);

  useEffect(() => {
    if (!imageUrl) return;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    let tex;
    loader.load(
      imageUrl,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        tex = t;
        setTexture(t);
      },
      undefined,
      // Gateway do IPFS falhando não pode travar a revelação: sem textura a
      // figurinha aparece na cor da raridade, e o card 2D abaixo da cena
      // mostra a arte de qualquer forma.
      () => console.warn('[Pack3D] textura não carregou')
    );

    return () => { tex?.dispose(); };
  }, [imageUrl]);

  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: texture ? '#ffffff' : color,
    map: texture,
    metalness: isLegendary ? 0.75 : 0.15,
    roughness: isLegendary ? 0.18 : 0.55,
    emissive: new THREE.Color(color),
    emissiveIntensity: isLegendary ? 0.35 : 0.12,
  }), [texture, color, isLegendary]);

  useEffect(() => () => material.dispose(), [material]);

  useFrame((state, delta) => {
    const mesh = ref.current;
    if (!mesh || !revealing) return;

    elapsed.current += delta;
    const t = Math.min(1, elapsed.current / REVEAL_DURATION);

    // Overshoot elástico: passa de 1 e volta. É o que dá a sensação de "pop"
    // — uma interpolação linear até 1 pareceria a figurinha sendo empurrada.
    const overshoot = 1 + 0.18 * Math.sin(t * Math.PI) * (1 - t);
    const scale = (0.6 + 0.4 * (1 - Math.pow(1 - t, 3))) * overshoot;

    mesh.scale.setScalar(scale);
    mesh.position.y = -0.8 + 0.8 * (1 - Math.pow(1 - t, 2));

    // Depois de revelada, balança de leve — mantém a cena viva sem distrair.
    if (t >= 1) {
      const idle = state.clock.elapsedTime;
      mesh.rotation.y = Math.sin(idle * 0.8) * 0.22;
      mesh.rotation.x = Math.sin(idle * 0.6) * 0.06;

      if (!done.current) { done.current = true; onDone?.(); }
    } else {
      mesh.rotation.y = (1 - t) * Math.PI * 1.5;
    }
  });

  return (
    <mesh ref={ref} material={material} scale={0.6} position={[0, -0.8, 0.1]}>
      <planeGeometry args={[1.9, 2.7]} />
    </mesh>
  );
}

function Scene({ state, rarity, imageUrl, onRevealed }) {
  const rarityCfg = rarityByKey(rarity);
  const isLegendary = rarityCfg.key === 'lendario';
  const tearing = state === 'tearing' || state === 'revealed';

  // A revelação começa depois que as metades já saíram de quadro — se as
  // duas animações rodassem juntas, a figurinha apareceria por trás do
  // pacote ainda inteiro.
  const [revealing, setRevealing] = useState(state === 'revealed');

  useEffect(() => {
    if (state !== 'tearing') return;
    const id = setTimeout(() => setRevealing(true), TEAR_DURATION * 620);
    return () => clearTimeout(id);
  }, [state]);

  const { gl } = useThree();
  useEffect(() => () => gl.dispose(), [gl]);

  return (
    <>
      <ambientLight intensity={0.45} />
      <spotLight position={[-4, 6, 5]} angle={0.5} penumbra={0.8} intensity={2.2} color="#fff4e0" />
      {/* Rim light na cor da raridade — recorta a silhueta contra o fundo
          escuro e comunica a raridade antes de qualquer texto. */}
      <pointLight position={[0, 0, -4]} intensity={isLegendary ? 5 : 3} color={rarityCfg.color} />

      {!revealing && (
        <>
          <PackHalf side={-1} tearing={tearing} color={rarityCfg.color} />
          <PackHalf side={1} tearing={tearing} color={rarityCfg.color} />
        </>
      )}

      <Particles active={revealing} color={rarityCfg.color} count={isLegendary ? 90 : 55} />

      <StickerPlane
        revealing={revealing}
        imageUrl={imageUrl}
        color={rarityCfg.color}
        isLegendary={isLegendary}
        onDone={onRevealed}
      />
    </>
  );
}

export default function Pack3D({ state, rarity, imageUrl, onRevealed }) {
  return (
    <div className="pack3d">
      <Canvas
        // dpr limitado: renderizar em 3x num celular moderno triplica o custo
        // de fragment shader sem ganho perceptível numa cena deste tamanho.
        dpr={[1, 2]}
        camera={{ position: [0, 0, 5], fov: 35 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
      >
        <Scene state={state} rarity={rarity} imageUrl={imageUrl} onRevealed={onRevealed} />
      </Canvas>
    </div>
  );
}
