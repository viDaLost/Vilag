export const GAME_CONFIG = {
  saveKey: 'empire-of-the-river-save-v4',
  saveVersion: 4,
  worldRadius: 54,
  mapRadius: 14,
  hexSize: 1.72,
  gridSize: 1.8,
  axialScaleX: 0.985,
  axialScaleZ: 0.98,
  simBaseSpeed: 1,
  dayDuration: 320,
  seasonDuration: 210,
  autosaveEvery: 20,
  workerSpawnEvery: 52,
  enemyWaveEvery: 145,
  enemyCampCount: 4,
  decorModelDensity: 0.54,
  maxPopulationSoft: 72,
  doubleTapMs: 340,
  decorPerTileSoftCap: 5,
  resourceRegrowTime: 210,
  logicTick: 0.05,
  hudRefresh: 0.2,
  minimapRefresh: 0.5,
  terrain: {
    waterLevel: -0.72,
    riverBand: 0.055,
    hillLevel: 0.78,
    rockLevel: 1.12,
    fertileBand: 0.26,
    forestBand: -0.18
  }
};

export const RESOURCE_META = [
  ['gold', '💰', 'Золото'],
  ['food', '🌾', 'Еда'],
  ['wood', '🪵', 'Дерево'],
  ['stone', '🪨', 'Камень'],
  ['population', '👥', 'Народ'],
  ['workers', '🧑‍🌾', 'Свободные'],
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



export const TERRAIN_TYPES = {
  water: { name: 'Вода', buildable: false, color: 0x8ab4d7, tint: 0xb7e1f3 },
  river: { name: 'Речной берег', buildable: true, color: 0x91b98f, tint: 0xd2eef9 },
  fertile: { name: 'Плодородная земля', buildable: true, color: 0x8ca15c, tint: 0xcaee91 },
  grass: { name: 'Равнина', buildable: true, color: 0x738f4c, tint: 0xa2d274 },
  forest: { name: 'Лес', buildable: true, color: 0x496b34, tint: 0x6aa95a },
  hill: { name: 'Холм', buildable: true, color: 0x7d7258, tint: 0xcfb587 },
  rock: { name: 'Скала', buildable: true, color: 0x8a8982, tint: 0xd4cec2 },
  sacred: { name: 'Священная земля', buildable: true, color: 0xb6aa72, tint: 0xf1e2a6 }
};

export const BUILDINGS = {
  capital: {
    name: 'Столица', icon: '🏰',
    desc: 'Сердце державы: расширяет владения, обучает рабочих и поддерживает население.',
    model: 'castle-fortress.glb', category: 'core',
    maxLevel: 5,
    baseBuildTime: 0,
    yields: { gold: .16, prestige: .035, knowledge: .018, populationCap: 14 },
    train: ['worker'],
    health: 380,
    territory: 3.4,
    workerSupport: 2
  },
  farm: {
    name: 'Ферма', icon: '🌾', model: 'farm.glb', category: 'economy',
    desc: 'Производит пищу; плодородная земля и берег усиливают урожай.',
    cost: { gold: 25, wood: 10 },
    baseBuildTime: 10,
    yields: { food: .48 },
    maxLevel: 3,
    health: 110,
    terrain: [],
    requiredWorkers: 1
  },
  lumber: {
    name: 'Лесопилка', icon: '🪓', model: 'storage-shed.glb', category: 'economy',
    desc: 'Направляет рабочих к ближайшим деревьям и принимает древесину.',
    cost: { gold: 24, food: 6 },
    baseBuildTime: 11,
    yields: { wood: .18 },
    maxLevel: 3,
    health: 120,
    terrain: [],
    requiredWorkers: 1
  },
  mine: {
    name: 'Шахта', icon: '⛏️', model: 'mine.glb', category: 'economy',
    desc: 'Добывает камень и редкое золото на холмах и скалах.',
    cost: { gold: 32, wood: 12 },
    baseBuildTime: 14,
    yields: { stone: .16, gold: .035 },
    maxLevel: 3,
    health: 132,
    terrain: [],
    requiredWorkers: 1
  },
  market: {
    name: 'Рынок', icon: '🛍️', model: 'market-stalls.glb', category: 'economy',
    desc: 'Получает золото от дорог, соседних поселений и караванов.',
    cost: { gold: 48, wood: 14 },
    baseBuildTime: 13,
    yields: { gold: .42 },
    maxLevel: 3,
    health: 120,
    terrain: [],
    requiredWorkers: 1
  },
  granary: {
    name: 'Амбар', icon: '🏺', model: 'storage-house.glb', category: 'economy',
    desc: 'Увеличивает вместимость запасов и поддерживает порядок.',
    cost: { gold: 35, wood: 16 },
    baseBuildTime: 12,
    yields: { food: .12, stability: .018, populationCap: 4 },
    maxLevel: 3,
    health: 128,
    terrain: [],
    requiredWorkers: 1
  },
  temple: {
    name: 'Храм', icon: '🏛️', model: 'temple.glb', category: 'culture',
    desc: 'Укрепляет порядок, престиж и медленно лечит защитников рядом.',
    cost: { gold: 90, stone: 38 },
    baseBuildTime: 18,
    yields: { prestige: .22, stability: .06, knowledge: .05 },
    maxLevel: 3,
    health: 164,
    terrain: [],
    requiredWorkers: 1
  },
  barracks: {
    name: 'Казармы', icon: '⚔️', model: 'barracks.glb', category: 'military',
    desc: 'Обучает пехоту и служит укреплённой точкой сбора.',
    cost: { gold: 65, stone: 18 },
    baseBuildTime: 18,
    yields: { army: .05 },
    maxLevel: 3,
    train: ['militia', 'archer', 'swordsman'],
    health: 185,
    terrain: []
  },
  wall: {
    name: 'Стена', icon: '🧱', model: 'stone-wall.glb', category: 'military',
    desc: 'Задерживает врагов и прикрывает важные здания.',
    cost: { stone: 24, wood: 10 },
    baseBuildTime: 8,
    yields: { defense: .3 },
    maxLevel: 2,
    health: 260,
    terrain: []
  },
  tower: {
    name: 'Башня', icon: '🏹', model: 'fortress.glb', category: 'military',
    desc: 'Автоматически обстреливает врагов и расширяет обзор.',
    cost: { gold: 60, stone: 22, wood: 10 },
    baseBuildTime: 17,
    yields: { defense: .7 },
    maxLevel: 2,
    health: 236,
    territory: 1.35,
    terrain: []
  },
  academy: {
    name: 'Академия', icon: '📚', model: 'academy.glb', category: 'culture',
    desc: 'Ускоряет исследования и открывает путь к Золотому веку.',
    cost: { gold: 100, wood: 16, stone: 26 },
    baseBuildTime: 22,
    yields: { knowledge: .18, prestige: .04 },
    maxLevel: 2,
    health: 162,
    terrain: [],
    minEra: 1,
    requiredWorkers: 1
  },
  harbor: {
    name: 'Караванный порт', icon: '🐪', model: 'port.glb', category: 'economy',
    desc: 'Торговый узел у реки; особенно силён при соединении дорогой с рынком.',
    cost: { gold: 88, wood: 20, stone: 14 },
    baseBuildTime: 18,
    yields: { gold: 1.0, prestige: .05 },
    maxLevel: 2,
    health: 145,
    terrain: [],
    minEra: 1,
    requiredWorkers: 1
  },
  wonder: {
    name: 'Чудо света', icon: '✨', model: 'wonder.glb', category: 'culture',
    desc: 'Мирный финал кампании и главный символ державы.',
    cost: { gold: 210, wood: 40, stone: 120 },
    baseBuildTime: 48,
    yields: { prestige: .4, stability: .14, knowledge: .14 },
    maxLevel: 1,
    health: 320,
    terrain: [],
    minEra: 2,
    requiredWorkers: 2
  }
};

export const UNITS = {
  worker: {
    name: 'Рабочий', icon: '🧑‍🌾', trainTime: 8,
    cost: { food: 8 }, speed: 2.65, hp: 38, attack: 1, range: 0.7, armor: 0, sight: 7, role: 'worker'
  },
  militia: {
    name: 'Ополченец', icon: '🗡️', trainTime: 9,
    cost: { gold: 16, food: 7 }, speed: 2.25, hp: 58, attack: 5.5, range: 0.9, armor: 1, sight: 9, role: 'melee'
  },
  archer: {
    name: 'Лучник', icon: '🏹', trainTime: 11,
    cost: { gold: 22, food: 8 }, speed: 2.05, hp: 44, attack: 6, range: 4.8, armor: 0, sight: 11, minEra: 1, role: 'ranged'
  },
  swordsman: {
    name: 'Мечник', icon: '⚔️', trainTime: 12,
    cost: { gold: 28, food: 10 }, speed: 2.15, hp: 82, attack: 8, range: 0.95, armor: 2, sight: 9,
    minEra: 1, role: 'melee'
  },
  raider: {
    name: 'Налётчик', icon: '🔥', trainTime: 0,
    cost: {}, speed: 2.0, hp: 46, attack: 6, range: .8, armor: 0, sight: 9, hostile: true, role: 'melee', faction: 'clans'
  },
  raiderArcher: {
    name: 'Налётчик-лучник', icon: '🏹', trainTime: 0,
    cost: {}, speed: 1.95, hp: 38, attack: 5, range: 4.4, armor: 0, sight: 11, hostile: true, role: 'ranged', faction: 'clans'
  },
  brute: {
    name: 'Крушитель', icon: '🪓', trainTime: 0,
    cost: {}, speed: 1.55, hp: 104, attack: 10, range: 1.0, armor: 3, sight: 8, hostile: true, role: 'siege', faction: 'iron'
  },
  wolfRider: {
    name: 'Волк-налётчик', icon: '🐺', trainTime: 0,
    cost: {}, speed: 2.7, hp: 54, attack: 7, range: .9, armor: 1, sight: 10, hostile: true, role: 'melee', faction: 'beasts'
  }
};



export const DECOR_MODELS = {
  tree: { file: 'trees.glb', scale: 0.72, y: 0.0, root: 'decor' },
  oak: { file: 'trees.glb', scale: 0.84, y: 0.0, root: 'decor' },
  pine: { file: 'pine-trees.glb', scale: 0.8, y: 0.0, root: 'decor' },
  pineAlt: { file: 'pine-trees-alt.glb', scale: 0.82, y: 0.0, root: 'decor' },
  pineRound: { file: 'pine-trees.glb', scale: 0.66, y: 0.0, root: 'decor' },
  rocks: { file: 'rocks.glb', scale: 0.46, y: 0.0, root: 'decor' },
  goldRock: { file: 'gold-rocks.glb', scale: 0.38, y: 0.0, root: 'decor' },
  logs: { file: 'logs.glb', scale: 0.38, y: 0.0, root: 'decor' },
  hut: { file: 'hut.glb', scale: 0.72, y: 0.0, root: 'decor' },
  shack: { file: 'shack.glb', scale: 0.7, y: 0.0, root: 'decor' },
  house: { file: 'house.glb', scale: 0.68, y: 0.0, root: 'decor' },
  mountain: { file: 'mountain.glb', scale: 1.45, y: 0.0, root: 'decor' },
  mountainGroup: { file: 'mountain-group.glb', scale: 1.8, y: 0.0, root: 'decor' },
  watchTower: { file: 'small-watch-tower.glb', scale: 0.74, y: 0.0, root: 'decor' },
  encampment: { file: 'wooden-encampment.glb', scale: 0.86, y: 0.0, root: 'decor' }
};

export const UNIT_MODEL_MAP = {
  // Normalized to readable in-game size; the previous 0.17 heights made trained soldiers nearly invisible on many GLTF exports.
  worker: { file: 'monk.gltf', targetHeight: 0.78, y: 0.0, rotY: Math.PI, faceOffset: Math.PI },
  militia: { file: 'warrior.gltf', targetHeight: 0.94, y: 0.0, rotY: Math.PI, faceOffset: Math.PI },
  archer: { file: 'ranger.gltf', targetHeight: 0.9, y: 0.0, rotY: Math.PI, faceOffset: Math.PI },
  swordsman: { file: 'rogue.gltf', targetHeight: 0.94, y: 0.0, rotY: Math.PI, faceOffset: Math.PI },
  raider: { file: 'rogue.gltf', targetHeight: 0.92, y: 0.0, rotY: Math.PI, faceOffset: Math.PI },
  raiderArcher: { file: 'ranger.gltf', targetHeight: 0.9, y: 0.0, rotY: Math.PI, faceOffset: Math.PI },
  brute: { file: 'warrior.gltf', targetHeight: 1.14, y: 0.0, rotY: Math.PI, faceOffset: Math.PI },
  wolfRider: { file: 'wizard.gltf', targetHeight: 1.02, y: 0.0, rotY: Math.PI, faceOffset: Math.PI },
};

export const UNIT_VISUALS = {
  worker: { bounce: 0.02, bobSpeed: 5.5, lean: 0.08, weapon: 'staff', ring: 0x7ac7ff, silhouette: 0x7ba06d },
  militia: { bounce: 0.03, bobSpeed: 7.2, lean: 0.16, weapon: 'sword', ring: 0xffd66b, silhouette: 0xa88a5a },
  archer: { bounce: 0.028, bobSpeed: 7.0, lean: 0.12, weapon: 'bow', ring: 0xffd66b, silhouette: 0x8e7b58 },
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

export const CAMPAIGN_CHAPTERS = [
  { name: 'I. Долина', desc: 'Накорми поселенцев и запусти три главных промысла.' },
  { name: 'II. Рубеж', desc: 'Создай оборону, постоянное войско и отбей первый лагерь.' },
  { name: 'III. Золотой путь', desc: 'Соедини знания, торговлю и престиж зрелой державы.' },
  { name: 'IV. Наследие', desc: 'Выбери финал: возведи Чудо или уничтожь все вражеские лагеря.' },
];

export const OBJECTIVES = [
  { id: 'first_economy', chapter: 0, title: 'Запустить ферму, лесопилку и шахту', target: 3, metric: 'economyReady', reward: { gold: 30, stability: 5 } },
  { id: 'food_reserve', chapter: 0, title: 'Накопить 160 еды', target: 160, metric: 'food', reward: { prestige: 8 } },
  { id: 'settlers', chapter: 0, title: 'Увеличить население до 7', target: 7, metric: 'population', reward: { wood: 25 } },
  { id: 'fortify', chapter: 1, title: 'Построить две оборонные постройки', target: 2, metric: 'defensiveBuildings', reward: { stone: 35 } },
  { id: 'standing_army', chapter: 1, title: 'Собрать отряд из 4 воинов', target: 4, metric: 'armyUnits', reward: { gold: 45, stability: 6 } },
  { id: 'first_camp', chapter: 1, title: 'Разрушить один вражеский лагерь', target: 1, metric: 'campsDestroyed', reward: { knowledge: 22, prestige: 12 } },
  { id: 'wisdom', chapter: 2, title: 'Изучить три технологии', target: 3, metric: 'learnedTechs', reward: { gold: 60 } },
  { id: 'golden_route', chapter: 2, title: 'Построить рынок и караванный порт', target: 2, metric: 'tradeBuildings', reward: { prestige: 18, stability: 8 } },
  { id: 'renown', chapter: 2, title: 'Достичь 60 престижа', target: 60, metric: 'prestige', reward: { knowledge: 28 } },
  { id: 'wonder', chapter: 3, branch: 'wonder', title: 'Мирный путь: возвести Чудо света', target: 1, metric: 'wonderBuilt', reward: { prestige: 40, stability: 20 } },
  { id: 'conquest', chapter: 3, branch: 'conquest', title: 'Военный путь: уничтожить все лагеря', target: 0, metric: 'enemyCampsRemaining', comparator: 'lte', reward: { prestige: 40, stability: 12 } },
];

export const WEATHER_TYPES = {
  clear: { name: 'Ясно', label: 'Ясно', food: 1.0, move: 1.0 },
  rain: { name: 'Дождь', label: 'Дождь', food: 0.8, move: 0.75 },
  mist: { name: 'Туман', label: 'Туман', food: 1.0, move: 0.9 },
  dust: { name: 'Буря', label: 'Буря', food: 0.5, move: 0.5 },
  snow: { name: 'Снег', label: 'Снег', food: 0.2, move: 0.4 }
};
