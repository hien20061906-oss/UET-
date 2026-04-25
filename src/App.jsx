import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics, useBox, usePlane, useRaycastVehicle, useCylinder } from '@react-three/cannon';
import * as THREE from 'three';
import { useGLTF, Environment, ContactShadows, Preload, Sky } from '@react-three/drei';

// ─── CONTROLS ────────────────────────────────────────────────────────────────
function usePlayerControls(virtualKeys = {}) {
  const keys = useRef({ 
    forward: false, backward: false, left: false, right: false, 
    brake: false, reset: false, boost: false, change: false,
    up: false, down: false, yawLeft: false, yawRight: false 
  });

  // Đồng bộ phím ảo từ Mobile
  useEffect(() => {
    Object.keys(virtualKeys).forEach(k => {
      keys.current[k] = virtualKeys[k];
    });
  }, [virtualKeys]);

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

const WheelModel = ({ leftSide, folder = 'default', visible = true }) => {
  const wheelFile = folder === 'alternative' ? 'wheel2.glb' : 'wheel.glb';
  const { scene } = useGLTF(`/models/car/${folder}/${wheelFile}`);
  const copiedScene = React.useMemo(() => {
    const clone = scene.clone();
    
    // Cách 2 Nâng Cao: Tự động tính toán tâm thực sự bằng Box3 và bù trừ (offset) về [0,0,0]
    const box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    clone.position.sub(center); // dời mô hình ngược lại đúng bằng khoảng cách lệch tâm
    
    // Bọc vào group để lưới xoay quanh tâm mới
    const wrapper = new THREE.Group();
    wrapper.add(clone);
    return wrapper;
  }, [scene]);

  // Xoay bánh xe theo trục Y để quay mặt mâm bánh xe ra ngoài
  return <primitive object={copiedScene} visible={visible} rotation={[0, leftSide ? -Math.PI / 2 : Math.PI / 2, 0]} />;
};

const Wheel = React.forwardRef(({ radius = 0.25, width = 0.24, leftSide, folder = 'default', visible = true }, ref) => {
  useCylinder(() => ({
    mass: 5,
    type: 'Kinematic',
    material: 'wheel',
    collisionFilterGroup: 0,
    collisionFilterMask: 0,
    args: [radius, radius, width, 16],
  }), ref);

  return (
    <mesh ref={ref}>
      <React.Suspense fallback={null}>
        <WheelModel leftSide={leftSide} folder={folder} visible={visible} />
      </React.Suspense>
    </mesh>
  );
});

const Car = ({ folder = 'default', lastPos, lastRot, virtualKeys }) => {
  const chassisRef = useRef();
  const controls = usePlayerControls(virtualKeys);
  const lastChange = useRef(false);
  const { camera } = useThree();

  // --- Physics chassis  ---
  const chassisWidth = 0.8;
  const chassisHeight = 0.5;
  const chassisDepth = 2.03;

  const [chassisRef, chassisApi] = useBox(() => ({
    mass: 150,
    position: lastPos.current,
    rotation: lastRot.current,
    velocity: [0, 0, 0], 
    angularVelocity: [0, 0, 0], 
    args: [chassisWidth, chassisHeight, chassisDepth],
    allowSleep: true,
    linearDamping: 0.15,
    angularDamping: 0.3,
  }));

  // Đăng ký theo dõi tọa độ trực tiếp từ lõi vật lý (Chính xác nhất)
  useEffect(() => {
    const unsubPos = chassisApi.position.subscribe(v => { lastPos.current = v; });
    const unsubRot = chassisApi.rotation.subscribe(v => { lastRot.current = v; });
    return () => { unsubPos(); unsubRot(); };
  }, [chassisApi, lastPos, lastRot]);

  // --- Wheel setup (G10 chuẩn) ---
  const wheelRadius = 0.25;
  const wheelHeight  = 0.24;

  const wInfo = useMemo(() => ({
    radius: wheelRadius,
    directionLocal: [0, -1, 0],
    suspensionStiffness: 60,
    suspensionRestLength: 0.35,
    maxSuspensionForce: 100000,
    maxSuspensionTravel: 0.3,
    dampingRelaxation: 2.3,
    dampingCompression: 4.4,
    frictionSlip: 1.5,
    rollInfluence: 0.0, // Đặt bằng 0 để triệt tiêu hoàn toàn lực lật thân xe
    axleLocal: [-1, 0, 0],
    useCustomSlidingRotationalSpeed: true,
    customSlidingRotationalSpeed: -30
  }), []);

  // Bảng cấu hình vị trí bánh xe và thân xe cho từng loại xe
  const vehicleConfigs = {
    default: {
      front: -0.55,
      back: 0.55,
      width: 0.55,
      wheelY: 0,
      chassisY: -0.25
    },
    alternative: {
      front: -0.82,
      back: 0.82,
      width: 0.4,
      wheelY: -0.1,
      chassisY: -0.25
    }
  };

  const config = vehicleConfigs[folder] || vehicleConfigs.default;
  const { front: frontOffset, back: backOffset, width: offsetWidth, wheelY, chassisY } = config;

  const wheelInfos = useMemo(() => [
    { ...wInfo, chassisConnectionPointLocal: [-offsetWidth, wheelY, frontOffset], isFrontWheel: true,  frictionSlip: 1.5 },
    { ...wInfo, chassisConnectionPointLocal: [ offsetWidth, wheelY, frontOffset], isFrontWheel: true,  frictionSlip: 1.5 },
    { ...wInfo, chassisConnectionPointLocal: [-offsetWidth, wheelY, backOffset ], isFrontWheel: false, frictionSlip: 1.5 },
    { ...wInfo, chassisConnectionPointLocal: [ offsetWidth, wheelY, backOffset ], isFrontWheel: false, frictionSlip: 1.5 },
  ], [wInfo, folder, frontOffset, backOffset, offsetWidth, wheelY]);

  const wheel0 = useRef(null);
  const wheel1 = useRef(null);
  const wheel2 = useRef(null);
  const wheel3 = useRef(null);
  const firstFrame = useRef(true); // <--- Chuyển lên đây cho đúng luật React hooks

  const [vehicle, vehicleApi] = useRaycastVehicle(() => ({
    chassisBody: chassisRef,
    wheelInfos,
    wheels: [wheel0, wheel1, wheel2, wheel3],
    indexForwardAxis: 2,
    indexRightAxis:   0,
    indexUpAxis:      1,
  }));

  // --- Models ---
  const modelFolder = folder;
  const chassisFile = folder === 'alternative' ? 'chassis2.glb' : 'chassis.glb';
  const { scene: chassisScene } = useGLTF(`/models/car/${modelFolder}/${chassisFile}`);


  // Steering state
  const currentSteering = useRef(0);

  const smoothRot = useRef(0);
  const isBraking = useRef(false); // Trạng thái phanh để tối ưu hóa damping

  // --- Camera state ---
  const camPos    = useRef(new THREE.Vector3(0, 5, 10));
  const camTarget = useRef(new THREE.Vector3());

  // --- Mouse camera control ---
  const camAngle = useRef({ x: 0, y: 0.35, dist: 7 });
  useEffect(() => {
    let middleDown = false;
    const onWheel = (e) => {
      camAngle.current.dist = Math.max(3, Math.min(25, camAngle.current.dist + e.deltaY * 0.01));
    };
    const onDown  = (e) => { if (e.button === 1) middleDown = true;  };
    const onUp    = (e) => { if (e.button === 1) middleDown = false; };
    const onMove  = (e) => {
      if (!middleDown) return;
      camAngle.current.x -= e.movementX * 0.005;
      camAngle.current.y  = Math.max(0.05, Math.min(Math.PI / 2.2, camAngle.current.y + e.movementY * 0.005));
    };
    window.addEventListener('wheel',       onWheel);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup',   onUp);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('wheel',       onWheel);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup',   onUp);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  // ─── MAIN LOOP ───────────────────────────────────────────────────────────
  useFrame((_, delta) => {
    const { forward, backward, left, right, brake, reset, boost, change } = controls.current;
    
    const dt = Math.min(delta, 0.05); // clamp delta để tránh spike lag

    // Chống bốc đầu triệt để đã bị xoá vì gây lỗi không chạy được

    // Reset xe
    if (reset && chassisRef.current) {
      chassisApi.position.set(chassisRef.current.position.x, chassisRef.current.position.y + 0.5, chassisRef.current.position.z);
      chassisApi.velocity.set(0, 0, 0);
      chassisApi.angularVelocity.set(0, 0, 0);
      chassisApi.rotation.set(0, chassisRef.current.rotation.y, 0);
    }

    // G10 chuẩn - điều chỉnh để có thể quay xe (donuts)
    const engineForce = boost ? 900 : 500; // Tăng mạnh lực máy khi giữ Shift (boost)
    const maxSteerVal = Math.PI * 0.25; // Trả góc đánh lái về 45 độ cho tự nhiên, 90 độ quá ảo
    const steerSpeed = delta * 12; // Tốc độ xoay vô lăng nhanh hơn

    // Steering làm mượt
    if (left) {
      currentSteering.current += steerSpeed;
    } else if (right) {
      currentSteering.current -= steerSpeed;
    } else {
      if (Math.abs(currentSteering.current) > steerSpeed) {
        currentSteering.current -= steerSpeed * Math.sign(currentSteering.current);
      } else {
        currentSteering.current = 0;
      }
    }

    if (Math.abs(currentSteering.current) > maxSteerVal) {
      currentSteering.current = Math.sign(currentSteering.current) * maxSteerVal;
    }

    vehicleApi.setSteeringValue(currentSteering.current, 0);
    vehicleApi.setSteeringValue(currentSteering.current, 1);

    // Engine
    if (forward) {
      vehicleApi.applyEngineForce(engineForce, 2);
      vehicleApi.applyEngineForce(engineForce, 3);
      // Chống bốc đầu (Wheelie) khi tăng tốc bằng cách ghì mũi xe xuống
      chassisApi.applyLocalForce([0, -500, 0], [0, 0, -0.55]);
    } else if (backward) {
      vehicleApi.applyEngineForce(-engineForce, 2);
      vehicleApi.applyEngineForce(-engineForce, 3);
    } else {
      vehicleApi.applyEngineForce(0, 2);
      vehicleApi.applyEngineForce(0, 3);
    }

    // Logic Phanh tối ưu để tránh rung lắc
    if (brake !== isBraking.current) {
      isBraking.current = brake;
      if (brake) {
        chassisApi.linearDamping.set(0.95);  // Tăng lên 0.95 để phanh "ăn" hơn, dừng nhanh hơn
        chassisApi.angularDamping.set(1.0); // KHÓA CHẾT XOAY: Tuyệt đối không cho xe chúi đầu hay rung lắc
      } else {
        chassisApi.linearDamping.set(0.15);
        chassisApi.angularDamping.set(0.3);
      }
    }

    if (brake) {
      // Không dùng phanh bánh xe để tránh làm lò xo bị nén gây chúi đầu
      vehicleApi.setBrake(0, 0);
      vehicleApi.setBrake(0, 1);
      vehicleApi.setBrake(0, 2);
      vehicleApi.setBrake(0, 3);
    } else if (!forward && !backward) {
      // Tự động phanh (Engine Brake) CHỈ bánh sau để chống lật đít khi nhả ga
      const autoBrake = 15; 
      vehicleApi.setBrake(0, 0);
      vehicleApi.setBrake(0, 1);
      vehicleApi.setBrake(autoBrake, 2);
      vehicleApi.setBrake(autoBrake, 3);
    } else {
      vehicleApi.setBrake(0, 0);
      vehicleApi.setBrake(0, 1);
      vehicleApi.setBrake(0, 2);
      vehicleApi.setBrake(0, 3);
    }

    // ─── CAMERA ──────────────────────────────────────────────────────────
    if (!chassisRef.current) return;

    const currentPosition = new THREE.Vector3();
    chassisRef.current.getWorldPosition(currentPosition);
    const rawRot = chassisRef.current.rotation.y;

    // Làm mượt góc xoay để chống giật
    let diff = rawRot - smoothRot.current;
    diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
    
    // Nếu là khung hình đầu tiên của xe mới, cho camera nhảy thẳng đến vị trí chuẩn
    if (firstFrame.current) {
      smoothRot.current = rawRot;
      firstFrame.current = false;
    } else {
      smoothRot.current += diff * (1 - Math.exp(-20 * dt));
    }
    
    const dist = camAngle.current.dist;
    const ax = camAngle.current.x;
    const ay = camAngle.current.y;
    
    const horizontalDist = Math.cos(ay) * dist;
    const offsetX = Math.sin(ax) * horizontalDist;
    const offsetY = Math.sin(ay) * dist;
    const offsetZ = Math.cos(ax) * horizontalDist;
    
    const idealOffset = new THREE.Vector3(offsetX, offsetY, offsetZ);
    idealOffset.applyEuler(new THREE.Euler(0, smoothRot.current, 0));
    
    // Khóa cứng Camera (copy) để triệt tiêu hiện tượng nhòe/bóng ma khi chạy nhanh
    camera.position.copy(currentPosition).add(idealOffset);
    
    const lookAtPos = currentPosition.clone().add(new THREE.Vector3(0, 0, -2).applyEuler(new THREE.Euler(0, smoothRot.current, 0)));
    camera.lookAt(lookAtPos);
  });

  return (
    <group ref={vehicle}>
      <mesh key={folder} ref={chassisRef} castShadow>
        <meshStandardMaterial visible={false} />
        <group position={[0, chassisY, 0]} rotation={[0, Math.PI / 2, 0]}>
          <primitive object={chassisScene} />
        </group>
      </mesh>

      <Wheel key={`${folder}-0`} ref={wheel0} radius={wheelRadius} width={wheelHeight} leftSide={true}  folder={folder} visible={folder !== 'ship'} />
      <Wheel key={`${folder}-1`} ref={wheel1} radius={wheelRadius} width={wheelHeight} leftSide={false} folder={folder} visible={folder !== 'ship'} />
      <Wheel key={`${folder}-2`} ref={wheel2} radius={wheelRadius} width={wheelHeight} leftSide={true}  folder={folder} visible={folder !== 'ship'} />
      <Wheel key={`${folder}-3`} ref={wheel3} radius={wheelRadius} width={wheelHeight} leftSide={false} folder={folder} visible={folder !== 'ship'} />
    </group>
  );
};

// ─── GROUND ──────────────────────────────────────────────────────────────────
const Ground = () => {
  const [ref] = usePlane(() => ({ rotation: [-Math.PI / 2, 0, 0], position: [0, 0, 0] }));
  return (
    <mesh ref={ref} receiveShadow>
      <planeGeometry args={[2000, 2000]} />
      <meshStandardMaterial color="#FF7A2F" roughness={1} metalness={0} />
    </mesh>
  );
};

// Component phụ để tải và điều khiển cánh quạt từ file riêng
const PropellerModel = ({ url, axis = 'y', position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, offset = [0, 0, 0] }) => {
  const { nodes } = useGLTF(url);
  const rotRef = useRef();
  
  // Trích xuất và căn tâm trực tiếp các mesh từ file GLTF để đảm bảo hiển thị 100%
  const meshes = React.useMemo(() => {
    const list = [];
    Object.values(nodes).forEach(node => {
      if (node.isMesh) {
        // Clone và căn tâm hình học cho geometry để xoay đúng trục
        const geom = node.geometry.clone();
        geom.center(); 
        // Cho phép nhích tâm xoay thủ công nếu cần
        geom.translate(offset[0], offset[1], offset[2]);
        list.push({ geometry: geom, material: node.material });
      }
    });
    return list;
  }, [nodes, offset]);

  const keys = usePlayerControls();
  const speedRef = useRef(0);

  useFrame((_, delta) => {
    // Nội suy tốc độ để tạo hiệu ứng khởi động và dừng lại mượt mà
    const targetSpeed = keys.current.up ? 50 : 0;
    const lerpFactor = keys.current.up ? 0.05 : 0.005;
    speedRef.current = THREE.MathUtils.lerp(speedRef.current, targetSpeed, lerpFactor);

    if (rotRef.current && speedRef.current > 0.1) {
      rotRef.current.rotation[axis] += delta * speedRef.current;
    }
  });

  return (
    <group position={position} rotation={rotation}>
      <group ref={rotRef}>
        {/* Vẽ trực tiếp từng mesh bằng tag <mesh> tiêu chuẩn của R3F */}
        {meshes.map((m, i) => (
          <mesh key={i} geometry={m.geometry} material={m.material} scale={scale} />
        ))}
      </group>
    </group>
  );
};

const Propeller = (props) => (
  <React.Suspense fallback={
    <mesh position={props.position} rotation={props.rotation}>
      <boxGeometry args={[1, 0.05, 1]} />
      <meshStandardMaterial color="red" wireframe />
    </mesh>
  }>
    <PropellerModel {...props} />
  </React.Suspense>
);

// ─── HELICOPTER ────────────────────────────────────────────────────────
const Helicopter = ({ lastPos, lastRot, virtualKeys }) => {
  const controls = usePlayerControls(virtualKeys);
  const { camera } = useThree();
  const firstFrame = useRef(true);
  const smoothRot = useRef(0);
  const camAngle = useRef({ x: 0, y: 0.35, dist: 8 });

  useEffect(() => {
    let middleDown = false;
    const onWheel = (e) => {
      camAngle.current.dist = Math.max(3, Math.min(30, camAngle.current.dist + e.deltaY * 0.01));
    };
    const onDown  = (e) => { if (e.button === 1) middleDown = true;  };
    const onUp    = (e) => { if (e.button === 1) middleDown = false; };
    const onMove  = (e) => {
      if (!middleDown) return;
      camAngle.current.x -= e.movementX * 0.005;
      camAngle.current.y  = Math.max(0.05, Math.min(Math.PI / 2.2, camAngle.current.y + e.movementY * 0.005));
    };
    window.addEventListener('wheel',       onWheel);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup',   onUp);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('wheel',       onWheel);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup',   onUp);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  const [ref, api] = useBox(() => ({
    mass: 500,
    position: lastPos.current,
    rotation: lastRot.current,
    args: [1, 1, 3],
    linearDamping: 0.8, 
    angularDamping: 0.95,
    angularFactor: [0, 1, 0] // Khóa trục X và Z để máy bay luôn thăng bằng, không bị nghiêng
  }));

  // Theo dõi tọa độ
  useEffect(() => {
    const unsubPos = api.position.subscribe(v => { lastPos.current = v; });
    const unsubRot = api.rotation.subscribe(v => { lastRot.current = v; });
    return () => { unsubPos(); unsubRot(); };
  }, [api, lastPos, lastRot]);

  const { scene } = useGLTF('/models/car/helicopter/chassis.glb');
  
  useFrame((state, delta) => {
    const { forward, backward, left, right, up, down, yawLeft, yawRight } = controls.current;
    const dt = Math.min(delta, 0.05);

    // Lực bay
    const liftForce = 12000;
    const moveForce = 5000;
    const torque = 1000;

    if (up) {
      api.linearDamping.set(0.99);
      api.applyLocalForce([0, liftForce, 0], [0, 0, 0]);
    } else {
      api.linearDamping.set(0.8);
    }
    if (down) api.applyLocalForce([0, -liftForce, 0], [0, 0, 0]);
    
    if (forward) api.applyLocalForce([0, 0, -moveForce], [0, 0, 0]);
    if (backward) api.applyLocalForce([0, 0, moveForce], [0, 0, 0]);
    
    // Q/E để xoay (Yaw)
    if (yawLeft) api.applyTorque([0, torque, 0]);
    if (yawRight) api.applyTorque([0, -torque, 0]);

    // Camera
    if (!ref.current) return;
    const currentPosition = new THREE.Vector3();
    ref.current.getWorldPosition(currentPosition);
    const rawRot = ref.current.rotation.y;

    const dist = camAngle.current.dist;
    const ax = camAngle.current.x;
    const ay = camAngle.current.y;
    
    const horizontalDist = Math.cos(ay) * dist;
    const offsetX = Math.sin(ax) * horizontalDist;
    const offsetY = Math.sin(ay) * dist;
    const offsetZ = Math.cos(ax) * horizontalDist;
    
    const idealOffset = new THREE.Vector3(offsetX, offsetY, offsetZ);
    idealOffset.applyEuler(new THREE.Euler(0, rawRot, 0));
    state.camera.position.copy(currentPosition).add(idealOffset);
    
    const lookAtPos = currentPosition.clone().add(new THREE.Vector3(0, 0, -2).applyEuler(new THREE.Euler(0, rawRot, 0)));
    state.camera.lookAt(lookAtPos);
  });

  return (
    <group ref={ref}>
      <React.Suspense fallback={<mesh><boxGeometry args={[1, 1, 3]} /><meshStandardMaterial color="gray" /></mesh>}>
        <primitive object={scene} />
      </React.Suspense>
      {/* Tải cánh quạt từ các file riêng biệt */}
      <Propeller url="/models/car/helicopter/rotor_main.glb" axis="y" position={[-0.009, 0.75, 0.01]} scale={0.01} />
      <Propeller url="/models/car/helicopter/rotor_tail.glb" axis="y" position={[-0.13, 0.83, 1.59]} scale={0.002} rotation={[0, 0, Math.PI / 2]} offset={[0, 0, 0]} />
    </group>
  );
};

// --- NEW SHIP COMPONENT (FROM SCRATCH) ---
const Ship = ({ lastPos, lastRot, virtualKeys }) => {
  const { scene } = useGLTF('/models/car/ship/chassis.glb');
  const keys = usePlayerControls(virtualKeys);
  const { camera, gl } = useThree();
  const smoothRot = useRef(0);
  const camAngle = useRef({ x: 0, y: Math.PI / 8, dist: 18 });
  const firstFrame = useRef(true);

  const [ref, api] = useBox(() => ({
    mass: 1000,
    position: lastPos.current,
    rotation: lastRot.current,
    angularDamping: 0.99,
    linearDamping: 0.8,
    angularFactor: [0, 1, 0],
  }));

  useEffect(() => {
    const move = (e) => {
      if (document.pointerLockElement) {
        camAngle.current.x -= e.movementX * 0.002;
        camAngle.current.y = Math.max(0.05, Math.min(Math.PI / 2.5, camAngle.current.y + e.movementY * 0.002));
      }
    };
    const wheel = (e) => {
      camAngle.current.dist = Math.max(8, Math.min(40, camAngle.current.dist + e.deltaY * 0.01));
    };
    const down = (e) => {
      if (e.button === 1) { // Middle mouse down
        gl.domElement.requestPointerLock();
      }
    };
    const up = (e) => {
      if (e.button === 1) { // Middle mouse up
        if (document.pointerLockElement) document.exitPointerLock();
      }
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('mousemove', move);
    window.addEventListener('wheel', wheel);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('wheel', wheel);
    };
  }, [gl]);

  useFrame((state, delta) => {
    if (!ref.current) return;
    const { forward, backward, left, right, yawLeft, yawRight } = keys.current;
    const moveForce = 4000;
    const torque = 1200;

    if (forward) api.applyLocalForce([0, 0, -moveForce], [0, 0, 0]);
    if (backward) api.applyLocalForce([0, 0, moveForce], [0, 0, 0]);
    if (left || yawLeft) api.applyTorque([0, torque, 0]);
    if (right || yawRight) api.applyTorque([0, -torque, 0]);

    // --- CAMERA LOGIC (PROFESSIONAL) ---
    const currentPosition = new THREE.Vector3();
    ref.current.getWorldPosition(currentPosition);
    const rawRot = ref.current.rotation.y;

    // Làm mượt góc xoay
    let diff = rawRot - smoothRot.current;
    diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
    
    if (firstFrame.current) {
      smoothRot.current = rawRot;
      firstFrame.current = false;
    } else {
      smoothRot.current += diff * (1 - Math.exp(-20 * delta));
    }

    const dist = camAngle.current.dist;
    const ax = camAngle.current.x;
    const ay = camAngle.current.y;
    
    const horizontalDist = Math.cos(ay) * dist;
    const offsetX = Math.sin(ax) * horizontalDist;
    const offsetY = Math.sin(ay) * dist;
    const offsetZ = Math.cos(ax) * horizontalDist;
    
    const idealOffset = new THREE.Vector3(offsetX, offsetY, offsetZ);
    idealOffset.applyEuler(new THREE.Euler(0, smoothRot.current, 0));
    
    // Khóa cứng camera để tránh nhòe hình
    camera.position.copy(currentPosition).add(idealOffset);
    
    const lookAtPos = currentPosition.clone().add(new THREE.Vector3(0, 1, -2).applyEuler(new THREE.Euler(0, smoothRot.current, 0)));
    camera.lookAt(lookAtPos);
  });

  return (
    <group ref={ref}>
      <React.Suspense fallback={<mesh><boxGeometry args={[2, 1, 5]} /><meshStandardMaterial color="blue" /></mesh>}>
        <primitive object={scene} />
      </React.Suspense>
    </group>
  );
};

// ─── MAP OBJECT ──────────────────────────────────────────────────────────────
const MapObject = ({ filename, position, args = [2, 2, 2], scale = 1, rotation = [0, 0, 0] }) => {
  const { scene } = useGLTF(`/models/map/${filename}`);
  const [ref] = useBox(() => ({ type: 'Static', position, args, rotation }));
  
  // Tối ưu hóa: Bật đổ bóng cho toàn bộ mesh trong mô hình map
  React.useMemo(() => {
    scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [scene]);

  return <primitive ref={ref} object={scene.clone()} scale={scale} />;
};

// ─── APP ─────────────────────────────────────────────────────────────────────
function Game({ vehicleFolder, setVehicleFolder, virtualKeys }) {
  const controls = usePlayerControls(virtualKeys);
  const lastChange = useRef(false);
  
  const lastPos = useRef([0, 0.5, 0]);
  const lastRot = useRef([0, 0, 0]);

  return (
    <Physics gravity={[0, -9.81, 0]} defaultContactMaterial={{ friction: 0, restitution: 0.1 }}>
      {vehicleFolder === 'helicopter' ? (
        <Helicopter key="helicopter" lastPos={lastPos} lastRot={lastRot} />
      ) : vehicleFolder === 'ship' ? (
        <Ship key="ship" lastPos={lastPos} lastRot={lastRot} />
      ) : (
        <Car 
          key={vehicleFolder} 
          folder={vehicleFolder} 
          lastPos={lastPos} 
          lastRot={lastRot}
          virtualKeys={virtualKeys}
        />
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
  
  // Điều khiển Mobile
  const [virtualKeys, setVirtualKeys] = useState({
    forward: false, backward: false, left: false, right: false,
    brake: false, up: false, down: false, yawLeft: false, yawRight: false
  });

  const updateVirtualKey = (key, value) => {
    setVirtualKeys(prev => ({ ...prev, [key]: value }));
  };

  // Hệ thống vàng và xe đã mở khóa
  const [gold, setGold] = useState(5000); // Tặng 5000 vàng khởi đầu
  const [unlockedVehicles, setUnlockedVehicles] = useState(['default']);
  
  // Hệ thống hồ sơ người chơi
  const [userName, setUserName] = useState('Người Chơi 1');
  const [userAvatar, setUserAvatar] = useState('👤');
  const [showProfile, setShowProfile] = useState(true); // Hiện luôn khi vào game

  const handleAvatarUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('Ảnh quá lớn! Vui lòng chọn ảnh dưới 2MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setUserAvatar(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const avatars = ['👤', '🏎️', '🚓', '🚁', '🚢', '🚀', '🐱', '🐶', '🔥', '⚡'];

  const vehiclePrices = {
    alternative: 500,
    helicopter: 1500,
    ship: 1000
  };

  const buyVehicle = (type) => {
    const price = vehiclePrices[type];
    if (gold >= price) {
      setGold(prev => prev - price);
      setUnlockedVehicles(prev => [...prev, type]);
      alert(`Chúc mừng! Bạn đã mở khóa ${type === 'helicopter' ? 'Máy Bay' : type === 'ship' ? 'Tàu Thủy' : 'Xe Cảnh Sát'}!`);
    } else {
      alert('Bạn không đủ vàng!');
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#FF7A2F', margin: 0, padding: 0, overflow: 'hidden', position: 'relative', fontFamily: 'Arial, sans-serif' }}>
      <style>{`
        * { margin:0; padding:0; box-sizing:border-box; }
        body { overflow:hidden; }
        
        .top-ui {
          position: absolute;
          top: 20px;
          left: 20px;
          display: flex;
          align-items: center;
          gap: 15px;
          z-index: 100;
        }

        .user-profile-hud {
          background: rgba(0, 0, 0, 0.7);
          padding: 8px 20px 8px 8px;
          border-radius: 50px;
          display: flex;
          align-items: center;
          gap: 12px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          cursor: pointer;
          transition: all 0.3s;
          backdrop-filter: blur(10px);
        }
        .user-profile-hud:hover { background: rgba(0, 0, 0, 0.8); transform: scale(1.02); }
        
        .hud-avatar {
          width: 42px;
          height: 42px;
          background: #333;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          border: 2px solid #FF7A2F;
          overflow: hidden;
        }
        .hud-avatar img { width: 100%; height: 100%; object-fit: cover; }

        .hud-info { display: flex; flex-direction: column; }
        .hud-name { color: white; font-weight: bold; font-size: 14px; }
        .hud-gold { color: #FFD700; font-size: 12px; font-weight: bold; }

        .menu-button, .shop-button {
          padding: 12px 24px;
          background: rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: white;
          border-radius: 12px;
          cursor: pointer;
          font-weight: bold;
          transition: all 0.3s;
        }

        .menu-button:hover, .shop-button:hover {
          background: rgba(255, 255, 255, 0.3);
          transform: translateY(-2px);
        }

        .shop-button { background: rgba(255, 122, 47, 0.5); border-color: #FF7A2F; }

        .overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.85);
          display: none;
          justify-content: center;
          align-items: center;
          z-index: 1000;
          backdrop-filter: blur(8px);
        }
        
        .overlay.active { display: flex; }
        
        .menu-card {
          background: #111;
          padding: 40px;
          border-radius: 32px;
          text-align: center;
          max-width: 600px;
          width: 95%;
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
        }

        .menu-card h2 { color: white; margin-bottom: 25px; font-size: 28px; text-transform: uppercase; }
        
        .profile-edit-input {
          width: 100%;
          padding: 15px;
          background: #222;
          border: 2px solid #333;
          border-radius: 12px;
          color: white;
          font-size: 18px;
          margin-bottom: 25px;
          text-align: center;
        }
        .profile-edit-input:focus { border-color: #FF7A2F; outline: none; }

        .avatar-preview-large {
          width: 100px;
          height: 100px;
          background: #222;
          border-radius: 50%;
          margin: 0 auto 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 50px;
          border: 3px solid #FF7A2F;
          overflow: hidden;
          cursor: pointer;
          position: relative;
        }
        .avatar-preview-large img { width: 100%; height: 100%; object-fit: cover; }
        .avatar-preview-large::after {
          content: '📷';
          position: absolute;
          bottom: 0;
          right: 0;
          background: #FF7A2F;
          font-size: 14px;
          padding: 5px;
          border-radius: 50%;
        }

        .avatar-selector {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }
        .avatar-item {
          font-size: 32px;
          padding: 10px;
          background: #222;
          border-radius: 12px;
          cursor: pointer;
          transition: 0.2s;
          border: 2px solid transparent;
        }
        .avatar-item:hover { transform: scale(1.1); background: #333; }
        .avatar-item.selected { border-color: #FF7A2F; background: #332211; }

        .upload-hint { color: #888; font-size: 12px; margin-bottom: 20px; }

        .vehicle-options {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 15px;
          margin-bottom: 30px;
        }
        
        .vehicle-option {
          background: #222;
          padding: 20px;
          border-radius: 24px;
          cursor: pointer;
          transition: all 0.3s;
          border: 2px solid transparent;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .vehicle-option:hover { background: #2a2a2a; transform: translateY(-5px); }
        .vehicle-option.selected { border-color: #FF7A2F; background: #332211; }
        
        .vehicle-icon { font-size: 40px; margin-bottom: 10px; }
        .vehicle-option h3 { color: white; font-size: 14px; margin: 0; }
        .price-tag { color: #FFD700; font-weight: bold; margin-top: 10px; font-size: 14px; }

        .buy-btn, .save-btn {
          margin-top: 15px;
          padding: 12px 25px;
          background: #FF7A2F;
          border: none;
          color: white;
          border-radius: 12px;
          cursor: pointer;
          font-weight: bold;
          width: 100%;
        }

        .close-btn {
          padding: 12px 40px;
          background: #333;
          border: none;
          color: white;
          border-radius: 12px;
          cursor: pointer;
          font-weight: bold;
        }
      `}</style>

      {/* Top HUD */}
      <div className="top-ui">
        <div className="user-profile-hud" onClick={() => setShowProfile(true)}>
          <div className="hud-avatar">
            {userAvatar.length > 5 ? <img src={userAvatar} alt="avatar" /> : userAvatar}
          </div>
          <div className="hud-info">
            <span className="hud-name">{userName}</span>
            <span className="hud-gold">💰 {gold.toLocaleString()}</span>
          </div>
        </div>
        <button className="menu-button" onClick={() => setShowMenu(true)}>Ga-ra</button>
        <button className="shop-button" onClick={() => setShowShop(true)}>Shop 🛒</button>
      </div>

      {/* Profile Edit Overlay */}
      <div className={`overlay ${showProfile ? 'active' : ''}`}>
        <div className="menu-card">
          <h2 style={{color: '#FF7A2F'}}>Thiết Lập Hồ Sơ</h2>
          <p style={{color: '#888', marginBottom: '20px'}}>Chào mừng bạn! Hãy đặt tên và chọn ảnh để bắt đầu</p>
          
          <div className="avatar-preview-large" onClick={() => document.getElementById('avatar-input').click()}>
            {userAvatar.length > 5 ? <img src={userAvatar} alt="avatar" /> : userAvatar}
          </div>
          
          <button 
            className="buy-btn" 
            style={{width: 'auto', marginBottom: '10px', background: '#333'}}
            onClick={() => document.getElementById('avatar-input').click()}
          >
            📁 TẢI ẢNH TỪ MÁY TÍNH
          </button>

          <input 
            id="avatar-input"
            type="file" 
            accept="image/*" 
            style={{display: 'none'}} 
            onChange={handleAvatarUpload}
          />
          <p className="upload-hint">Hoặc chọn một biểu tượng bên dưới</p>

          <input 
            className="profile-edit-input"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Nhập tên của bạn..."
            maxLength={20}
          />
          <div className="avatar-selector">
            {avatars.map(a => (
              <div 
                key={a} 
                className={`avatar-item ${userAvatar === a ? 'selected' : ''}`}
                onClick={() => setUserAvatar(a)}
              >
                {a}
              </div>
            ))}
          </div>
          <button className="save-btn" onClick={() => setShowProfile(false)} style={{fontSize: '18px'}}>
            BẮT ĐẦU ĐUA 🏁
          </button>
        </div>
      </div>

      {/* Ga-ra Overlay */}
      <div className={`overlay ${showMenu ? 'active' : ''}`}>
        <div className="menu-card">
          <h2>Xe Đã Sở Hữu</h2>
          <div className="vehicle-options">
            <div 
              className={`vehicle-option ${vehicleFolder === 'default' ? 'selected' : ''}`}
              onClick={() => { setVehicleFolder('default'); setShowMenu(false); }}
            >
              <span className="vehicle-icon">🏎️</span>
              <h3>Xe Mặc Định</h3>
            </div>
            
            {unlockedVehicles.includes('alternative') && (
              <div 
                className={`vehicle-option ${vehicleFolder === 'alternative' ? 'selected' : ''}`}
                onClick={() => { setVehicleFolder('alternative'); setShowMenu(false); }}
              >
                <span className="vehicle-icon">🚓</span>
                <h3>Xe Cảnh Sát</h3>
              </div>
            )}

            {unlockedVehicles.includes('helicopter') && (
              <div 
                className={`vehicle-option ${vehicleFolder === 'helicopter' ? 'selected' : ''}`}
                onClick={() => { setVehicleFolder('helicopter'); setShowMenu(false); }}
              >
                <span className="vehicle-icon">🚁</span>
                <h3>Máy Bay</h3>
              </div>
            )}

            {unlockedVehicles.includes('ship') && (
              <div 
                className={`vehicle-option ${vehicleFolder === 'ship' ? 'selected' : ''}`}
                onClick={() => { setVehicleFolder('ship'); setShowMenu(false); }}
              >
                <span className="vehicle-icon">🚢</span>
                <h3>Tàu Thủy</h3>
              </div>
            )}
          </div>
          <button className="close-btn" onClick={() => setShowMenu(false)}>ĐÓNG</button>
        </div>
      </div>

      {/* Shop Overlay */}
      <div className={`overlay ${showShop ? 'active' : ''}`}>
        <div className="menu-card">
          <h2>Cửa Hàng Siêu Xe</h2>
          <div className="vehicle-options">
            <div className="vehicle-option">
              <span className="vehicle-icon">🚓</span>
              <h3>Xe Cảnh Sát</h3>
              <span className="price-tag">💰 500</span>
              {!unlockedVehicles.includes('alternative') ? (
                <button className="buy-btn" onClick={() => buyVehicle('alternative')}>MUA</button>
              ) : (
                <span style={{color: '#4caf50', marginTop: '15px', fontWeight: 'bold'}}>SỞ HỮU</span>
              )}
            </div>

            <div className="vehicle-option">
              <span className="vehicle-icon">🚁</span>
              <h3>Máy Bay</h3>
              <span className="price-tag">💰 1500</span>
              {!unlockedVehicles.includes('helicopter') ? (
                <button className="buy-btn" onClick={() => buyVehicle('helicopter')}>MUA</button>
              ) : (
                <span style={{color: '#4caf50', marginTop: '15px', fontWeight: 'bold'}}>SỞ HỮU</span>
              )}
            </div>

            <div className="vehicle-option">
              <span className="vehicle-icon">🚢</span>
              <h3>Tàu Thủy</h3>
              <span className="price-tag">💰 1000</span>
              {!unlockedVehicles.includes('ship') ? (
                <button className="buy-btn" onClick={() => buyVehicle('ship')}>MUA</button>
              ) : (
                <span style={{color: '#4caf50', marginTop: '15px', fontWeight: 'bold'}}>SỞ HỮU</span>
              )}
            </div>
          </div>
          <button className="close-btn" onClick={() => setShowShop(false)}>ĐÓNG</button>
        </div>
      </div>

      {/* Chú thích điều khiển máy bay */}
      {vehicleFolder === 'helicopter' && (
        <div className="heli-controls">
          <h3>🚁 ĐIỀU KHIỂN</h3>
          <p><b>W / S:</b> Tiến / Lùi</p>
          <p><b>Q / E:</b> Xoay thân (Yaw)</p>
          <p><b>Space:</b> Bay lên & Phanh</p>
          <p><b>Shift:</b> Bay xuống</p>
        </div>
      )}

      <style>{`
        .heli-controls {
          position: absolute;
          bottom: 20px;
          left: 20px;
          background: rgba(0, 0, 0, 0.7);
          color: white;
          padding: 15px;
          border-radius: 12px;
          font-family: sans-serif;
          pointer-events: none;
          z-index: 100;
          border: 1px solid rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(5px);
        }
        .heli-controls h3 { margin: 0 0 10px 0; font-size: 14px; color: #FF7A2F; }
        .heli-controls p { margin: 5px 0; font-size: 12px; }
        .heli-controls b { color: #5bc0de; }
      `}</style>

      <Canvas 
        shadows 
        camera={{ position: [0, 5, 10], fov: 50 }} 
        style={{ background: '#87ceeb' }}
        gl={{ antialias: true, stencil: false, depth: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={['#87ceeb']} />
        <fog attach="fog" args={['#87ceeb', 10, 150]} />
        
        <Sky sunPosition={[100, 20, 100]} />
        
        {/* Cinematic Lighting - Bright Theme */}
        <ambientLight intensity={0.6} />
        <spotLight position={[20, 50, 20]} angle={0.2} penumbra={1} intensity={1.5} castShadow />
        <directionalLight position={[-10, 20, 5]} intensity={1} color="#ffffff" />
        
        {/* Environment Map tạo độ bóng kim loại chuyên nghiệp */}
        <React.Suspense fallback={null}>
          <Environment preset="park" />
          <ContactShadows 
            position={[0, 0, 0]} 
            opacity={0.4} 
            scale={40} 
            blur={2} 
            far={4.5} 
          />
        </React.Suspense>

        <Game vehicleFolder={vehicleFolder} setVehicleFolder={setVehicleFolder} virtualKeys={virtualKeys} />
        <Preload all />
      </Canvas>

      {/* Mobile Controls Overlay */}
      <div className="mobile-controls">
        <div className="d-pad">
          <div className="ctrl-btn up" 
            onPointerDown={() => updateVirtualKey('forward', true)} 
            onPointerUp={() => updateVirtualKey('forward', false)}
            onPointerLeave={() => updateVirtualKey('forward', false)}>▲</div>
          <div className="ctrl-row">
            <div className="ctrl-btn left" 
              onPointerDown={() => updateVirtualKey('left', true)} 
              onPointerUp={() => updateVirtualKey('left', false)}
              onPointerLeave={() => updateVirtualKey('left', false)}>◀</div>
            <div className="ctrl-btn down" 
              onPointerDown={() => updateVirtualKey('backward', true)} 
              onPointerUp={() => updateVirtualKey('backward', false)}
              onPointerLeave={() => updateVirtualKey('backward', false)}>▼</div>
            <div className="ctrl-btn right" 
              onPointerDown={() => updateVirtualKey('right', true)} 
              onPointerUp={() => updateVirtualKey('right', false)}
              onPointerLeave={() => updateVirtualKey('right', false)}>▶</div>
          </div>
        </div>

        <div className="action-btns">
          {vehicleFolder === 'helicopter' && (
            <>
              <div className="ctrl-btn action-btn lift" 
                onPointerDown={() => updateVirtualKey('up', true)} 
                onPointerUp={() => updateVirtualKey('up', false)}
                onPointerLeave={() => updateVirtualKey('up', false)}>🚀 BAY LÊN</div>
              <div className="ctrl-btn action-btn land" 
                onPointerDown={() => updateVirtualKey('down', true)} 
                onPointerUp={() => updateVirtualKey('down', false)}
                onPointerLeave={() => updateVirtualKey('down', false)}>⚓ XUỐNG</div>
            </>
          )}
          <div className="ctrl-btn action-btn brake-btn" 
            onPointerDown={() => updateVirtualKey('brake', true)} 
            onPointerUp={() => updateVirtualKey('brake', false)}
            onPointerLeave={() => updateVirtualKey('brake', false)}>🛑 PHANH</div>
        </div>
      </div>

      <style>{`
        .mobile-controls {
          position: absolute;
          bottom: 40px;
          left: 0;
          width: 100%;
          padding: 0 20px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          z-index: 500;
          pointer-events: none;
        }

        .ctrl-btn {
          width: 65px;
          height: 65px;
          background: rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          user-select: none;
          pointer-events: auto;
          box-shadow: 0 4px 15px rgba(0,0,0,0.5);
          transition: all 0.1s;
          touch-action: none; /* Quan trọng để tránh zoom/scroll khi chơi */
        }
        .ctrl-btn:active { transform: scale(0.85); background: rgba(255, 122, 47, 0.6); }

        .d-pad { display: flex; flex-direction: column; align-items: center; gap: 5px; }
        .ctrl-row { display: flex; gap: 5px; }

        .action-btns { display: flex; flex-direction: column; gap: 10px; }
        .action-btn { width: 120px; height: 55px; font-size: 13px; font-weight: bold; border-radius: 15px; }
        .brake-btn { background: rgba(255, 0, 0, 0.3); }
        .lift { background: rgba(0, 255, 0, 0.2); }
        .land { background: rgba(0, 0, 255, 0.2); }

        /* Chỉ ẩn trên màn hình cực lớn, còn lại cho hiện hết để test */
        @media (min-width: 1400px) {
          .mobile-controls { display: none; }
        }
      `}</style>
    </div>
  );
}
