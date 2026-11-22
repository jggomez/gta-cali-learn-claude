import { describe, expect, it } from 'vitest';
import { RenderStatsRecorder } from '../../../src/world/renderStats';

function createInfo() {
  return {
    autoReset: true,
    render: { calls: 0, triangles: 0 },
    memory: { geometries: 12, textures: 7 },
    programs: [{}, {}, {}] as unknown[],
    reset(): void {
      this.render.calls = 0;
      this.render.triangles = 0;
    },
  };
}

describe('RenderStatsRecorder', () => {
  it('disables autoReset so multi-pass composer frames accumulate draw calls', () => {
    const info = createInfo();
    new RenderStatsRecorder(info);
    expect(info.autoReset).toBe(false);
  });

  it('captures accumulated calls/triangles of the whole frame and resets for the next one', () => {
    const info = createInfo();
    const recorder = new RenderStatsRecorder(info);

    recorder.beginFrame();
    info.render.calls += 400;
    info.render.triangles += 90_000;
    info.render.calls += 3; // post-processing passes
    info.render.triangles += 6;
    recorder.endFrame();

    expect(recorder.getStats()).toEqual({
      drawCalls: 403,
      triangles: 90_006,
      geometries: 12,
      textures: 7,
      programs: 3,
    });

    recorder.beginFrame();
    expect(info.render.calls).toBe(0);
  });

  it('returns zeros before the first frame completes', () => {
    const recorder = new RenderStatsRecorder(createInfo());
    expect(recorder.getStats().drawCalls).toBe(0);
  });
});
