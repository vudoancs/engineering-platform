import { UnauthorizedCostViewError } from "./cost-errors.js";
import type { CostViewer } from "./cost.types.js";

/**
 * Authorization for cost reports. Do not scatter role checks.
 */
export class CostAuthorizationService {
  canViewGlobal(viewer: CostViewer): boolean {
    return viewer.role === "engineering-manager" || viewer.role === "system";
  }

  canViewProject(viewer: CostViewer, _projectId: string): boolean {
    return viewer.role === "engineering-manager" || viewer.role === "system";
  }

  canViewAgent(viewer: CostViewer, _agentId: string): boolean {
    return viewer.role === "engineering-manager" || viewer.role === "system";
  }

  canViewMember(viewer: CostViewer, memberId: string): boolean {
    if (viewer.role === "engineering-manager" || viewer.role === "system") {
      return true;
    }
    return viewer.memberId !== undefined && viewer.memberId === memberId;
  }

  canViewProvider(viewer: CostViewer): boolean {
    return viewer.role === "engineering-manager" || viewer.role === "system";
  }

  assertCanViewGlobal(viewer: CostViewer): void {
    if (!this.canViewGlobal(viewer)) {
      throw new UnauthorizedCostViewError(
        "Only engineering managers may view global AI cost",
      );
    }
  }

  assertCanViewProject(viewer: CostViewer, projectId: string): void {
    if (!this.canViewProject(viewer, projectId)) {
      throw new UnauthorizedCostViewError(
        "Not authorized to view project AI cost",
        { projectId },
      );
    }
  }

  assertCanViewMember(viewer: CostViewer, memberId: string): void {
    if (!this.canViewMember(viewer, memberId)) {
      throw new UnauthorizedCostViewError(
        "Not authorized to view another member's AI cost",
        { memberId },
      );
    }
  }

  assertCanViewAgent(viewer: CostViewer, agentId: string): void {
    if (!this.canViewAgent(viewer, agentId)) {
      throw new UnauthorizedCostViewError(
        "Not authorized to view agent AI cost",
        { agentId },
      );
    }
  }

  assertCanViewProvider(viewer: CostViewer): void {
    if (!this.canViewProvider(viewer)) {
      throw new UnauthorizedCostViewError(
        "Not authorized to view provider AI cost",
      );
    }
  }
}
