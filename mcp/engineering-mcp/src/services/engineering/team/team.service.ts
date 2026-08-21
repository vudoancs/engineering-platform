import type { GitHubService } from "../../../integrations/github/github.service.js";
import type { JiraService } from "../../../integrations/jira/jira.service.js";
import {
  classifyIssueBucket,
  isExplicitlyBlocked,
  isDoneStatus,
} from "../engineering.mapper.js";
import type { SourceHealthMap, UnknownSection } from "../engineering.types.js";
import { settleSource } from "../source-health.js";

export interface TeamMemberWork {
  assigned: number;
  completed: number;
  inProgress: number;
  blocked: number;
}

export interface TeamMemberDelivery {
  commits?: number;
  pullRequests?: number;
  mergedPullRequests?: number;
}

export interface TeamMember {
  identity: string;
  jiraUsername?: string;
  githubUsername?: string;
  work: TeamMemberWork;
  delivery: TeamMemberDelivery;
}

export interface TeamStatus {
  projectId: string;
  members: TeamMember[];
  note: string;
  sources: SourceHealthMap;
  work?: UnknownSection;
  delivery?: UnknownSection;
}

export interface TeamServiceOptions {
  jira: JiraService | null;
  github: GitHubService | null;
}

/**
 * Operational team aggregation only — no performance ranking or scores.
 */
export class TeamService {
  private readonly jira: JiraService | null;
  private readonly github: GitHubService | null;

  constructor(options: TeamServiceOptions) {
    this.jira = options.jira;
    this.github = options.github;
  }

  async getTeamStatus(projectId: string): Promise<TeamStatus> {
    const [jiraSettled, githubSettled] = await Promise.all([
      settleSource(Boolean(this.jira?.isConfigured()), "Jira not configured", async () => {
        const result = await this.jira!.searchIssues(projectId, undefined, 50);
        return result.issues;
      }),
      settleSource(Boolean(this.github?.isConfigured()), "GitHub not configured", async () => {
        const repos = await this.github!.getRepositories(projectId);
        const contributors: Array<{ login: string; contributions: number }> = [];
        const prAuthors = new Map<string, { open: number; merged: number }>();

        for (const repo of repos.repositories) {
          const contrib = await this.github!.getContributors(projectId, repo.name, {
            perPage: 30,
          });
          for (const c of contrib.contributors) {
            const existing = contributors.find((x) => x.login === c.login);
            if (existing) {
              existing.contributions += c.contributions;
            } else {
              contributors.push({ login: c.login, contributions: c.contributions });
            }
          }

          const [open, closed] = await Promise.all([
            this.github!.listPullRequests(projectId, repo.name, { state: "open", perPage: 20 }),
            this.github!.listPullRequests(projectId, repo.name, { state: "closed", perPage: 20 }),
          ]);
          for (const pr of open.pullRequests) {
            if (!pr.author) continue;
            const cur = prAuthors.get(pr.author) ?? { open: 0, merged: 0 };
            cur.open += 1;
            prAuthors.set(pr.author, cur);
          }
          for (const pr of closed.pullRequests) {
            if (!pr.author || !pr.mergedAt) continue;
            const cur = prAuthors.get(pr.author) ?? { open: 0, merged: 0 };
            cur.merged += 1;
            prAuthors.set(pr.author, cur);
          }
        }

        return { contributors, prAuthors };
      }),
    ]);

    const sources: SourceHealthMap = {
      jira: jiraSettled.health,
      github: githubSettled.health,
      confluence: "not_configured",
    };

    const membersByKey = new Map<string, TeamMember>();

    if (jiraSettled.data) {
      for (const issue of jiraSettled.data) {
        const name = issue.assignee?.trim();
        if (!name) {
          continue;
        }
        const key = `jira:${name.toLowerCase()}`;
        const member =
          membersByKey.get(key) ??
          ({
            identity: name,
            jiraUsername: name,
            work: { assigned: 0, completed: 0, inProgress: 0, blocked: 0 },
            delivery: {},
          } satisfies TeamMember);
        member.work.assigned += 1;
        const bucket = classifyIssueBucket(issue);
        if (bucket === "done") {
          member.work.completed += 1;
        } else if (bucket === "inProgress") {
          member.work.inProgress += 1;
        } else if (bucket === "blocked" || isExplicitlyBlocked(issue)) {
          if (!isDoneStatus(issue)) {
            member.work.blocked += 1;
          }
        }
        membersByKey.set(key, member);
      }
    }

    if (githubSettled.data) {
      for (const c of githubSettled.data.contributors) {
        const key = `github:${c.login.toLowerCase()}`;
        const existingJira = [...membersByKey.values()].find(
          (m) => m.jiraUsername?.toLowerCase() === c.login.toLowerCase(),
        );
        if (existingJira) {
          existingJira.githubUsername = c.login;
          existingJira.delivery = {
            ...existingJira.delivery,
            commits: c.contributions,
          };
          const prStats = githubSettled.data.prAuthors.get(c.login);
          if (prStats) {
            existingJira.delivery.pullRequests = prStats.open;
            existingJira.delivery.mergedPullRequests = prStats.merged;
          }
          continue;
        }

        const prStats = githubSettled.data.prAuthors.get(c.login);
        const member: TeamMember = {
          identity: c.login,
          githubUsername: c.login,
          work: { assigned: 0, completed: 0, inProgress: 0, blocked: 0 },
          delivery: {
            commits: c.contributions,
            ...(prStats ? { pullRequests: prStats.open, mergedPullRequests: prStats.merged } : {}),
          },
        };
        membersByKey.set(key, member);
      }

      // Authors with PRs but not in contributors list
      for (const [login, stats] of githubSettled.data.prAuthors) {
        const exists = [...membersByKey.values()].some(
          (m) => m.githubUsername?.toLowerCase() === login.toLowerCase(),
        );
        if (exists) {
          continue;
        }
        membersByKey.set(`github:${login.toLowerCase()}`, {
          identity: login,
          githubUsername: login,
          work: { assigned: 0, completed: 0, inProgress: 0, blocked: 0 },
          delivery: {
            pullRequests: stats.open,
            mergedPullRequests: stats.merged,
          },
        });
      }
    }

    const result: TeamStatus = {
      projectId,
      members: [...membersByKey.values()].sort((a, b) => a.identity.localeCompare(b.identity)),
      note: "Operational workload and delivery activity only. Not a performance evaluation.",
      sources,
    };

    if (jiraSettled.health !== "ok" && jiraSettled.health !== "not_configured") {
      result.work = { status: "unknown", reason: jiraSettled.reason ?? "Jira unavailable" };
    }
    if (githubSettled.health !== "ok" && githubSettled.health !== "not_configured") {
      result.delivery = {
        status: "unknown",
        reason: githubSettled.reason ?? "GitHub unavailable",
      };
    }

    return result;
  }
}
