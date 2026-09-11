'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PaymentDTO } from '@stellar-alerts/shared';
import {
  buildScene,
  sceneLegend,
  type PaymentStream,
  type VisualizerScene,
  type VisualizerPayment,
} from './networkVisualizer.helpers';

interface NetworkVisualizer3DProps {
  payments: PaymentDTO[];
  /** Optional cap on how many recent payments to render as beams. */
  maxStreams?: number;
}

/** A single glowing node (account) in the network. */
const AccountNode: React.FC<{ position: [number, number, number]; isHub: boolean }> = ({
  position,
  isHub,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 2 + position[0]) * 0.08;
    meshRef.current.scale.setScalar(pulse);
  });

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[isHub ? 0.8 : 0.35, 24, 24]} />
      <meshStandardMaterial
        color={isHub ? '#67e8f9' : '#1e293b'}
        emissive={isHub ? '#22d3ee' : '#334155'}
        emissiveIntensity={isHub ? 1.4 : 0.4}
        roughness={0.3}
        metalness={0.6}
      />
    </mesh>
  );
};

/**
 * Particle beam for a single payment stream. `particleCount` particles are
 * distributed along the sender -> hub segment and advanced every frame at a
 * rate proportional to the payment amount (`stream.speed`).
 */
const StreamBeam: React.FC<{ stream: PaymentStream }> = ({ stream }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const offsets = useRef<Float32Array>(
    new Float32Array(
      Array.from({ length: stream.particleCount }, (_, i) => i / stream.particleCount),
    ),
  );

  const from = useMemo(() => new THREE.Vector3(...stream.fromPosition), [stream.fromPosition]);
  const to = useMemo(() => new THREE.Vector3(...stream.toPosition), [stream.toPosition]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(stream.particleCount * 3), 3),
    );
    return geo;
  }, [stream.particleCount]);

  const lineGeometry = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([from, to]),
    [from, to],
  );

  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    const positionAttr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const segmentLength = from.distanceTo(to) || 1;
    const step = (stream.speed * delta) / segmentLength;

    for (let i = 0; i < offsets.current.length; i += 1) {
      let t = offsets.current[i] + step;
      if (t > 1) t -= 1;
      offsets.current[i] = t;
      positionAttr.setXYZ(
        i,
        THREE.MathUtils.lerp(from.x, to.x, t),
        THREE.MathUtils.lerp(from.y, to.y, t),
        THREE.MathUtils.lerp(from.z, to.z, t),
      );
    }
    positionAttr.needsUpdate = true;
  });

  return (
    <group>
      {/* `lineSegments` (not the SVG-colliding `line` intrinsic) draws the faint guide beam. */}
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial color={stream.color} transparent opacity={0.15} />
      </lineSegments>
      <points ref={pointsRef} geometry={geometry}>
        <pointsMaterial
          color={stream.color}
          size={0.18 + Math.min(stream.amount / 5000, 0.25)}
          sizeAttenuation
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
};

/** The three.js scene contents — rendered inside <Canvas>. */
export const StreamField: React.FC<{ scene: VisualizerScene }> = ({ scene }) => {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.08;
  });

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} intensity={120} color="#22d3ee" />
      <pointLight position={[-10, -6, -10]} intensity={80} color="#6366f1" />
      <group ref={groupRef}>
        {scene.nodes.map((node) => (
          <AccountNode key={node.id} position={node.position} isHub={node.isHub} />
        ))}
        {scene.streams.map((stream) => (
          <StreamBeam key={stream.id} stream={stream} />
        ))}
      </group>
    </>
  );
};

export const NetworkVisualizer3D: React.FC<NetworkVisualizer3DProps> = ({
  payments = [],
  maxStreams = 40,
}) => {
  // Guard against SSR / hydration: only mount the WebGL canvas in the browser.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const scene = useMemo<VisualizerScene>(
    () => buildScene(payments as unknown as VisualizerPayment[], { limit: maxStreams }),
    [payments, maxStreams],
  );
  const legend = useMemo(() => sceneLegend(scene), [scene]);
  const activeStreams = scene.streams.length;

  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>🌊</span> Live Payment Stream Network
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Each beam is a recent payment flowing into your watched wallet. Particle speed
            tracks the amount; colour tracks the asset.
          </p>
        </div>
        <div
          className="text-xs text-slate-400 font-mono bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700/50 whitespace-nowrap"
          data-testid="active-stream-count"
        >
          <span className="text-cyan-400 font-semibold">{activeStreams}</span> active{' '}
          {activeStreams === 1 ? 'stream' : 'streams'}
        </div>
      </div>

      {legend.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="asset-legend">
          {legend.map(({ asset, color }) => (
            <span
              key={asset}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-950/60 border border-slate-800 text-slate-300"
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: color }}
                data-testid={`legend-swatch-${asset}`}
              />
              {asset}
            </span>
          ))}
        </div>
      )}

      <div className="relative h-[420px] w-full rounded-xl overflow-hidden bg-[#05050b] border border-slate-800">
        {activeStreams === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-center text-slate-500 text-sm px-6">
            No payment streams to visualise yet. Incoming Stellar payments will appear here as
            live particle beams.
          </div>
        ) : mounted || typeof window !== 'undefined' ? (
          <Canvas
            camera={{ position: [0, 4, 16], fov: 55 }}
            dpr={[1, 1.5]}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          >
            <StreamField scene={scene} />
          </Canvas>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-xs">
            Initialising renderer…
          </div>
        )}
      </div>
    </div>
  );
};

export default NetworkVisualizer3D;
