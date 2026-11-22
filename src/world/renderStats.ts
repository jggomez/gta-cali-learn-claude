/**
 * Per-frame GPU workload telemetry built on a structural view of THREE.WebGLRenderer.info.
 * autoReset is disabled so draw calls issued by every post-processing pass of a frame
 * accumulate, and the frame totals are snapshotted when the frame ends.
 */

import type { RenderPerfStats } from '../types/game';

export interface RendererInfoLike {
  autoReset: boolean;
  readonly render: { readonly calls: number; readonly triangles: number };
  readonly memory: { readonly geometries: number; readonly textures: number };
  readonly programs: readonly unknown[] | null;
  reset(): void;
}

const EMPTY_STATS: RenderPerfStats = {
  drawCalls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
};

export class RenderStatsRecorder {
  private readonly info: RendererInfoLike;
  private stats: RenderPerfStats = EMPTY_STATS;

  public constructor(info: RendererInfoLike) {
    this.info = info;
    this.info.autoReset = false;
  }

  public beginFrame(): void {
    this.info.reset();
  }

  public endFrame(): void {
    this.stats = {
      drawCalls: this.info.render.calls,
      triangles: this.info.render.triangles,
      geometries: this.info.memory.geometries,
      textures: this.info.memory.textures,
      programs: this.info.programs?.length ?? 0,
    };
  }

  public getStats(): RenderPerfStats {
    return this.stats;
  }
}
