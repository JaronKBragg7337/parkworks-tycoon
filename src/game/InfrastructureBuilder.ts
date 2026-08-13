import type { GridCell, WalkableSurface } from '../core/ParkGrid';

export type InfrastructureTool = WalkableSurface | 'demolish';

function key(cell: GridCell): string {
  return `${cell.x},${cell.z}`;
}

/** Integer grid line that keeps fast drags continuous on both mouse and touch. */
export function cellsAlongLine(start: GridCell, end: GridCell): readonly GridCell[] {
  const cells: GridCell[] = [];
  let x = start.x;
  let z = start.z;
  const dx = Math.abs(end.x - start.x);
  const dz = Math.abs(end.z - start.z);
  const stepX = start.x < end.x ? 1 : -1;
  const stepZ = start.z < end.z ? 1 : -1;
  let error = dx - dz;

  while (true) {
    cells.push({ x, z });
    if (x === end.x && z === end.z) break;
    const doubled = error * 2;
    if (doubled > -dz) {
      error -= dz;
      x += stepX;
    }
    if (doubled < dx) {
      error += dx;
      z += stepZ;
    }
  }
  return cells;
}

export class InfrastructureBuilder {
  private readonly selected = new Map<string, GridCell>();
  private lastCell: GridCell | null = null;
  private currentTool: InfrastructureTool | null = null;

  get tool(): InfrastructureTool | null {
    return this.currentTool;
  }

  get cells(): readonly GridCell[] {
    return [...this.selected.values()];
  }

  begin(tool: InfrastructureTool): void {
    this.currentTool = tool;
    this.clear();
  }

  startStroke(cell: GridCell): void {
    if (!this.currentTool) return;
    this.lastCell = { ...cell };
    this.selected.set(key(cell), { ...cell });
  }

  extendStroke(cell: GridCell): void {
    if (!this.currentTool) return;
    const from = this.lastCell ?? cell;
    for (const candidate of cellsAlongLine(from, cell)) {
      this.selected.set(key(candidate), { ...candidate });
    }
    this.lastCell = { ...cell };
  }

  endStroke(): void {
    this.lastCell = null;
  }

  clear(): void {
    this.selected.clear();
    this.lastCell = null;
  }

  cancel(): void {
    this.currentTool = null;
    this.clear();
  }
}
