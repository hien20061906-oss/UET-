import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, Html } from '@react-three/fiber';
import { Physics, useBox, useRaycastVehicle, usePlane } from '@react-three/cannon';
import { useGLTF, Environment, ContactShadows, Preload, Sky } from '@react-three/drei';

// ─── CONTROLS ────────────────────────────────────────────────────────────────
function usePlayerControls() {
  const keys = useRef({ 
    forward: false, backward: false, left: false, right: false, 
    brake: false, reset: false, boost: false, change: false,
    up: false, down: false, yawLeft: false, yawRight: false 
  });
  useEffect(() => {
    const down = (e) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp')    keys.current.forward  = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown')  keys.current.backward = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft')  keys.current.left     = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.right    = true;
      if (e.code === 'KeyQ')                            keys.current.yawLeft  = true;
      if (e.code === 'KeyE')                            keys.current.yawRight = true;
      if (e.code === 'Space') { keys.current.brake = true; keys.current.up = true; }
      if (e.code === 'KeyR')   keys.current.reset = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { keys.current.boost = true; keys.current.down = true; }
      if (e.code === 'KeyC')   keys.current.change = true;
    };
    const up = (e) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp')    keys.current.forward  = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown')  keys.current.backward = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft')  keys.current.left     = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.right    = false;
      if (e.code === 'KeyQ')                            keys.current.yawLeft  = false;
      if (e.code === 'KeyE')                            keys.current.yawRight = false;
      if (e.code === 'Space') { keys.current.brake = false; keys.current.up = false; }
      if (e.code === 'KeyR')   keys.current.reset = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { keys.current.boost = false; keys.current.down = false; }
      if (e.code === 'KeyC')   keys.current.change = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
  return keys;
}

// ─── ASSETS ──────────────────────────────────────────────────────────────────
const Ground = () => {
  const [ref] = usePlane(() => ({ rotation: [-Math.PI / 2, 0, 0], position: [0, 0, 0] }));
  return (
    <mesh ref={ref} receiveShadow>
      <planeGeometry args={[1000, 1000]} />
      <meshStandardMaterial color="#f0d9b5" />
    </mesh>
  );
};

const MapObject = ({ filename, position, scale = 1, args }) => {
  const { scene } = useGLTF(`/models/map/${filename}`);
  const [ref] = useBox(() => ({ type: 'Static', position, args, mass: 0 }));
  
  useEffect(() => {
    scene.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [scene]);

  return (
    <mesh ref={ref}>
      <primitive object={scene} scale={scale} />
    </mesh>
  );
};

const Wheel = React.forwardRef(({ leftSide, folder = 'default' }, ref) => {
  const { scene } = useGLTF(
    folder === 'default' 
      ? '/models/car/default/wheel.glb' 
      : `/models/car/alternative/wheel2.glb`
  );
  
  const clonedScene = useMemo(() => {
    const clone = scene.clone();
    clone.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  return (
    <group ref={ref}>
      <primitive object={clonedScene} rotation-y={leftSide ? Math.PI : 0} scale={0.8} />
    </group>
  );
});

const Chassis = ({ folder }) => {
  const { scene } = useGLTF(
    folder === 'default' 
      ? '/models/car/default/chassis.glb' 
      : `/models/car/alternative/chassis2.glb`
  );
  
  useEffect(() => {
    scene.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [scene]);

  return <primitive object={scene} />;
};

const Car = ({ folder = 'default', lastPos, lastRot }) => {
  const controls = usePlayerControls();
  const { camera } = useThree();

  const [chassisRef, chassisApi] = useBox(() => ({
    args: [2, 1, 4.2],
    mass: 150,
    position: lastPos.current,
    rotation: lastRot.current,
    angularFactor: [0, 1, 0],
    allowSleep: false
  }));

  const wheelRef1 = useRef();
  const wheelRef2 = useRef();
  const wheelRef3 = useRef();
  const wheelRef4 = useRef();

  const wheelInfo = {
    radius: 0.7,
    directionLocal: [0, -1, 0],
    suspensionStiffness: 35,
    suspensionRestLength: 0.35,
    frictionSlip: 1.5,
    dampingRelaxation: 2.5,
    dampingCompression: 4.5,
    maxSuspensionForce: 100000,
    rollInfluence: 0.01,
    axleLocal: [-1, 0, 0],
    chassisConnectionPointLocal: [1, 0, 1],
    useCustomSlidingFriction: true,
    customSlidingFriction: 0.5,
  };

  const wheelInfo1 = { ...wheelInfo, chassisConnectionPointLocal: [-1, -0.2, 1.8], isFrontWheel: true };
  const wheelInfo2 = { ...wheelInfo, chassisConnectionPointLocal: [1, -0.2, 1.8], isFrontWheel: true };
  const wheelInfo3 = { ...wheelInfo, chassisConnectionPointLocal: [-1, -0.2, -1.2], isFrontWheel: false };
  const wheelInfo4 = { ...wheelInfo, chassisConnectionPointLocal: [1, -0.2, -1.2], isFrontWheel: false };

  const [vehicle, api] = useRaycastVehicle(() => ({
    chassisBody: chassisRef,
    wheels: [wheelRef1, wheelRef2, wheelRef3, wheelRef4],
    wheelInfos: [wheelInfo1, wheelInfo2, wheelInfo3, wheelInfo4],
  }));

  useFrame(() => {
    const { forward, backward, left, right, brake, reset, boost } = controls.current;
    const force = boost ? 400 : 250;
    const steer = 0.4;

    for (let i = 0; i < 2; i++) api.setSteeringValue(left ? steer : right ? -steer : 0, i);
    for (let i = 0; i < 4; i++) {
      api.applyEngineForce(forward ? -force : backward ? force : 0, i);
      api.setBrake(brake ? 30 : 0, i);
    }

    if (reset) {
      chassisApi.position.set(0, 1, 0);
      chassisApi.rotation.set(0, 0, 0);
      chassisApi.velocity.set(0, 0, 0);
    }

    if (chassisRef.current) {
      const pos = chassisRef.current.position;
      lastPos.current = [pos.x, pos.y, pos.z];
      lastRot.current = [0, chassisRef.current.rotation.y, 0];
      const offset = new THREE.Vector3(0, 5, 10).applyQuaternion(chassisRef.current.quaternion);
      camera.position.lerp(new THREE.Vector3(pos.x + offset.x, pos.y + offset.y, pos.z + offset.z), 0.1);
      camera.lookAt(pos.x, pos.y + 1, pos.z);
    }
  });

  return (
    <group ref={vehicle}>
      <group ref={chassisRef}>
        <Chassis folder={folder} />
      </group>
      <Wheel ref={wheelRef1} leftSide folder={folder} />
      <Wheel ref={wheelRef2} folder={folder} />
      <Wheel ref={wheelRef3} leftSide folder={folder} />
      <Wheel ref={wheelRef4} folder={folder} />
    </group>
  );
};

// ─── HELICOPTER ────────────────────────────────────────────────────────
const Helicopter = ({ lastPos, lastRot }) => {
  const controls = usePlayerControls();
  const { camera } = useThree();
  const [chassisRef, chassisApi] = useBox(() => ({
    args: [2, 1.5, 5],
    mass: 100,
    position: lastPos.current,
    rotation: lastRot.current,
    angularFactor: [0, 1, 0],
    linearDamping: 0.95,
    angularDamping: 0.95,
  }));

  const { scene: heliScene } = useGLTF('/models/car/helicopter/chassis.glb');
  const { scene: rotorMain } = useGLTF('/models/car/helicopter/rotor_main.glb');
  const { scene: rotorTail } = useGLTF('/models/car/helicopter/rotor_tail.glb');
  const mainRotorRef = useRef();
  const tailRotorRef = useRef();

  useFrame(() => {
    const { forward, backward, left, right, up, down } = controls.current;
    if (up) chassisApi.applyForce([0, 1200, 0], [0, 0, 0]);
    if (down) chassisApi.applyForce([0, -1200, 0], [0, 0, 0]);

    const direction = new THREE.Vector3(0, 0, forward ? -1 : backward ? 1 : 0).applyQuaternion(chassisRef.current.quaternion);
    chassisApi.applyForce([direction.x * 800, 0, direction.z * 800], [0, 0, 0]);

    if (left) chassisApi.angularVelocity.set(0, 2, 0);
    else if (right) chassisApi.angularVelocity.set(0, -2, 0);
    else chassisApi.angularVelocity.set(0, 0, 0);

    if (mainRotorRef.current) mainRotorRef.current.rotation.y += 0.5;
    if (tailRotorRef.current) tailRotorRef.current.rotation.x += 0.5;

    if (chassisRef.current) {
      const pos = chassisRef.current.position;
      const offset = new THREE.Vector3(0, 6, 15).applyQuaternion(chassisRef.current.quaternion);
      camera.position.lerp(new THREE.Vector3(pos.x + offset.x, pos.y + offset.y, pos.z + offset.z), 0.1);
      camera.lookAt(pos.x, pos.y, pos.z);
    }
  });

  return (
    <group ref={chassisRef}>
      <primitive object={heliScene} />
      <primitive ref={mainRotorRef} object={rotorMain} position={[0, 1.5, 0]} />
      <primitive ref={tailRotorRef} object={rotorTail} position={[0, 0.5, -2.5]} />
    </group>
  );
};

// ─── SHIP ────────────────────────────────────────────────────────
const Ship = ({ lastPos, lastRot }) => {
  const { scene } = useGLTF('/models/car/ship/chassis.glb');
  const keys = usePlayerControls();
  const { camera } = useThree();
  const [chassisRef, chassisApi] = useBox(() => ({
    args: [4, 2, 10],
    mass: 500,
    position: lastPos.current,
    rotation: lastRot.current,
    angularFactor: [0, 1, 0],
    linearDamping: 0.9,
    angularDamping: 0.9,
  }));

  useFrame(() => {
    const { forward, backward, left, right } = keys.current;
    if (forward) {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(chassisRef.current.quaternion);
      chassisApi.applyForce([dir.x * 5000, 0, dir.z * 5000], [0, 0, 0]);
    }
    if (left) chassisApi.angularVelocity.set(0, 5, 0);
    else if (right) chassisApi.angularVelocity.set(0, -5, 0);
    else chassisApi.angularVelocity.set(0, 0, 0);

    if (chassisRef.current) {
      const pos = chassisRef.current.position;
      const offset = new THREE.Vector3(0, 8, 20).applyQuaternion(chassisRef.current.quaternion);
      camera.position.lerp(new THREE.Vector3(pos.x + offset.x, pos.y + offset.y, pos.z + offset.z), 0.05);
      camera.lookAt(pos.x, pos.y + 2, pos.z);
    }
  });

  return <group ref={chassisRef}><primitive object={scene} scale={1.5} /></group>;
};

// ─── APP ─────────────────────────────────────────────────────────────────────
function Game({ vehicleFolder }) {
  const lastPos = useRef([0, 0.5, 0]);
  const lastRot = useRef([0, 0, 0]);
  return (
    <Physics gravity={[0, -9.81, 0]} defaultContactMaterial={{ friction: 0, restitution: 0.1 }}>
      {vehicleFolder === 'helicopter' ? (
        <Helicopter key="helicopter" lastPos={lastPos} lastRot={lastRot} />
      ) : vehicleFolder === 'ship' ? (
        <Ship key="ship" lastPos={lastPos} lastRot={lastRot} />
      ) : (
        <Car key={vehicleFolder} folder={vehicleFolder} lastPos={lastPos} lastRot={lastRot} />
      )}
      <Ground />
      <MapObject filename="house.glb" position={[10, 0, -20]} scale={1} args={[5, 10, 5]} />
    </Physics>
  );
}

export default function App() {
  const [vehicleFolder, setVehicleFolder] = useState('default');
  const [showMenu, setShowMenu] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [gold, setGold] = useState(5000);
  const [unlockedVehicles, setUnlockedVehicles] = useState(['default']);
  const [userName, setUserName] = useState('');
  const [userAvatar, setUserAvatar] = useState(null);
  const [showProfileSetup, setShowProfileSetup] = useState(true);

  const shopItems = [
    { id: 'default', name: 'Xe Đua Cơ Bản', price: 0, folder: 'default' },
    { id: 'police', name: 'Xe Cảnh Sát', price: 500, folder: 'police' },
    { id: 'helicopter', name: 'Trực Thăng Vũ Trụ', price: 1500, folder: 'helicopter' },
    { id: 'ship', name: 'Tàu Chiến Domixi', price: 1000, folder: 'ship' },
  ];

  const handleAvatarUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.size <= 2 * 1024 * 1024) {
      const reader = new FileReader();
      reader.onloadend = () => setUserAvatar(reader.result);
      reader.readAsDataURL(file);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {showProfileSetup && (
        <div className="setup-overlay">
          <div className="setup-card">
            <h2>THIẾT LẬP HỒ SƠ</h2>
            <div className="avatar-section">
              <div className="avatar-preview">{userAvatar ? <img src={userAvatar} alt="Avt" /> : '👤'}</div>
              <label className="upload-label"><input type="file" onChange={handleAvatarUpload} />📸 TẢI ẢNH</label>
            </div>
            <input className="name-input" placeholder="Tên của bạn..." value={userName} onChange={e => setUserName(e.target.value)} />
            <button className="start-btn" onClick={() => userName && setShowProfileSetup(false)}>BẮT ĐẦU ĐUA 🏁</button>
          </div>
        </div>
      )}

      <div className="hud">
        <div className="user-info">
          <div className="hud-avatar">{userAvatar ? <img src={userAvatar} alt="Avt" /> : '👤'}</div>
          <div className="hud-text"><span>{userName || 'Người Chơi'}</span><span>💰 {gold}</span></div>
        </div>
        <div className="hud-buttons">
          <button className="hud-btn" onClick={() => setShowShop(true)}>🛒 CỬA HÀNG</button>
          <button className="hud-btn" onClick={() => setShowMenu(true)}>🏎️ GA-RA</button>
        </div>
      </div>

      {showShop && (
        <div className="menu-overlay">
          <div className="menu-content">
            <h2>CỬA HÀNG</h2>
            <div className="items-grid">
              {shopItems.map(item => (
                <div key={item.id} className="shop-item">
                  <h3>{item.name}</h3>
                  <p>💰 {item.price}</p>
                  <button onClick={() => {
                    if (gold >= item.price && !unlockedVehicles.includes(item.folder)) {
                      setGold(gold - item.price);
                      setUnlockedVehicles([...unlockedVehicles, item.folder]);
                    }
                  }}>{unlockedVehicles.includes(item.folder) ? 'ĐÃ CÓ' : 'MUA'}</button>
                </div>
              ))}
            </div>
            <button onClick={() => setShowShop(false)}>ĐÓNG</button>
          </div>
        </div>
      )}

      {showMenu && (
        <div className="menu-overlay">
          <div className="menu-content">
            <h2>GA-RA</h2>
            {unlockedVehicles.map(v => (
              <button key={v} onClick={() => { setVehicleFolder(v); setShowMenu(false); }}>{v}</button>
            ))}
            <button onClick={() => setShowMenu(false)}>ĐÓNG</button>
          </div>
        </div>
      )}

      <Canvas shadows camera={{ position: [0, 5, 10], fov: 50 }}>
        <Sky sunPosition={[100, 20, 100]} />
        <Environment preset="park" />
        <ContactShadows resolution={1024} scale={20} blur={2} opacity={0.5} far={10} />
        <React.Suspense fallback={<Html center>🏗️ ĐANG NẠP...</Html>}>
          <Game vehicleFolder={vehicleFolder} />
        </React.Suspense>
        <Preload all />
      </Canvas>

      <style>{`
        .setup-overlay, .menu-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; z-index: 2000; color: white; }
        .setup-card, .menu-content { background: #161b22; padding: 30px; border-radius: 20px; text-align: center; border: 1px solid #30363d; }
        .avatar-preview { width: 100px; height: 100px; background: #0d1117; border-radius: 50%; margin: 10px auto; overflow: hidden; display: flex; justify-content: center; align-items: center; border: 2px solid #FF7A2F; }
        .avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
        .name-input { width: 100%; padding: 10px; margin: 10px 0; border-radius: 8px; border: 1px solid #30363d; background: #0d1117; color: white; }
        .start-btn { width: 100%; padding: 12px; background: #FF7A2F; border: none; border-radius: 10px; color: white; font-weight: bold; cursor: pointer; }
        .hud { position: absolute; top: 20px; left: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; }
        .user-info { background: rgba(0,0,0,0.7); padding: 10px; border-radius: 50px; display: flex; align-items: center; gap: 10px; color: white; border: 1px solid #FF7A2F; }
        .hud-avatar { width: 40px; height: 40px; background: #000; border-radius: 50%; overflow: hidden; }
        .hud-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .hud-btn { padding: 8px 15px; border-radius: 10px; border: none; background: #FF7A2F; color: white; font-weight: bold; cursor: pointer; }
        .items-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 20px; }
        .shop-item { background: #0d1117; padding: 15px; border-radius: 12px; border: 1px solid #30363d; }
      `}</style>
    </div>
  );
}
