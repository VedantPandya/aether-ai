import { appUrl } from './urls';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Config, Plan, Sample } from './types';

export default function Universe({ config, plan, sample, resetKey }: { config: Config; plan: Plan | null; sample: Sample | null; resetKey: number }) {
  const host = useRef<HTMLDivElement>(null);
  const moving = useRef<{ ship: THREE.Group; station: THREE.Group; path: THREE.Line; scale: number; type: string } | null>(null);
  const latest = useRef(sample); latest.current = sample;
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setError(true); return; }
    setError(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x080e12, 1); element.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D spacecraft simulation. Drag to rotate and scroll to zoom.');
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080e12, 0.011);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
    const type = config.mission_type;
    camera.position.set(type === 'launch' ? 4 : 4.5, type === 'docking' ? 4.8 : 4.2, 7.4);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 3; controls.maxDistance = 18;
    scene.add(new THREE.AmbientLight(0x8ba5b8, 1.5));
    const sun = new THREE.DirectionalLight(0xfff2d2, 3.5); sun.position.set(-4, 3, 5); scene.add(sun);
    const rim = new THREE.DirectionalLight(0x538dff, 1); rim.position.set(4, 0, -3); scene.add(rim);
    const points: number[] = []; let seed = 71;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 1700; i++) { const theta = rand() * Math.PI * 2; const z = rand() * 2 - 1; const r = 22 + rand() * 30; points.push(r * Math.sqrt(1-z*z) * Math.cos(theta), r*z, r * Math.sqrt(1-z*z) * Math.sin(theta)); }
    const stars = new THREE.BufferGeometry(); stars.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xc6d6df, size: 0.025, transparent: true, opacity: 0.7 })));
    const scale = type === 'docking' ? 0.048 : type === 'lunar' ? 3 / 384400 : 2.15 / 6371;
    const earthRadius = type === 'lunar' ? 0.45 : 6371 * scale;
    const globeMaterial = new THREE.MeshPhongMaterial({ color: 0xc7d8de, shininess: 14, specular: 0x324f6f });
    let disposed = false;
    const texture = new THREE.TextureLoader().load(appUrl('/earth-blue-marble.png'), loaded => { if (disposed) return; loaded.colorSpace = THREE.SRGBColorSpace; globeMaterial.map = loaded; globeMaterial.needsUpdate = true; });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(earthRadius, 64, 48), globeMaterial); earth.rotation.y = 2.8;
    if (type !== 'docking') scene.add(earth);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(earthRadius*1.018, 48, 32), new THREE.MeshBasicMaterial({ color: 0x63bded, transparent: true, opacity: 0.09, side: THREE.BackSide }));
    if (type !== 'docking') scene.add(atmosphere);
    const grid = new THREE.PolarGridHelper(type === 'lunar' ? 4 : 3.7, 12, 6, 96, 0x293a38, 0x172923); grid.position.y = -0.04; scene.add(grid);
    const line = (pts: THREE.Vector3[], color: number, opacity = 1, dashed = false) => {
      const obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.05, gapSize: 0.04 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
      if (dashed) obj.computeLineDistances(); scene.add(obj); return obj;
    };
    const ring = (radius: number, color: number, opacity: number) => line(Array.from({length: 181}, (_,i) => new THREE.Vector3(Math.cos(i/180*Math.PI*2)*radius,0,Math.sin(i/180*Math.PI*2)*radius)),color,opacity,true);
    if (type === 'orbit') { ring((6371+config.start_altitude_km)*scale,0x7f969d,0.55); ring((6371+config.target_altitude_km)*scale,0xc8ef8c,0.9); }
    const orbitalPath = plan?.samples?.map(s => new THREE.Vector3(s.x*scale, type === 'launch' ? s.altitude_km*0.012 : 0, type === 'launch' ? 0 : s.y*scale));
    const route = line(orbitalPath ?? [], 0xd9fc97, 0.95);
    if (type === 'launch') { earth.position.y = -earthRadius; atmosphere.position.y = -earthRadius; camera.position.set(3,2.6,5); controls.target.set(0,1.1,0); controls.minDistance=0.3; }
    if (type === 'lunar') {
      const moon = new THREE.Mesh(new THREE.SphereGeometry(0.14,32,24), new THREE.MeshStandardMaterial({color:0xb6b8af,roughness:1})); moon.position.set(-3,0,0); scene.add(moon);
      // Transfer endpoints are on opposite sides of Earth; Moon is an endpoint marker, not a propagated body.
      controls.target.set(-1.2,0,0); camera.position.set(2.5,4.5,7);
    }
    const station = new THREE.Group();
    const stationMat = new THREE.MeshStandardMaterial({color:0xbfc9c3,metalness:0.6,roughness:0.4});
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(8*scale,0.5*scale,12,64),stationMat); hoop.rotation.x=Math.PI/2; station.add(hoop);
    for (let i=0;i<4;i++) { const spoke = new THREE.Mesh(new THREE.BoxGeometry(16*scale,0.5*scale,0.5*scale),stationMat); spoke.rotation.y=i*Math.PI/2; station.add(spoke); }
    const port=new THREE.Mesh(new THREE.BoxGeometry(2*scale,2*scale,2*scale),new THREE.MeshStandardMaterial({color:0xd9fa80,emissive:0x668822,emissiveIntensity:0.5})); port.position.x=8*scale; station.add(port);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(2*scale,2*scale,3*scale,16),stationMat); station.add(hub);
    if(type==='docking') { scene.add(station); controls.target.set(1.1,0,0); camera.position.set(3.5,3.3,6); controls.minDistance=0.5; }
    const ship = new THREE.Group();
    const bodyMat=new THREE.MeshStandardMaterial({color:0xf2f0df,metalness:0.4,roughness:0.45});
    const body=new THREE.Mesh(new THREE.CylinderGeometry(0.036,0.04,0.14,12),bodyMat); body.rotation.z=-Math.PI/2; ship.add(body);
    const nose=new THREE.Mesh(new THREE.ConeGeometry(0.037,0.065,12),bodyMat); nose.rotation.z=-Math.PI/2; nose.position.x=0.1; ship.add(nose);
    for(const sign of (type==='launch'?[]:[-1,1])) { const panel=new THREE.Mesh(new THREE.BoxGeometry(0.13,0.008,0.1),new THREE.MeshStandardMaterial({color:0x234c78,metalness:0.65,roughness:0.3})); panel.position.z=sign*0.12; ship.add(panel); }
    const light=new THREE.Mesh(new THREE.SphereGeometry(0.022,12,12),new THREE.MeshBasicMaterial({color:0xd9fa80})); light.position.x=0.03; light.position.y=0.05; ship.add(light);
    const halo=new THREE.Mesh(new THREE.RingGeometry(0.12,0.127,48),new THREE.MeshBasicMaterial({color:0xd9fa80,side:THREE.DoubleSide,transparent:true,opacity:0.7})); halo.rotation.x=-Math.PI/2; ship.add(halo);
    if(type==='launch') ship.scale.setScalar(2); scene.add(ship);
    moving.current={ship,station,path:route,scale,type};
    const resize=()=>{ const w=element.clientWidth,h=element.clientHeight; renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix(); };
    const observer=new ResizeObserver(resize); observer.observe(element); resize();
    let frame=0;
    const animate=()=>{
      frame=requestAnimationFrame(animate);
      const s=latest.current;
      if(s) { ship.position.set(s.x*scale,type==='launch'?s.altitude_km*0.012:0,type==='launch'?0:s.y*scale); if(type==='docking') { station.rotation.y=-(s.station_angle??0); ship.rotation.y=Math.atan2(-s.y,-s.x); } else if(type==='launch') ship.rotation.z=Math.PI/2; else ship.rotation.y=-Math.atan2(s.x,s.y); }
      else ship.position.set(type==='docking'?88*scale:type==='launch'?0:(6371+config.start_altitude_km)*scale,0,0);
      controls.update(); renderer.render(scene,camera);
    }; animate();
    return()=>{ disposed=true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); scene.traverse(obj=>{const m=obj as THREE.Mesh; m.geometry?.dispose(); if(m.material) (Array.isArray(m.material)?m.material:[m.material]).forEach(mat=>mat.dispose());}); texture.dispose(); renderer.dispose(); renderer.domElement.remove(); moving.current=null; };
  }, [config.mission_type, config.start_altitude_km, config.target_altitude_km, plan?.samples, resetKey]);
  return <div ref={host} className="universe">{error&&<div className="webgl-error">3D rendering is unavailable. Try a browser with WebGL enabled. The mission calculations and telemetry still work.</div>}</div>;
}
