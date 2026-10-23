import * as THREE from 'three';

// Per-part (structure × tissue) render state, stored in small float textures
// that the layer shaders read with texelFetch(partId).
export const TEX_WIDTH = 256;

export const MODE = { normal: 0, hover: 1, select: 2, ghost: 3 };

function makeTexture(height) {
  const data = new Float32Array(TEX_WIDTH * height * 4);
  const tex = new THREE.DataTexture(data, TEX_WIDTH, height, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export class PartStore {
  constructor(count) {
    const h = Math.max(1, Math.ceil(count / TEX_WIDTH));
    this.count = count;
    this.color = makeTexture(h); // rgb (linear), a = roughness
    this.state = makeTexture(h); // r = visible, g = mode, b = base opacity
    this.offset = makeTexture(h); // xyz = explode offset (world units)
    this.xray = makeTexture(h); // r = signed density, g = thin sheet, b = channel (0 tissue, 1 skin hull, -1 none)
    this.uniforms = {
      tPartColor: { value: this.color },
      tPartState: { value: this.state },
      tPartOffset: { value: this.offset },
      tPartXray: { value: this.xray },
    };
  }

  setColor(id, c, roughness) {
    const d = this.color.image.data;
    d[id * 4] = c.r; d[id * 4 + 1] = c.g; d[id * 4 + 2] = c.b; d[id * 4 + 3] = roughness;
    this.color.needsUpdate = true;
  }

  setState(id, visible, mode, opacity) {
    const d = this.state.image.data;
    d[id * 4] = visible ? 1 : 0; d[id * 4 + 1] = mode; d[id * 4 + 2] = opacity;
    this.state.needsUpdate = true;
  }

  setVisible(id, visible) {
    this.state.image.data[id * 4] = visible ? 1 : 0;
    this.state.needsUpdate = true;
  }

  setMode(id, mode) {
    this.state.image.data[id * 4 + 1] = mode;
    this.state.needsUpdate = true;
  }

  setOffset(id, x, y, z) {
    const d = this.offset.image.data;
    d[id * 4] = x; d[id * 4 + 1] = y; d[id * 4 + 2] = z;
    this.offset.needsUpdate = true;
  }

  setXray(id, density, sheet, channel) {
    const d = this.xray.image.data;
    d[id * 4] = density; d[id * 4 + 1] = sheet ? 1 : 0; d[id * 4 + 2] = channel;
    this.xray.needsUpdate = true;
  }
}

// GLSL shared by every shader that draws layer meshes.
export const PART_VERTEX_PARS = /* glsl */`
attribute float partId;
uniform sampler2D tPartColor;
uniform sampler2D tPartState;
uniform sampler2D tPartOffset;
uniform sampler2D tPartXray;
ivec2 partCoord(float id) {
  int i = int(id + 0.5);
  return ivec2(i % ${TEX_WIDTH}, i / ${TEX_WIDTH});
}
`;
