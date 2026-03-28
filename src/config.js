export const GAME_CONFIG = {
  saveKey: 'empire-east-3d-rts-save-v17-decor-glb',
  mapRadius: 13,
  hexSize: 1.72,
  axialScaleX: 0.985,
  axialScaleZ: 0.98,
  simBaseSpeed: 1,
  dayDuration: 180,
  seasonDuration: 540,
  autosaveEvery: 12,
  workerSpawnEvery: 22,
  enemyWaveEvery: 48,
  enemyCampCount: 5,
  decorModelDensity: 0.46,
  maxPopulationSoft: 60,
  doubleTapMs: 340,
  decorPerTileSoftCap: 4,
  terrain: {
    waterLevel: -1.1,
    riverBand: 0.08,
    hillLevel: 0.8,
    rockLevel: 1.25,
    fertileBand: 0.38,
    forestBand: -0.28
  }
};

export const RESOURCE_META = [
  ['gold', '💰', 'Золото'],
  ['food', '🌾', 'Еда'],
  ['wood', '🪵', 'Дерево'],
  ['stone', '🪨', 'Камень'],
  ['population', '👥', 'Народ'],
  ['workers', '🧑‍🌾', 'Рабочие'],
  ['army', '⚔️', 'Армия'],
  ['prestige', '👑', 'Престиж'],
  ['stability', '🕊️', 'Порядок'],
  ['knowledge', '🔬', 'Знание'],
  ['threat', '🏹', 'Угроза'],
  ['roads', '🛣️', 'Дороги']
];

export const ERA_DATA = [
  { name: 'Основание', desc: 'Держава поднимает первые стены и поля.' },
  { name: 'Расцвет', desc: 'Открыты академии, караванные узлы и усиленные гарнизоны.' },
  { name: 'Золотой век', desc: 'Империя претендует на чудо света и господство.' }
];

export const WEATHER_TYPES = {
  clear: { label: 'Ясно', light: 1, food: 1, speed: 1 },
  rain: { label: 'Дождь', light: .84, food: 1.18, speed: .92 },
  mist: { label: 'Туман', light: .72, food: 1, speed: .86 },
  dust: { label: 'Пыльная буря', light: .76, food: .88, speed: .78 }
};

export const TERRAIN_TYPES = {
  water: { name: 'Вода', buildable: false, color: 0x92c9ea, tint: 0xb7e1f3 },
  river: { name: 'Речной берег', buildable: true, color: 0xa7d6ef, tint: 0xd2eef9 },
  fertile: { name: 'Плодородная земля', buildable: true, color: 0xa8d86a, tint: 0xcaee91 },
  grass: { name: 'Равнина', buildable: true, color: 0x86bb58, tint: 0xa2d274 },
  forest: { name: 'Лес', buildable: true, color: 0x4f8b41, tint: 0x6aa95a },
  hill: { name: 'Холм', buildable: true, color: 0xb69869, tint: 0xcfb587 },
  rock: { name: 'Скала', buildable: true, color: 0xb0aca2, tint: 0xd4cec2 },
  sacred: { name: 'Священная земля', buildable: true, color: 0xe0ca83, tint: 0xf1e2a6 }
};

export const BUILDINGS = {
  capital: {
    name: 'Столица', icon: '🏰',
    model: 'town-center.glb', category: 'core',
    maxLevel: 5,
    baseBuildTime: 0,
    yields: { gold: .55, prestige: .05, knowledge: .02, populationCap: 10 },
    train: ['worker'],
    health: 320,
    territory: 3.2
  },
  farm: {
    name: 'Ферма', icon: '🌾', model: 'farm.glb', category: 'economy',
    cost: { gold: 25, wood: 10 },
    baseBuildTime: 10,
    yields: { food: .85 },
    maxLevel: 3,
    health: 100,
    terrain: ['grass', 'fertile', 'river']
  },
  lumber: {
    name: 'Лесопилка', icon: '🪓', model: 'storage-shed.glb', category: 'economy',
    cost: { gold: 24, food: 6 },
    baseBuildTime: 11,
    yields: { wood: .72 },
    maxLevel: 3,
    health: 110,
    terrain: ['forest', 'grass']
  },
  mine: {
    name: 'Шахта', icon: '⛏️', model: 'mine.glb', category: 'economy',
    cost: { gold: 32, wood: 12 },
    baseBuildTime: 14,
    yields: { stone: .52, gold: .12 },
    maxLevel: 3,
    health: 120,
    terrain: ['hill', 'rock']
  },
  market: {
    name: 'Рынок', icon: '🛍️', model: 'market-stalls.glb', category: 'economy',
    cost: { gold: 48, wood: 14 },
    baseBuildTime: 13,
    yields: { gold: .7 },
    maxLevel: 3,
    health: 110,
    terrain: ['grass', 'fertile', 'river']
  },
  granary: {
    name: 'Амбар', icon: '🏺', model: 'storage-house.glb', category: 'economy',
    cost: { gold: 35, wood: 16 },
    baseBuildTime: 12,
    yields: { food: .22, stability: .015 },
    maxLevel: 3,
    health: 120,
    terrain: ['grass', 'fertile', 'river']
  },
  temple: {
    name: 'Храм', icon: '🏛️', model: 'temple.glb', category: 'culture',
    cost: { gold: 90, stone: 38 },
    baseBuildTime: 18,
    yields: { prestige: .18, stability: .05, knowledge: .04 },
    maxLevel: 3,
    health: 150,
    terrain: ['grass', 'fertile', 'rock', 'hill', 'river', 'sacred']
  },
  barracks: {
    name: 'Казармы', icon: '⚔️', model: 'barracks.glb', category: 'military',
    cost: { gold: 65, stone: 18 },
    baseBuildTime: 18,
    yields: { army: .04 },
    maxLevel: 3,
    train: ['militia', 'swordsman'],
    health: 170,
    terrain: ['grass', 'hill', 'rock', 'fertile']
  },
  wall: {
    name: 'Стена', icon: '🧱', model: 'stone-wall.glb', category: 'military',
    cost: { stone: 24, wood: 10 },
    baseBuildTime: 8,
    yields: { defense: .3 },
    maxLevel: 2,
    health: 240,
    terrain: ['grass', 'hill', 'rock', 'fertile', 'forest']
  },
  tower: {
    name: 'Башня', icon: '🏹', model: 'fortress.glb', category: 'military',
    cost: { gold: 60, stone: 22, wood: 10 },
    baseBuildTime: 17,
    yields: { defense: .65 },
    maxLevel: 2,
    health: 220,
    territory: 1.35,
    terrain: ['grass', 'hill', 'rock', 'fertile']
  },
  academy: {
    name: 'Академия', icon: '📚', model: 'academy.glb', category: 'culture',
    cost: { gold: 100, wood: 16, stone: 26 },
    baseBuildTime: 22,
    yields: { knowledge: .16, prestige: .03 },
    maxLevel: 2,
    health: 150,
    terrain: ['grass', 'fertile', 'hill', 'sacred'],
    minEra: 1
  },
  harbor: {
    name: 'Караванный порт', icon: '🐪', model: 'port.glb', category: 'economy',
    cost: { gold: 88, wood: 20, stone: 14 },
    baseBuildTime: 18,
    yields: { gold: .92, prestige: .04 },
    maxLevel: 2,
    health: 130,
    terrain: ['river'],
    minEra: 1
  },
  wonder: {
    name: 'Чудо света', icon: '✨', model: 'wonder.glb', category: 'culture',
    cost: { gold: 210, wood: 40, stone: 120 },
    baseBuildTime: 48,
    yields: { prestige: .35, stability: .12, knowledge: .12 },
    maxLevel: 1,
    health: 300,
    terrain: ['sacred', 'hill', 'rock'],
    minEra: 2
  }
};

export const UNITS = {
  worker: {
    name: 'Рабочий', icon: '🧑‍🌾', trainTime: 8,
    cost: { food: 4 }, speed: 2.6, hp: 30, attack: 0, range: 0, role: 'worker'
  },
  militia: {
    name: 'Ополченец', icon: '🗡️', trainTime: 9,
    cost: { gold: 16, food: 5 }, speed: 2.2, hp: 48, attack: 5, range: 0.8, role: 'melee'
  },
  swordsman: {
    name: 'Мечник', icon: '⚔️', trainTime: 12,
    cost: { gold: 24, food: 8 }, speed: 2.1, hp: 72, attack: 7, range: 0.85,
    minEra: 1, role: 'melee'
  },
  raider: {
    name: 'Налётчик', icon: '🔥', trainTime: 0,
    cost: {}, speed: 2.0, hp: 42, attack: 6, range: .8, hostile: true, role: 'melee', faction: 'clans'
  },
  raiderArcher: {
    name: 'Налётчик-лучник', icon: '🏹', trainTime: 0,
    cost: {}, speed: 1.95, hp: 36, attack: 5, range: 4.4, hostile: true, role: 'ranged', faction: 'clans'
  },
  brute: {
    name: 'Крушитель', icon: '🪓', trainTime: 0,
    cost: {}, speed: 1.55, hp: 96, attack: 10, range: 1.0, hostile: true, role: 'siege', faction: 'iron'
  },
  wolfRider: {
    name: 'Волк-налётчик', icon: '🐺', trainTime: 0,
    cost: {}, speed: 2.7, hp: 52, attack: 7, range: .9, hostile: true, role: 'melee', faction: 'beasts'
  }
};


export const DECOR_MODELS = {
  tree: { file: 'trees.glb', scale: 0.44, y: 0.0, root: 'decor' },
  oak: { file: 'trees.glb', scale: 0.52, y: 0.0, root: 'decor' },
  pine: { file: 'pine-trees.glb', scale: 0.54, y: 0.0, root: 'decor' },
  pineRound: { file: 'pine-trees.glb', scale: 0.46, y: 0.0, root: 'decor' },
  rocks: { file: 'rocks.glb', scale: 0.28, y: 0.0, root: 'decor' },
  goldRock: { file: 'gold-rocks.glb', scale: 0.24, y: 0.0, root: 'decor' },
  logs: { file: 'logs.glb', scale: 0.24, y: 0.0, root: 'decor' },
  crops: { file: 'crops.glb', scale: 0.18, y: 0.0, root: 'decor' }
};

export const UNIT_MODEL_MAP = {
  worker: { file: 'monk.gltf', targetHeight: 0.2, y: 0.0, rotY: 0, faceOffset: 3.141592653589793 },
  militia: { file: 'warrior.gltf', targetHeight: 0.22, y: 0.0, rotY: 0, faceOffset: 3.141592653589793 },
  swordsman: { file: 'rogue.gltf', targetHeight: 0.21, y: 0.0, rotY: 0, faceOffset: 3.141592653589793 },
  raider: { file: 'rogue.gltf', targetHeight: 0.21, y: 0.0, rotY: 0, faceOffset: 3.141592653589793 },
  raiderArcher: { file: 'ranger.gltf', targetHeight: 0.21, y: 0.0, rotY: 0, faceOffset: 3.141592653589793 },
  brute: { file: 'warrior.gltf', targetHeight: 0.24, y: 0.0, rotY: 0, faceOffset: 3.141592653589793 },
  wolfRider: { file: 'wizard.gltf', targetHeight: 0.23, y: 0.0, rotY: 0, faceOffset: 3.141592653589793 },
};

export const UNIT_VISUALS = {
  worker: { bounce: 0.02, bobSpeed: 5.5, lean: 0.08, weapon: 'staff', ring: 0x7ac7ff, silhouette: 0x7ba06d },
  militia: { bounce: 0.03, bobSpeed: 7.2, lean: 0.16, weapon: 'sword', ring: 0xffd66b, silhouette: 0xa88a5a },
  swordsman: { bounce: 0.032, bobSpeed: 7.8, lean: 0.18, weapon: 'dual', ring: 0xffd66b, silhouette: 0x8f6f57 },
  raider: { bounce: 0.034, bobSpeed: 8.4, lean: 0.2, weapon: 'blade', ring: 0xff7e63, silhouette: 0x8d4437 },
  raiderArcher: { bounce: 0.024, bobSpeed: 6.6, lean: 0.1, weapon: 'bow', ring: 0xff9166, silhouette: 0x78624a },
  brute: { bounce: 0.018, bobSpeed: 4.8, lean: 0.07, weapon: 'axe', ring: 0xff6a57, silhouette: 0x625a58 },
  wolfRider: { bounce: 0.04, bobSpeed: 8.8, lean: 0.22, weapon: 'staff', ring: 0xff985f, silhouette: 0x5c4b39 },
};

export const TECHS = [
  { id: 'irrigation', name: 'Орошение', cost: 14, minEra: 0, desc: 'Фермы у рек и плодородных землях дают больше пищи.' },
  { id: 'stonework', name: 'Каменная кладка', cost: 18, minEra: 0, desc: 'Стены, храмы и башни прочнее и дешевле.' },
  { id: 'caravans', name: 'Караванные пути', cost: 22, minEra: 1, desc: 'Рынки, порты и дороги усиливают золото.' },
  { id: 'discipline', name: 'Воинская дисциплина', cost: 26, minEra: 1, desc: 'Солдаты сильнее, башни стреляют чаще.' },
  { id: 'archives', name: 'Государственные архивы', cost: 28, minEra: 1, desc: 'Академии и столица дают больше знания.' },
  { id: 'dynasty', name: 'Династический кодекс', cost: 34, minEra: 2, desc: 'Порядок растёт, кризисы слабее.' }
];

export const OBJECTIVES = [
  { id: 'food', title: 'Сильные амбары', target: 220, metric: 'food', reward: { population: 2, stability: 8 } },
  { id: 'roads', title: 'Связать державу', target: 10, metric: 'roads', reward: { gold: 40, prestige: 5 } },
  { id: 'army', title: 'Собрать войско', target: 10, metric: 'armyUnits', reward: { prestige: 6, stability: 4 } },
  { id: 'wonder', title: 'Создать чудо', target: 1, metric: 'wonderBuilt', reward: { prestige: 18, stability: 14 } }
];
