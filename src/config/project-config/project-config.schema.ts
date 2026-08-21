import { z } from "zod";

/**
 * Kebab-case project IDs: lowercase alphanumeric segments separated by hyphens.
 * Examples: kygo, clubsync, project-a
 */
export const PROJECT_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const JiraConfigSchema = z
  .object({
    projectKey: z.string().trim().min(1, "Jira projectKey must be a non-empty string"),
  })
  .strict();

export const GithubConfigSchema = z
  .object({
    organization: z
      .string()
      .trim()
      .min(1, "GitHub organization must be a non-empty string"),
    repositories: z
      .array(z.string().trim().min(1, "GitHub repository name must be a non-empty string"))
      .min(1, "Expected at least one repository"),
  })
  .strict();

export const ConfluenceConfigSchema = z
  .object({
    spaceKey: z.string().trim().min(1, "Confluence spaceKey must be a non-empty string"),
  })
  .strict();

export const ProjectSettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .strict();

export const ProjectConfigSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1, "id is required")
      .regex(
        PROJECT_ID_PATTERN,
        "id must be lowercase kebab-case (e.g. kygo, clubsync, project-a)",
      ),
    name: z.string().trim().min(1, "name must be a non-empty string"),
    description: z.string().trim().min(1).optional(),
    jira: JiraConfigSchema.optional(),
    github: GithubConfigSchema.optional(),
    confluence: ConfluenceConfigSchema.optional(),
    settings: ProjectSettingsSchema.optional().default({ enabled: true }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.jira && !value.github && !value.confluence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one of jira, github, or confluence must be defined",
        path: [],
      });
    }
  });

export type ProjectConfigInput = z.input<typeof ProjectConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type JiraConfig = z.infer<typeof JiraConfigSchema>;
export type GithubConfig = z.infer<typeof GithubConfigSchema>;
export type ConfluenceConfig = z.infer<typeof ConfluenceConfigSchema>;
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
