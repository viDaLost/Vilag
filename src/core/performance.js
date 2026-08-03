const PROFILES = {
  mobile: {
    name: 'mobile', pixelRatio: 1, terrainSegments: 92, shadows: false,
    shadowMapSize: 512, bloom: false, decorLimit: 82, mountainCount: 7,
    cloudCount: 4, starCount: 64,
  },
  tablet: {
    name: 'tablet', pixelRatio: 1.2, terrainSegments: 116, shadows: true,
    shadowMapSize: 768, bloom: false, decorLimit: 118, mountainCount: 9,
    cloudCount: 6, starCount: 90,
  },
  desktop: {
    name: 'desktop', pixelRatio: 1.5, terrainSegments: 156, shadows: true,
    shadowMapSize: 1536, bloom: true, decorLimit: 168, mountainCount: 12,
    cloudCount: 8, starCount: 120,
  },
};

export function detectQualityProfile(preference = 'auto') {
  if (preference && preference !== 'auto' && PROFILES[preference]) return { ...PROFILES[preference] };
  const width = window.innerWidth || 1280;
  const height = window.innerHeight || 720;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (width <= 640 || memory <= 2 || cores <= 2) return { ...PROFILES.mobile };
  if (coarse || width <= 1100 || width * height < 1_000_000 || memory <= 4) return { ...PROFILES.tablet };
  return { ...PROFILES.desktop };
}

export function createPerformanceGovernor(sceneCtx, profile) {
  let elapsed = 0;
  let frames = 0;
  let lowFpsWindows = 0;
  let currentRatio = Math.min(window.devicePixelRatio || 1, profile.pixelRatio);

  return {
    sample(dt) {
      elapsed += Math.min(dt, 0.2);
      frames += 1;
      if (elapsed < 4) return null;
      const fps = frames / elapsed;
      elapsed = 0;
      frames = 0;
      if (fps < 30) lowFpsWindows += 1; else lowFpsWindows = Math.max(0, lowFpsWindows - 1);
      if (lowFpsWindows < 2 || currentRatio <= 0.76) return fps;
      currentRatio = Math.max(0.75, currentRatio - 0.2);
      sceneCtx.renderer.shadowMap.enabled = false;
      sceneCtx.setPixelRatio(currentRatio);
      lowFpsWindows = 0;
      return fps;
    },
    get pixelRatio() { return currentRatio; },
  };
}

export function listQualityProfiles() {
  return Object.values(PROFILES).map((profile) => ({ ...profile }));
}
