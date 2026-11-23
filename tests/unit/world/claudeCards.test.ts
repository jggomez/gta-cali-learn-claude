import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CLAUDE_CARD_SPOTS } from '../../../src/config/claudeCardSpots';
import {
  CLAUDE_CARDS_GROUP_NAME,
  CLAUDE_CARD_HOVER_HEIGHT,
  CLAUDE_CARD_MESH_COUNT,
  buildClaudeCards,
  createClaudeCardTexture,
} from '../../../src/world/claudeCards';

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      found.push(node);
    }
  });
  return found;
}

describe('buildClaudeCards (headless)', () => {
  it('builds one named, positioned node per spot with the expected mesh count', () => {
    const cards = buildClaudeCards();
    expect(cards.group.name).toBe(CLAUDE_CARDS_GROUP_NAME);
    expect(cards.group.children.length).toBe(CLAUDE_CARD_SPOTS.length);
    expect(meshes(cards.group).length).toBe(CLAUDE_CARD_SPOTS.length * CLAUDE_CARD_MESH_COUNT);
    for (const spot of CLAUDE_CARD_SPOTS) {
      const node = cards.group.getObjectByName(`claude_card_${spot.id}`);
      expect(node, spot.id).toBeDefined();
      expect(node!.position.x).toBeCloseTo(spot.x);
      expect(node!.position.z).toBeCloseTo(spot.z);
    }
    cards.dispose();
  });

  it('floats a ~0.9 x 1.25 m emissive card ~1.4 m up, with a beam, opted out of batching', () => {
    const cards = buildClaudeCards();
    const id = CLAUDE_CARD_SPOTS[0]!.id;
    const front = cards.group.getObjectByName(`claude_card_${id}_front`) as THREE.Mesh;
    const params = (front.geometry as THREE.PlaneGeometry).parameters;
    expect(params.width).toBeCloseTo(0.9);
    expect(params.height).toBeCloseTo(1.25);
    const spinner = front.parent!;
    expect(spinner.position.y).toBeCloseTo(CLAUDE_CARD_HOVER_HEIGHT);
    const material = front.material as THREE.MeshStandardMaterial;
    expect(material.emissiveMap).toBe(material.map);
    expect(material.emissiveIntensity).toBeGreaterThan(0.5);
    const beam = cards.group.getObjectByName(`claude_card_${id}_beam`) as THREE.Mesh;
    const beamBox = new THREE.Box3().setFromObject(beam);
    expect(beamBox.max.y - beamBox.min.y).toBeGreaterThan(10);
    for (const mesh of meshes(cards.group)) {
      expect(mesh.userData.noStaticBatch, mesh.name).toBe(true);
    }
    cards.dispose();
  });

  it('hides collected cards and shows them again when un-collected', () => {
    const cards = buildClaudeCards();
    cards.setCollected(new Set(['card_mcp', 'card_hooks']));
    for (const spot of CLAUDE_CARD_SPOTS) {
      const node = cards.group.getObjectByName(`claude_card_${spot.id}`)!;
      expect(node.visible, spot.id).toBe(spot.id !== 'card_mcp' && spot.id !== 'card_hooks');
    }
    cards.setCollected(new Set());
    expect(cards.group.children.every((node) => node.visible)).toBe(true);
    cards.dispose();
  });

  it('spins and bobs visible cards in update(dt) and ignores invalid dt', () => {
    const cards = buildClaudeCards();
    const spinner = cards.group.getObjectByName(`claude_card_${CLAUDE_CARD_SPOTS[1]!.id}_spinner`)!;
    const startYaw = spinner.rotation.y;
    cards.update(Number.NaN);
    cards.update(-1);
    expect(spinner.rotation.y).toBe(startYaw);
    cards.update(0.5);
    expect(spinner.rotation.y).toBeGreaterThan(startYaw);
    expect(spinner.position.y).not.toBeCloseTo(CLAUDE_CARD_HOVER_HEIGHT, 3);
    expect(Math.abs(spinner.position.y - CLAUDE_CARD_HOVER_HEIGHT)).toBeLessThanOrEqual(0.2);

    cards.setCollected(new Set([CLAUDE_CARD_SPOTS[1]!.id]));
    const hiddenYaw = spinner.rotation.y;
    cards.update(0.5);
    expect(spinner.rotation.y).toBe(hiddenYaw);
    cards.dispose();
  });

  it('accepts a custom spot list and falls back to a DataTexture without a 2D canvas', () => {
    const cards = buildClaudeCards([{ id: 'card_mcp', x: 0, z: 0 }]);
    expect(cards.group.children.length).toBe(1);
    expect(createClaudeCardTexture(0, 10)).toBeInstanceOf(THREE.Texture);
    const parent = new THREE.Group();
    parent.add(cards.group);
    cards.dispose();
    expect(cards.group.parent).toBeNull();
  });
});
