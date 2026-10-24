import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type DistrictId = 'workshop' | 'garden' | 'library' | 'harbor';
export type IslandSettings = { paused: boolean; night: boolean; tour: boolean; speed: number; reducedMotion: boolean; overlayWidth?: number };
export type IslandResident = { id: string; name: string; district: DistrictId; status: string; statusLabel: string; kind: 'watcher' | 'demo' | 'workflow'; task: string };
export const districts = [
  { id: 'workshop' as const, name: 'The workshop', role: 'Make & build', color: '#efab73', position: [-12, -5], people: 5, detail: 'A place for good ideas to take shape. Builders cut timber, carry supplies, and tend the forge.' },
  { id: 'garden' as const, name: 'The gardens', role: 'Grow & gather', color: '#a7cc79', position: [-10, 7], people: 4, detail: 'Slow, steady progress. Gardeners tend the vegetable beds and bring the harvest back to the village.' },
  { id: 'library' as const, name: 'The library', role: 'Think & discover', color: '#8dbdeb', position: [10, -7], people: 4, detail: 'A quiet corner for curious minds. Researchers sort books, study the stars, and share their discoveries.' },
  { id: 'harbor' as const, name: 'The harbor', role: 'Deliver & explore', color: '#b8a1e9', position: [12, 8], people: 5, detail: 'Where the island meets the wider world. Couriers move crates, check the boats, and keep the dock in order.' },
];
export type IslandWorld = { update: (settings: IslandSettings) => void; setResidents: (residents: IslandResident[]) => void; selectResident: (id: string | null) => void; focus: (id: DistrictId | null) => void; reset: () => void; resize: () => void; dispose: () => void };

/** Presentation only: real task states are supplied by the desktop subscription. */
export function createIslandWorld(host: HTMLElement, initial: IslandSettings, onSelect: (id: DistrictId | null) => void, onResident: (id: string) => void = () => {}): IslandWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b6d9d4');
  scene.fog = new THREE.Fog('#b6d9d4', 65, 150);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, host.clientWidth < 700 ? 1.25 : 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D island village. Drag to orbit, scroll to zoom. Select a district using the buttons below.');
  renderer.domElement.setAttribute('role', 'img');
  host.appendChild(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-40, 40, 24, -24, .1, 250);
  const homePosition = new THREE.Vector3(43, 38, 48);
  camera.position.copy(homePosition);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = .06;
  controls.minZoom = .7;
  controls.maxZoom = 3.4;
  controls.minPolarAngle = .28;
  controls.maxPolarAngle = Math.PI * .46;
  controls.enablePan = false;
  controls.autoRotateSpeed = .45;
  controls.update();
  const ambient = new THREE.HemisphereLight('#d9edf5', '#636c48', 2.5);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight('#fff0cf', 3.7);
  sun.position.set(-24, 42, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 28, bottom: -28, near: .5, far: 100 });
  sun.shadow.normalBias = .06;
  sun.shadow.bias = -.00015;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#96d9e6', 1.2);
  fill.position.set(20, 20, -30);
  scene.add(fill);

  const cube = new THREE.BoxGeometry(1, 1, 1);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (color: string) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .86 }));
    return materials.get(color)!;
  };
  const glow = new THREE.MeshStandardMaterial({ color: '#fff1b3', emissive: '#ffbe59', emissiveIntensity: .4, roughness: .5 });
  const glass = new THREE.MeshStandardMaterial({ color: '#a6e6df', metalness: .2, roughness: .2, emissive: '#7bc8c2', emissiveIntensity: .12 });
  const world = new THREE.Group();
  scene.add(world);
  const block = (parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, color: string | THREE.Material, shadow = true) => {
    const mesh = new THREE.Mesh(cube, typeof color === 'string' ? mat(color) : color);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const random = (x: number, z: number) => {
    const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const terrain: { x: number; y: number; z: number; h: number; color: string }[] = [];
  const grass = ['#809d62', '#8aaa6c', '#8da96d', '#96af77', '#7f9d65'];
  const tile = 1.4;
  for (let ix = -17; ix <= 17; ix++) for (let iz = -13; iz <= 13; iz++) {
    const x = ix * tile, z = iz * tile;
    const edge = (x / 23) ** 2 + (z / 17.6) ** 2 + Math.sin(ix * .62 + iz * .44) * .065;
    if (edge > 1) continue;
    const beach = edge > .8;
    const top = beach ? .58 : 1.52;
    terrain.push({ x, z, y: top - .62, h: 1.24, color: beach ? ['#d9c799', '#e6d4a9', '#daca9f'][Math.floor(random(ix, iz) * 3)] : grass[Math.floor(random(ix, iz) * grass.length)] });
  }
  for (const color of new Set(terrain.map(cell => cell.color))) {
    const cells = terrain.filter(cell => cell.color === color);
    const mesh = new THREE.InstancedMesh(cube, mat(color), cells.length);
    const transform = new THREE.Object3D();
    cells.forEach((cell, index) => { transform.position.set(cell.x, cell.y, cell.z); transform.scale.set(tile + .015, cell.h, tile + .015); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix); });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); world.add(mesh);
  }
  // Ocean is procedural and entirely local, with slow swells and sun glints.
  const water = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, night: { value: 0 } },
    vertexShader: 'varying vec3 p; void main(){p=position; vec3 v=position; v.z += sin(v.x*.13+v.y*.15)*.035; gl_Position=projectionMatrix*modelViewMatrix*vec4(v,1.);}',
    fragmentShader: `uniform float time; uniform float night; varying vec3 p;
      void main(){float waves=sin(p.x*.72+time*.45)*sin(p.y*.56-time*.35); float little=sin(p.x*3.4+p.y*2.8+time*.9); float glint=pow(max(0.,waves*.5+little*.5),16.);
      float r=length(p.xy*vec2(.8,1.)); vec3 near=vec3(.22,.65,.64), far=vec3(.14,.46,.51); vec3 day=mix(near,far,smoothstep(14.,70.,r)); day+=waves*.013+glint*.075;
      vec3 dark=vec3(.035,.13,.20)+waves*.008+glint*.025; gl_FragColor=vec4(mix(day,dark,night),1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const waterGeometry = new THREE.PlaneGeometry(250, 250, 1, 1);
  const ocean = new THREE.Mesh(waterGeometry, water);
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = -.18; scene.add(ocean);
  const y = 1.52;
  const path = (x: number, z: number, w: number, d: number) => block(world, x, y + .025, z, w, .08, d, '#d1c3a2', false);
  path(0, 0, 33, 2.1); path(0, -.4, 2.1, 26); path(0, 0, 7.2, 7.2);
  path(-12, -3.3, 1.7, 7); path(10, -3.8, 1.7, 8.5); path(-10, 4.8, 1.6, 9); path(12, 4, 1.8, 8);
  path(-2, -8.8, 17, 1.45); path(6, 7.2, 11, 1.5);
  for (let i = 0; i < 11; i++) block(world, -3 + i * .6, y + .09, 2.9, .33, .05, .1, '#af9f80', false);

  const districtGroups = new Map<DistrictId, THREE.Group>();
  districts.forEach(district => { const group = new THREE.Group(); group.userData.district = district.id; districtGroups.set(district.id, group); world.add(group); });
  const building = (parent: THREE.Group, x: number, z: number, w: number, d: number, wall: string, roof: string, height = 2.8) => {
    const group = new THREE.Group(); group.position.set(x, y, z); parent.add(group);
    block(group, 0, .15, 0, w + .35, .3, d + .35, '#829087');
    block(group, 0, height / 2, 0, w, height, d, wall);
    for (const xx of [-w / 2 + .15, w / 2 - .15]) for (const zz of [-d / 2 + .15, d / 2 - .15]) block(group, xx, height / 2, zz, .23, height, .23, '#655c4a');
    for (let i = 0; i < 5; i++) {
      const width = w + .8 - i * (w / 5);
      block(group, 0, height + i * .32, 0, width, .34, d + .8, roof);
    }
    block(group, 0, .9, d / 2 + .03, .66, 1.8, .13, '#655447');
    block(group, .18, .83, d / 2 + .13, .07, .07, .07, '#efc37b');
    for (const xx of [-w * .3, w * .3]) {
      block(group, xx, 1.55, d / 2 + .035, .77, .85, .1, '#5d685e');
      block(group, xx, 1.55, d / 2 + .1, .59, .64, .09, glow);
      block(group, xx, 1.55, d / 2 + .155, .05, .66, .025, '#e8dbc0');
      block(group, xx, 1.55, d / 2 + .155, .59, .05, .025, '#e8dbc0');
    }
    block(group, w / 2 + .02, 1.55, 0, .08, .75, 1, glass);
    block(group, 0, .08, d / 2 + .55, 1.3, .16, .8, '#c1b392');
    return group;
  };
  const homes = new THREE.Group(); world.add(homes);
  building(homes, -5, -11, 3.8, 3.1, '#e5d7b9', '#778da0', 2.4);
  building(homes, 1, -11.2, 3.8, 3.2, '#ddccaa', '#b2795b', 2.5);
  building(homes, 6.5, 9.6, 3.3, 3, '#eadbc4', '#718e7a', 2.25);
  building(homes, 2.2, 8.7, 2.8, 2.8, '#e2c3a4', '#b37861', 2.3);

  const workshop = districtGroups.get('workshop')!;
  building(workshop, -12, -6.2, 5.5, 4, '#d2bc93', '#94756c', 3);
  block(workshop, -12, y + 1.1, -3.1, 4.1, .18, 1.3, '#8c644c');
  for (const x of [-13.7, -10.3]) block(workshop, x, y + .6, -3.1, .16, 1, .75, '#645444');
  for (let i = 0; i < 4; i++) block(workshop, -14.5 + i * .65, y + .4, -1.9, .55, .8, .7, '#b18755');
  block(workshop, -8.8, y + .6, -6, 1.3, 1.2, 1.4, '#67757b');
  block(workshop, -8.8, y + .6, -5.26, .7, .45, .08, glow);
  block(workshop, -8.8, y + 2.1, -6, .55, 2.1, .6, '#697579');
  const smoke = new THREE.Group(); workshop.add(smoke);
  const smokeMaterial = new THREE.MeshStandardMaterial({ color: '#d9d9c9', transparent: true, opacity: .45, depthWrite: false });
  const smokePuffs = Array.from({ length: 5 }, (_, i) => block(smoke, -8.8, y + 3.8 + i * .6, -6, .4, .4, .4, smokeMaterial, false));

  const library = districtGroups.get('library')!;
  building(library, 10, -7.7, 5.7, 4.4, '#e4dfc9', '#507b80', 3.6);
  block(library, 10, y + 1.8, -5.43, 1.45, 2.45, .13, glass);
  for (const x of [7.5, 12.5]) block(library, x, y + 1.9, -4.95, .25, 3.8, .25, '#c5bc9e');
  block(library, 10, y + 3.7, -5, 6.3, .22, 1.5, '#567a7a');
  for (let i = 0; i < 4; i++) block(library, 8 + i * .43, y + .64, -4.25, .3, .4, .55, ['#ba8265', '#829477', '#6e8fa0', '#ddbf81'][i]);
  block(library, 14.8, y + .8, -6.7, .18, 1.6, .18, '#556974');
  const telescope = block(library, 14.8, y + 1.65, -6.7, .45, .45, 1.8, '#b9bc9b'); telescope.rotation.x = -.55;
  block(library, 14.8, y + .25, -6.7, 2, .5, 2, '#a3aa95');

  const garden = districtGroups.get('garden')!;
  for (const cx of [-11.8, -7.2]) {
    block(garden, cx, y + .075, 6.8, 3.4, .15, 5.4, '#725a43');
    for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
      const x = cx - 1.05 + col * 1.05, z = 4.8 + row * 1;
      block(garden, x, y + .16, z, .55, .18, .55, '#547643');
      for (let leaf = 0; leaf < 3; leaf++) { const crop = block(garden, x + (leaf - 1) * .12, y + .35 + random(row, col) * .1, z, .1, .35, .12, row % 2 ? '#bbbd59' : '#99b354'); crop.rotation.z = (leaf - 1) * .3; }
    }
    for (const dx of [-1.85, 1.85]) { block(garden, cx + dx, y + .3, 6.8, .13, .6, 5.7, '#bcac7c'); }
  }
  const windmill = new THREE.Group(); windmill.position.set(-15.7, y, 5.7); garden.add(windmill);
  block(windmill, 0, 2.2, 0, 2.15, 4.4, 2.2, '#e0d9b8');
  block(windmill, 0, 4.45, 0, 2.6, .35, 2.6, '#80908a'); block(windmill, 0, 4.75, 0, 1.8, .35, 2.3, '#80908a');
  block(windmill, 0, .85, 1.15, .62, 1.7, .1, '#7d6650');
  const sails = new THREE.Group(); sails.position.set(0, 3.5, 1.48); windmill.add(sails);
  for (let i = 0; i < 4; i++) { const blade = new THREE.Group(); blade.rotation.z = i * Math.PI / 2; sails.add(blade); block(blade, 0, 1.4, 0, .16, 2.8, .14, '#79674f'); block(blade, .32, 1.8, 0, .65, 1.75, .1, '#efe4bf'); }
  block(sails, 0, 0, .15, .45, .45, .3, '#a28d62');

  const harbor = districtGroups.get('harbor')!;
  building(harbor, 12.1, 7.2, 4.4, 3.1, '#d4c9ae', '#658890', 2.5);
  block(harbor, 12.1, 1.1, 14.3, 2.8, .35, 10.5, '#a4825f');
  for (let i = 0; i < 19; i++) block(harbor, 12.1, 1.31, 9.4 + i * .52, 2.82, .06, .06, '#876b50', false);
  block(harbor, 14.3, 1.12, 17, 6.5, .3, 2.3, '#a4825f');
  for (const xx of [10.9, 13.3]) for (const zz of [11, 14, 18.9]) block(harbor, xx, .4, zz, .27, 2.5, .27, '#6e6250');
  for (let i = 0; i < 3; i++) block(harbor, 10.8 + i * .9, y + .4, 9.2, .74, .8, .74, '#b69361');
  const boat = new THREE.Group(); boat.position.set(16.5, .15, 19.6); harbor.add(boat);
  block(boat, 0, .3, 0, 2.2, .45, 4.2, '#7e634c'); block(boat, 0, .6, 0, 1.65, .25, 3.2, '#dcc99f');
  for (const xx of [-.95, .95]) block(boat, xx, .65, 0, .18, .65, 3.3, '#956f50');
  block(boat, 0, 2.5, -.2, .12, 4.5, .12, '#665c4e');
  for (let i = 0; i < 6; i++) block(boat, .45 + i * .11, 3.6 - i * .38, -.2, .85 + i * .23, .4, .09, '#f1e6c8');
  const lighthouse = new THREE.Group(); lighthouse.position.set(19.2, .6, .4); harbor.add(lighthouse);
  block(lighthouse, 0, .2, 0, 3.3, .4, 3.3, '#b3b99f');
  for (let i = 0; i < 6; i++) block(lighthouse, 0, .8 + i * .75, 0, 1.7, .75, 1.7, i % 2 ? '#e2d8bf' : '#8b9c9b');
  block(lighthouse, 0, 5.15, 0, 2.3, .2, 2.3, '#586b6c');
  block(lighthouse, 0, 5.7, 0, 1.5, .95, 1.5, glow); block(lighthouse, 0, 6.28, 0, 2.15, .3, 2.15, '#637578');
  const beacon = new THREE.PointLight('#ffd38b', 0, 15, 2); beacon.position.set(19.2, 6.3, .4); scene.add(beacon);

  // Village square: stepped fountain, market, benches, and street lanterns.
  block(world, 0, y + .14, 0, 3.5, .28, 3.5, '#899e95');
  block(world, 0, y + .33, 0, 2.9, .25, 2.9, '#c9d0b8');
  block(world, 0, y + .48, 0, 2.42, .1, 2.42, '#76bdba');
  block(world, 0, y + .95, 0, .55, 1.1, .55, '#c7cfb4'); block(world, 0, y + 1.46, 0, 1.1, .22, 1.1, '#c7cfb4');
  const fountain = new THREE.Group(); fountain.position.set(0, y + 1.6, 0); world.add(fountain);
  for (let i = 0; i < 4; i++) block(fountain, Math.cos(i * Math.PI / 2) * .3, -.25, Math.sin(i * Math.PI / 2) * .3, .07, .8, .07, glass, false);
  for (const x of [-3, 3]) { block(world, x, y + .45, 1.8, .7, .15, 1.7, '#876c4f'); block(world, x, y + .8, 2.58, .7, .7, .13, '#947456'); }
  for (let i = 0; i < 2; i++) {
    const x = -4.4 + i * 3.4, z = -5;
    block(world, x, y + .9, z, 2.4, .25, 1.5, '#977c59');
    for (const dx of [-1, 1]) block(world, x + dx, y + 1.3, z, .12, 2.6, .12, '#8e7353');
    for (let stripe = 0; stripe < 6; stripe++) block(world, x - 1.35 + stripe * .54, y + 2.65, z, .54, .18, 2.2, stripe % 2 ? '#ead8ae' : i ? '#738f7c' : '#c28b6e');
    for (let j = 0; j < 4; j++) block(world, x - .85 + j * .5, y + 1.18, z, .3, .3, .3, i ? '#91a659' : '#d7a265');
  }
  const lanterns: THREE.PointLight[] = [];
  for (const [x, z] of [[-4, 0], [4, 0], [-10, .9], [10, .9], [0, -7], [0, 6], [12, 12]]) {
    block(world, x, y + 1.15, z, .14, 2.3, .14, '#65716b'); block(world, x, y + 2.4, z, .43, .47, .43, glow); block(world, x, y + 2.69, z, .58, .13, .58, '#69736a');
    const light = new THREE.PointLight('#ffbf78', 0, 7, 2); light.position.set(x, y + 2.5, z); scene.add(light); lanterns.push(light);
  }
  const tree = (x: number, z: number, scale = 1, pine = false) => {
    const group = new THREE.Group(); group.position.set(x, y, z); group.scale.setScalar(scale); world.add(group);
    block(group, 0, 1, 0, .48, 2, .48, '#857053');
    if (pine) for (let i = 0; i < 4; i++) block(group, 0, 1.8 + i * .75, 0, 2.5 - i * .48, .85, 2.5 - i * .48, i % 2 ? '#527b65' : '#5e8b6a');
    else { block(group, 0, 2.8, 0, 2.7, 1.8, 2.7, '#6d9465'); block(group, -.45, 3.9, .15, 1.8, .9, 1.9, '#82a472'); block(group, .8, 2.8, -.4, 1.4, 1.35, 1.5, '#779d68'); }
  };
  [[-19, -4], [-17, -9], [-13, -11], [-10, -13], [9, -12], [15, -9], [18, -5], [18, 4], [-19, 3], [-15, 11], [-8, 12], [-3, 12], [9, 11]].forEach(([x, z], i) => tree(x, z, .75 + random(x, z) * .35, i % 3 === 0));
  for (const [x, z] of [[-17, 2], [4, -6], [4, 4], [-5, 9], [16, 4]]) {
    for (let i = 0; i < 5; i++) { const xx = x + random(i, x) * 1.8, zz = z + random(i, z) * 1.5; block(world, xx, y + .12, zz, .1, .24, .1, '#6f8d4c', false); block(world, xx, y + .27, zz, .21, .17, .21, i % 2 ? '#e8c98b' : '#cc9e9a', false); }
  }

  // Each villager follows the village paths, then stops to perform a small job.
  type Villager = { group: THREE.Group; arms: THREE.Group[]; legs: THREE.Group[]; route: THREE.Vector2[]; offset: number; period: number; resident: IslandResident; label: HTMLButtonElement; point: THREE.Vector2 };
  const villagers: Villager[] = [];
  const makeVillager = (resident: IslandResident, index: number, route: number[][], shirt: string) => {
    const district = resident.district;
    const group = new THREE.Group(); group.userData.district = district; group.userData.residentId = resident.id; world.add(group);
    const skin = ['#e7c59d', '#c99168', '#976f54'][index % 3];
    block(group, 0, .82, 0, .35, .34, .35, skin);
    block(group, 0, 1.025, -.035, .4, .12, .41, '#665447');
    block(group, 0, 1.09, 0, .52, .07, .48, shirt);
    block(group, -.085, .84, .179, .045, .055, .015, '#424442', false); block(group, .085, .84, .179, .045, .055, .015, '#424442', false);
    block(group, 0, .53, 0, .37, .34, .27, shirt);
    const arms = [-1, 1].map(side => { const pivot = new THREE.Group(); pivot.position.set(side * .26, .64, 0); group.add(pivot); block(pivot, 0, -.15, 0, .13, .24, .16, shirt); block(pivot, 0, -.3, 0, .13, .13, .14, skin); return pivot; });
    const legs = [-1, 1].map(side => { const pivot = new THREE.Group(); pivot.position.set(side * .105, .36, 0); group.add(pivot); block(pivot, 0, -.14, 0, .15, .26, .17, '#526065'); block(pivot, 0, -.3, .035, .16, .09, .24, '#5a5149'); return pivot; });
    if (district === 'harbor' || index % 3 === 0) block(group, 0, .46, .35, .43, .36, .35, '#b29462');
    const label = document.createElement('button');
    label.type = 'button'; label.className = 'island-resident-label'; label.dataset.residentId = resident.id;
    label.textContent = `${resident.name} · ${resident.statusLabel}`;
    label.setAttribute('aria-label', `Inspect ${resident.name}: ${resident.statusLabel}`);
    label.title = `${resident.name}: ${resident.task}`; label.onclick = () => onResident(resident.id); host.appendChild(label);
    villagers.push({ group, arms, legs, route: route.map(([x, z]) => new THREE.Vector2(x, z)), offset: index * 2.9, period: 32 + index * 1.5, resident, label, point: new THREE.Vector2() });
  };
  districts.forEach(district => {
    for (let i = 0; i < district.people; i++) {
      const [x, z] = district.position;
      const work = [x + (i % 3 - 1) * 1.1, z + (district.id === 'garden' ? .5 : 2.5)];
      const routes = district.id === 'harbor' ? [work, [12, 10], [12, 15.6], [12, 10]] : [work, [x, 0], [i % 2 ? 2.6 : -2.6, 0], [x, 0]];
      makeVillager({ id: `demo-${district.id}-${i}`, name: ['Milo', 'Willow', 'Atlas', 'Nova', 'Robin'][i] + ` ${districts.indexOf(district) + 1}`, district: district.id, status: 'demo', statusLabel: 'Demo villager', task: 'Illustrative village activity', kind: 'demo' }, i, routes, ['#b88764', '#7e9a5e', '#6b93a1', '#9b86b0'][districts.indexOf(district)]);
    }
  });
  // Low-poly gulls and slow drifting clouds complete the coast.
  const gulls = Array.from({ length: 4 }, (_, i) => {
    const group = new THREE.Group(); scene.add(group);
    const wings = [-1, 1].map(side => { const wing = block(group, side * .24, 0, 0, .5, .055, .13, '#f1efe4', false); wing.rotation.z = side * .2; return wing; });
    block(group, 0, 0, 0, .12, .12, .35, '#f1efe4', false);
    return { group, wings, offset: i * 1.7 };
  });
  const clouds = new THREE.Group(); scene.add(clouds);
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#f6eee0', transparent: true, opacity: .58, depthWrite: false, roughness: 1 });
  for (const [x, z] of [[-28, -23], [26, -27], [-28, 20]]) {
    const cloud = new THREE.Group(); cloud.position.set(x, 14, z); clouds.add(cloud);
    block(cloud, 0, 0, 0, 6.5, .55, 2.2, cloudMat, false); block(cloud, .2, .5, 0, 4.3, .8, 2, cloudMat, false);
  }

  const ringGeometry = new THREE.RingGeometry(3.5, 3.57, 64);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: '#fff2c0', transparent: true, opacity: .75, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = y + .16; ring.visible = false; world.add(ring);
  // Bake stationary blocks into material/district batches. Moving characters,
  // sails, water, and boats retain their articulated transforms.
  scene.updateMatrixWorld(true);
  const animatedRoots = new Set<THREE.Object3D>([smoke, sails, boat, fountain, clouds, ...villagers.map(person => person.group), ...gulls.map(gull => gull.group)]);
  const batches = new Map<string, { material: THREE.Material; district: DistrictId | undefined; shadow: boolean; blocks: THREE.Mesh[] }>();
  world.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object.geometry !== cube || Array.isArray(object.material)) return;
    let current: THREE.Object3D | null = object, district: DistrictId | undefined;
    while (current) { if (animatedRoots.has(current)) return; district ||= current.userData.district; current = current.parent; }
    const key = `${object.material.uuid}:${district || 'commons'}:${object.castShadow}`;
    if (!batches.has(key)) batches.set(key, { material: object.material, district, shadow: object.castShadow, blocks: [] });
    batches.get(key)!.blocks.push(object);
  });
  batches.forEach(batch => {
    const instanced = new THREE.InstancedMesh(cube, batch.material, batch.blocks.length);
    instanced.castShadow = batch.shadow; instanced.receiveShadow = true;
    if (batch.district) instanced.userData.district = batch.district;
    batch.blocks.forEach((mesh, index) => { instanced.setMatrixAt(index, mesh.matrixWorld); mesh.removeFromParent(); });
    instanced.computeBoundingSphere(); world.add(instanced);
  });
  type PersonBatch = { mesh: THREE.InstancedMesh; blocks: THREE.Mesh[] };
  let personBatches: PersonBatch[] = [];
  const batchPeople = () => {
    personBatches.forEach(batch => { batch.mesh.removeFromParent(); batch.mesh.dispose(); });
    personBatches = [];
    const groups = new Map<THREE.Material, { blocks: THREE.Mesh[]; ids: string[] }>();
    villagers.forEach(person => person.group.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      object.visible = false;
      if (!groups.has(object.material)) groups.set(object.material, { blocks: [], ids: [] });
      const batch = groups.get(object.material)!; batch.blocks.push(object); batch.ids.push(person.resident.id);
    }));
    groups.forEach((batch, material) => {
      const mesh = new THREE.InstancedMesh(cube, material, batch.blocks.length);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.userData.residentIds = batch.ids;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 50);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); world.add(mesh); personBatches.push({ mesh, blocks: batch.blocks });
    });
    renderer.shadowMap.needsUpdate = true;
  };
  batchPeople();
  const setResidents = (residents: IslandResident[]) => {
    const wanted = residents.slice(0, 64);
    const same = wanted.length === villagers.length && wanted.every((resident, i) => resident.id === villagers[i].resident.id && resident.district === villagers[i].resident.district);
    if (same) { wanted.forEach((resident, i) => { villagers[i].resident = resident; villagers[i].label.textContent = `${resident.name} · ${resident.statusLabel}`; villagers[i].label.setAttribute('aria-label', `Inspect ${resident.name}: ${resident.statusLabel}`); villagers[i].label.title = `${resident.name}: ${resident.task}`; }); return; }
    villagers.forEach(person => { person.group.removeFromParent(); person.label.remove(); }); villagers.length = 0;
    const counts = new Map<DistrictId, number>();
    wanted.forEach(resident => {
      const district = districts.find(item => item.id === resident.district)!;
      const index = counts.get(district.id) || 0; counts.set(district.id, index + 1);
      const [x, z] = district.position;
      const offset = (index % 5 - 2) * .75;
      const work = [x + offset, z + 2.5 + Math.floor(index / 5) * .7];
      const route = district.id === 'harbor' ? [work, [12, 10], [12, 15.6], [12, 10]] : [work, [x, 0], [index % 2 ? 2.6 : -2.6, 0], [x, 0]];
      makeVillager(resident, index, route, ['#b88764', '#7e9a5e', '#6b93a1', '#9b86b0'][districts.indexOf(district)]);
    });
    batchPeople(); host.dataset.residentCount = String(wanted.length);
  };
  let settings = { ...initial };
  let selected: DistrictId | null = null;
  let selectedResident: string | null = null;
  let focusTarget: THREE.Vector3 | null = null;
  let desiredZoom = 1;
  let time = 0, lastFrame = performance.now(), lastRendered = 0, lastShadow = 0, nightValue = initial.night ? 1 : 0;
  let dirty = true;
  const daySky = new THREE.Color('#b6d9d4'), nightSky = new THREE.Color('#152b42');
  const daySun = new THREE.Color('#fff0cf'), nightSun = new THREE.Color('#9cadf0');
  const projected = new THREE.Vector3();
  const labelOffset = new THREE.Vector3(0, 1.45, 0);
  let viewportWidth = 1, viewportHeight = 1;
  let dragging = false, pointerStart = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const down = (event: PointerEvent) => { pointerStart.set(event.clientX, event.clientY); dragging = false; };
  const move = (event: PointerEvent) => { if (event.buttons && pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) dragging = true; };
  const up = (event: PointerEvent) => {
    if (dragging || event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(world.children, true).find(item => { if (!item.object.visible) return false; if (item.object.userData.residentIds) return true; let current: THREE.Object3D | null = item.object; while (current) { if (current.userData.district) return true; current = current.parent; } return false; });
    if (hit?.object.userData.residentIds && hit.instanceId !== undefined) onResident(hit.object.userData.residentIds[hit.instanceId]);
    else if (hit) { let current: THREE.Object3D | null = hit.object; while (current && !current.userData.district) current = current.parent; if (current) onSelect(current.userData.district); }
  };
  const interruptFocus = () => { focusTarget = null; dirty = true; };
  const changed = () => { dirty = true; };
  controls.addEventListener('start', interruptFocus);
  controls.addEventListener('change', changed);
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointermove', move);
  renderer.domElement.addEventListener('pointerup', up);
  const resize = () => {
    const width = Math.max(host.clientWidth, 1), height = Math.max(host.clientHeight, 1);
    viewportWidth = width; viewportHeight = height;
    const aspect = width / height;
    const halfHeight = aspect < 1 ? 26 / aspect : 23;
    const inset = width >= 900 ? (settings.overlayWidth || 0) * halfHeight / height : 0;
    camera.left = -halfHeight * aspect + inset; camera.right = halfHeight * aspect + inset; camera.top = halfHeight; camera.bottom = -halfHeight;
    camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
    dirty = true;
  };
  resize();
  const observer = new ResizeObserver(resize); observer.observe(host);
  const render = () => {
    const now = performance.now();
    if (now - lastRendered < 1000 / 30) return;
    lastRendered = now;
    const delta = Math.min((now - lastFrame) / 1000, .1); lastFrame = now;
    if (document.hidden) return;
    const moving = !settings.paused && !settings.reducedMotion;
    const lighting = Math.abs(nightValue - (settings.night ? 1 : 0)) > .001;
    if (!moving && !lighting && !dirty && !focusTarget) { controls.update(delta); if (!dirty) return; }
    if (!settings.paused && !settings.reducedMotion) time += delta * settings.speed;
    nightValue = THREE.MathUtils.damp(nightValue, settings.night ? 1 : 0, 2, delta);
    water.uniforms.time.value = time; water.uniforms.night.value = nightValue;
    (scene.background as THREE.Color).copy(daySky).lerp(nightSky, nightValue);
    (scene.fog as THREE.Fog).color.copy(scene.background as THREE.Color);
    ambient.intensity = THREE.MathUtils.lerp(2.5, .78, nightValue);
    sun.intensity = THREE.MathUtils.lerp(3.7, .65, nightValue);
    sun.color.copy(daySun).lerp(nightSun, nightValue);
    fill.intensity = THREE.MathUtils.lerp(1.2, .65, nightValue);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(1.22, 1, nightValue);
    glow.emissiveIntensity = .4 + nightValue * 2;
    lanterns.forEach(light => { light.intensity = nightValue * 7; }); beacon.intensity = nightValue * 22;
    cloudMat.opacity = .58 * (1 - nightValue * .6);
    controls.autoRotate = settings.tour && !settings.paused && !settings.reducedMotion && !selected;
    if (focusTarget) {
      controls.target.lerp(focusTarget, 1 - Math.exp(-delta * 3.5));
      camera.zoom = THREE.MathUtils.damp(camera.zoom, desiredZoom, 3.5, delta); camera.updateProjectionMatrix();
      if (controls.target.distanceTo(focusTarget) < .015 && Math.abs(camera.zoom - desiredZoom) < .005) focusTarget = null;
    }
    controls.update(delta);
    sails.rotation.z = time * .34;
    boat.position.y = .15 + Math.sin(time * .7) * .08; boat.rotation.z = Math.sin(time * .8) * .025;
    fountain.scale.y = .9 + Math.sin(time * 2) * .1;
    smokePuffs.forEach((puff, i) => { const life = (time * .45 + i / 5) % 1; puff.position.set(-8.8 + life * .8, y + 3.5 + life * 3, -6); puff.scale.setScalar(.25 + life * .6); });
    villagers.forEach(villager => {
      const cycle = ((time + villager.offset) % villager.period) / villager.period;
      const active = ['watching', 'executing', 'delivering', 'demo'].includes(villager.resident.status);
      const resting = !active || cycle < .24;
      const progress = resting ? 0 : (cycle - .24) / .76 * villager.route.length;
      const segment = Math.floor(progress) % villager.route.length;
      const from = villager.route[segment], to = villager.route[(segment + 1) % villager.route.length];
      const point = villager.point.copy(from).lerp(to, progress - Math.floor(progress));
      const ground = villager.group.userData.district === 'harbor' && point.y > 10 ? 1.34 : y + .05;
      villager.group.position.set(point.x, ground + (resting ? 0 : Math.abs(Math.sin(time * 6 + villager.offset)) * .035), point.y);
      if (!resting) villager.group.rotation.y = Math.atan2(to.x - from.x, to.y - from.y);
      const swing = Math.sin(time * (resting ? 3 : 6) + villager.offset);
      villager.arms.forEach((arm, i) => { arm.rotation.x = !active ? 0 : resting ? -.75 + swing * .35 : swing * .5 * (i ? 1 : -1); });
      villager.legs.forEach((leg, i) => { leg.rotation.x = resting ? 0 : swing * .45 * (i ? -1 : 1); });
      villager.group.updateMatrixWorld(true);
    });
    personBatches.forEach(batch => { batch.blocks.forEach((mesh, i) => batch.mesh.setMatrixAt(i, mesh.matrixWorld)); batch.mesh.instanceMatrix.needsUpdate = true; });
    const occupied: { x: number; y: number }[] = [];
    [...villagers].sort((a, b) => Number(b.resident.id === selectedResident) - Number(a.resident.id === selectedResident)).forEach(person => {
      projected.copy(person.group.position).add(labelOffset).project(camera);
      const x = (projected.x + 1) * viewportWidth / 2, yy = (1 - projected.y) * viewportHeight / 2;
      const visible = projected.z < 1 && x > 65 && x < viewportWidth - 65 && yy > 125 && yy < viewportHeight - 140 && !occupied.some(point => Math.abs(point.x - x) < 150 && Math.abs(point.y - yy) < 25);
      person.label.hidden = !visible;
      person.label.classList.toggle('selected', person.resident.id === selectedResident);
      person.label.dataset.status = person.resident.status;
      if (visible) { occupied.push({ x, y: yy }); person.label.style.transform = `translate(${x.toFixed(1)}px,${yy.toFixed(1)}px) translate(-50%,-100%)`; }
    });
    if (selectedResident) { const person = villagers.find(item => item.resident.id === selectedResident); if (person) ring.position.set(person.group.position.x, y + .16, person.group.position.z); }
    gulls.forEach(({ group, wings, offset }) => { const phase = time * .12 + offset; group.position.set(Math.cos(phase) * 26, 10 + Math.sin(phase * 2) * 1.5, Math.sin(phase) * 20); group.rotation.y = -phase; wings.forEach((wing, i) => { wing.rotation.z = Math.sin(time * 3 + offset) * .25 * (i ? 1 : -1); }); });
    clouds.children.forEach((cloud, i) => { cloud.position.x += Math.sin(time * .06 + i) * delta * .025 * (!settings.paused && !settings.reducedMotion ? 1 : 0); });
    if (now - lastShadow > 250 || renderer.shadowMap.needsUpdate) { renderer.shadowMap.needsUpdate = true; lastShadow = now; }
    renderer.render(scene, camera); dirty = false;
    // Observable visual state for smoke checks; no application data is exposed.
    renderer.domElement.dataset.worldTime = time.toFixed(2);
    renderer.domElement.dataset.worldNight = nightValue.toFixed(2);
    renderer.domElement.dataset.renderCalls = String(renderer.info.render.calls);
  };
  renderer.setAnimationLoop(render);
  host.dataset.worldReady = 'true';
  return {
    update: next => { const insetChanged = settings.overlayWidth !== next.overlayWidth; settings = { ...next }; dirty = true; if (insetChanged) resize(); },
    setResidents: residents => { setResidents(residents); dirty = true; },
    selectResident: id => {
      selectedResident = id; dirty = true;
      const person = villagers.find(person => person.resident.id === id);
      if (!person) return;
      selected = person.resident.district; ring.visible = true; ringMaterial.color.set(districts.find(item => item.id === selected)!.color);
      const [x, z] = districts.find(item => item.id === selected)!.position;
      focusTarget = new THREE.Vector3(x, 1.6, z); desiredZoom = 1.8;
      if (settings.reducedMotion) { controls.target.copy(focusTarget); camera.zoom = desiredZoom; camera.updateProjectionMatrix(); focusTarget = null; }
    },
    focus: id => {
      selected = id;
      selectedResident = null; dirty = true;
      const district = districts.find(item => item.id === id);
      ring.visible = !!district;
      if (district) { ring.position.set(district.position[0], y + .16, district.position[1]); ringMaterial.color.set(district.color); }
      focusTarget = district ? new THREE.Vector3(district.position[0], 1.6, district.position[1]) : new THREE.Vector3(0, 1.3, 0);
      desiredZoom = district ? 1.7 : 1;
      if (settings.reducedMotion) { controls.target.copy(focusTarget); camera.zoom = desiredZoom; camera.updateProjectionMatrix(); focusTarget = null; }
    },
    reset: () => { camera.position.copy(homePosition); controls.target.set(0, 1.3, 0); camera.zoom = 1; camera.updateProjectionMatrix(); selected = null; selectedResident = null; dirty = true; ring.visible = false; focusTarget = null; controls.update(); },
    resize,
    dispose: () => {
      renderer.setAnimationLoop(null); observer.disconnect(); controls.removeEventListener('start', interruptFocus); controls.removeEventListener('change', changed); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointermove', move); renderer.domElement.removeEventListener('pointerup', up);
      const geometries = new Set<THREE.BufferGeometry>(), ownedMaterials = new Set<THREE.Material>();
      scene.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => ownedMaterials.add(material)); if (object instanceof THREE.InstancedMesh) object.dispose(); } });
      geometries.forEach(geometry => geometry.dispose()); ownedMaterials.forEach(material => material.dispose());
      materials.forEach(material => { if (!ownedMaterials.has(material)) material.dispose(); });
      villagers.forEach(person => person.label.remove());
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); delete host.dataset.worldReady; delete host.dataset.residentCount;
    },
  };
}

