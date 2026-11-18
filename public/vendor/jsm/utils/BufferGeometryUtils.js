import { TriangleFanDrawMode, TriangleStripDrawMode, TrianglesDrawMode } from 'three';

function toTrianglesDrawMode(geometry, drawMode) {
  if (drawMode === TrianglesDrawMode) return geometry;
  if (drawMode !== TriangleStripDrawMode && drawMode !== TriangleFanDrawMode) {
    throw new Error('Unsupported draw mode: ' + drawMode);
  }

  const result = geometry.clone();
  const source = result.getIndex();
  const vertices = source
    ? Array.from(source.array)
    : Array.from({ length: result.getAttribute('position').count }, (_, i) => i);
  const indices = [];

  if (drawMode === TriangleFanDrawMode) {
    for (let i = 1; i < vertices.length - 1; i++) {
      indices.push(vertices[0], vertices[i], vertices[i + 1]);
    }
  } else {
    for (let i = 0; i < vertices.length - 2; i++) {
      const a = vertices[i], b = vertices[i + 1], c = vertices[i + 2];
      if (a === b || b === c || a === c) continue;
      if (i % 2 === 0) indices.push(a, b, c);
      else indices.push(b, a, c);
    }
  }

  result.setIndex(indices);
  result.clearGroups();
  return result;
}

export { toTrianglesDrawMode };
