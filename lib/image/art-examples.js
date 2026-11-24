export const examples = [
  { name: 'Midnight Flow', image: 'midnight-flow', brief: 'A midnight-blue jazz poster with flowing lines and room for a title at the top', settings: { pattern: 'flow', palette: 'midnight', seed: 4173, density: 67, size: '1080x1350', composition: 'top', parameters: { direction: 65, turbulence: 63, trail: 75 } } },
  { name: 'Violet Waves', image: 'violet-waves', brief: 'Overlapping violet waves for a square album cover', settings: { pattern: 'interference', palette: 'violet', seed: 9204, density: 72, size: '1080x1080', parameters: { frequency: 69, angle: 62, spacing: 68 } } },
  { name: 'Copper Canopy', image: 'copper-canopy', brief: 'A copper branching form for a landscape banner', settings: { pattern: 'branches', palette: 'clay', seed: 10538, density: 88, size: '1920x1080', parameters: { angle: 41, spread: 85, depth: 83 } } },
];

export const curatedSeeds = {
  flow: [4173, 233088, 129050, 143237, 266191, 247275],
  interference: [9204, 261462, 214172, 105405, 195256, 176340],
  branches: [10538, 86489, 252004, 422248, 67573, 39199],
};
