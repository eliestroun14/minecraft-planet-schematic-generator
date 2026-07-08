'use strict';

// Minimal sparse voxel grid. Deliberately compatible with schematic-writer.js's
// expectations (world.blocks is a "x,y,z" -> blockId Map, world.get/set,
// world.blockEntities, world.size) so that module can be reused unmodified.
class VoxelWorld {
  constructor() {
    this.blocks = new Map();
    this.blockEntities = new Map();
  }

  key(x, y, z) {
    return `${x},${y},${z}`;
  }

  set(x, y, z, blockId) {
    this.blocks.set(this.key(x, y, z), blockId);
  }

  get(x, y, z) {
    return this.blocks.get(this.key(x, y, z)) || 'minecraft:air';
  }

  setBlockEntity(x, y, z, data) {
    this.blockEntities.set(this.key(x, y, z), data);
  }

  get size() {
    return this.blocks.size;
  }

  // Highest non-air, non-liquid Y at (x,z), scanning downward from startY.
  // Used for surface decoration and passive-mob spawner placement.
  topSurfaceY(x, z, startY) {
    for (let y = startY; y > -startY; y--) {
      const id = this.get(x, y, z);
      if (id !== 'minecraft:air' && id !== 'minecraft:water' && id !== 'minecraft:lava') return y;
    }
    return null;
  }
}

module.exports = { VoxelWorld };
