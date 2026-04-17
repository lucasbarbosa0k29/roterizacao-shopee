import fs from "fs/promises";
import path from "path";

function getJobsDir() {
  const configured = String(process.env.JOB_STORAGE_DIR || "").trim();
  if (configured) return path.resolve(configured);

  if (process.platform === "win32") {
    return path.resolve(process.cwd(), "tmp", "jobs");
  }

  return path.resolve("/tmp", "jobs");
}

function makeSafeFilename(jobId: string) {
  const safe = String(jobId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_");

  return `${safe || "job"}.json`;
}

function ensureManagedPath(baseDir: string, filePath: string) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(baseDir, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid job result path.");
  }

  return resolved;
}

export async function saveJobResult(jobId: string, data: any): Promise<string> {
  const jobsDir = getJobsDir();
  await fs.mkdir(jobsDir, { recursive: true });

  const filePath = path.join(jobsDir, makeSafeFilename(jobId));
  await fs.writeFile(filePath, JSON.stringify(data), "utf8");

  return filePath;
}

export async function loadJobResult(filePath: string): Promise<any> {
  const jobsDir = getJobsDir();
  await fs.mkdir(jobsDir, { recursive: true });

  const safePath = ensureManagedPath(jobsDir, filePath);
  const raw = await fs.readFile(safePath, "utf8");
  return JSON.parse(raw);
}

export async function deleteJobResult(filePath: string): Promise<void> {
  const jobsDir = getJobsDir();
  await fs.mkdir(jobsDir, { recursive: true });

  const safePath = ensureManagedPath(jobsDir, filePath);

  try {
    await fs.unlink(safePath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}
