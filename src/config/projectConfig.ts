import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

const CONFIG_FILE = "ai-agent.config.json";

const projectConfigSchema = z.object({
  jiraBaseUrl: z.string().url().optional(),
  jiraProjectKey: z.string().optional(),
  githubRepo: z.string().optional(),
  allowedPaths: z.array(z.string()).optional(),
  model: z.string().optional(),
  runStorageDir: z.string().optional(),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export function loadProjectConfig(rootDir?: string): ProjectConfig {
  let current = resolve(rootDir ?? process.cwd());

  while (true) {
    const configPath = join(current, CONFIG_FILE);

    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        const result = projectConfigSchema.safeParse(parsed);

        if (result.success) {
          return result.data;
        }

        if (process.env.LOG_LEVEL === "debug") {
          console.error(
            `[projectConfig] ${configPath} failed validation and was ignored: ${result.error.message}`,
          );
        }
      } catch (error) {
        if (process.env.LOG_LEVEL === "debug") {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[projectConfig] Failed to read ${configPath}: ${message}`);
        }
      }
    }

    const parent = resolve(current, "..");

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return {};
}

let _config: ProjectConfig | undefined;

export function getProjectConfig(): ProjectConfig {
  if (!_config) {
    _config = loadProjectConfig();
  }

  return _config;
}
