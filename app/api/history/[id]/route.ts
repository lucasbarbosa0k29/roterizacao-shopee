// app/api/history/[id]/route.ts
export const runtime = "nodejs";

import { deleteJobResult, loadJobResult } from "@/app/lib/job-storage";
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth";
import { Prisma } from "@prisma/client";
import { cleanupOldImportJobsIfNeeded } from "@/app/lib/import-job-cleanup";

function normalizeResultJson(resultJson: any) {
  if (!resultJson) return null;

  if (Array.isArray(resultJson)) {
    return {
      version: 1,
      rows: resultJson,
      manualEdits: {},
      manualGroups: {},
      autoGrouped: false,
      autoBreakIds: [],
      groupMode: false,
      selectedIdxs: [],
      view: "results",
      name: null,
      updatedAtMs: Date.now(),
    };
  }

  if (typeof resultJson === "object") {
    const rows = (resultJson as any)?.rows;
    if (Array.isArray(rows)) return resultJson;
    return null;
  }

  return null;
}

function buildEmptyResultEnvelope() {
  return {
    version: 1,
    rows: [],
    manualEdits: {},
    manualGroups: {},
    autoGrouped: false,
    autoBreakIds: [],
    groupMode: false,
    selectedIdxs: [],
    view: "results",
    name: null,
    updatedAtMs: Date.now(),
  };
}

function normalizeWorkspaceJson(workspaceJson: any, fallbackResultJson?: any) {
  const legacy =
    !workspaceJson || typeof workspaceJson !== "object" || Array.isArray(workspaceJson)
      ? normalizeResultJson(fallbackResultJson)
      : null;

  const source =
    workspaceJson && typeof workspaceJson === "object" && !Array.isArray(workspaceJson)
      ? workspaceJson
      : legacy;

  return {
    version: 1,
    manualEdits:
      source?.manualEdits && typeof source.manualEdits === "object"
        ? source.manualEdits
        : {},
    manualGroups:
      source?.manualGroups && typeof source.manualGroups === "object"
        ? source.manualGroups
        : {},
    autoGrouped: !!source?.autoGrouped,
    autoBreakIds: Array.isArray(source?.autoBreakIds) ? source.autoBreakIds : [],
    name: typeof source?.name === "string" ? source.name : null,
    updatedAtMs: Number(source?.updatedAtMs || 0),
  };
}

function mergeWorkspaceJson(current: any, incoming: any) {
  return {
    version: 1,
    manualEdits: {
      ...(current?.manualEdits ?? {}),
      ...(incoming?.manualEdits ?? {}),
    },
    manualGroups:
      incoming?.manualGroups && typeof incoming.manualGroups === "object"
        ? incoming.manualGroups
        : (current?.manualGroups ?? {}),
    autoGrouped:
      typeof incoming?.autoGrouped === "boolean"
        ? incoming.autoGrouped
        : !!current?.autoGrouped,
    autoBreakIds: Array.isArray(incoming?.autoBreakIds)
      ? incoming.autoBreakIds
      : (current?.autoBreakIds ?? []),
    name:
      typeof incoming?.name === "string"
        ? incoming.name
        : (current?.name ?? null),
    updatedAtMs: Date.now(),
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    void cleanupOldImportJobsIfNeeded();

    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const safeId = String(id || "").trim();
    const url = new URL(req.url);
    const progressOnly = url.searchParams.get("mode") === "progress";

    const job = await prisma.importJob.findFirst({
      where: { id: safeId, userId },
      select: progressOnly
        ? {
            id: true,
            originalName: true,
            status: true,
            totalStops: true,
            processedStops: true,
            resultPath: true,
            resultJson: true,
            workspaceJson: true,
            resultSavedAt: true,
            createdAt: true,
            updatedAt: true,
            errorMessage: true,
          }
        : {
            id: true,
            originalName: true,
            status: true,
            totalStops: true,
            processedStops: true,
            resultPath: true,
            resultJson: true,
            workspaceJson: true,
            resultSavedAt: true,
            createdAt: true,
            updatedAt: true,
            errorMessage: true,
          },
    });

    if (!job) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    if (progressOnly) {
      return NextResponse.json({ ok: true, job });
    }

    let storedResultJson = job.resultJson;

    if (job.resultPath) {
      try {
        storedResultJson = await loadJobResult(job.resultPath);
      } catch (error) {
        console.error("Erro ao carregar arquivo do job:", error);
        storedResultJson = job.resultJson;
      }
    }

    let normalized = normalizeResultJson(storedResultJson);

    if (!normalized) {
      console.warn("Job sem arquivo e sem resultJson:", job.id);
      normalized = buildEmptyResultEnvelope();
    }

    const workspace = normalizeWorkspaceJson(job.workspaceJson, storedResultJson);

    return NextResponse.json({
      ok: true,
      job: {
        ...job,
        resultPath: undefined,
        resultJson: normalized,
        workspaceJson: workspace,
      },
    });
  } catch (e) {
    console.error("GET /api/history/[id] error:", e);
    return NextResponse.json({ error: "Erro ao abrir histórico." }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    void cleanupOldImportJobsIfNeeded();

    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const safeId = String(id || "").trim();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: true });
    }

    const incoming = (body as any)?.workspace ?? body;
    const incomingWorkspace = normalizeWorkspaceJson(incoming);

    const current = await prisma.importJob.findFirst({
      where: { id: safeId, userId },
      select: {
        workspaceJson: true,
      },
    });

    if (!current) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    const currentWorkspace = normalizeWorkspaceJson(current.workspaceJson);
    const payload = mergeWorkspaceJson(currentWorkspace, incomingWorkspace);

    const updated = await prisma.importJob.updateMany({
      where: { id: safeId, userId },
      data: {
        workspaceJson: payload as any,
      },
    });

    if (!updated.count) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("PATCH /api/history/[id] error:", e);
    return NextResponse.json({ error: "Erro ao salvar alterações." }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const safeId = String(id || "").trim();

    const current = await prisma.importJob.findFirst({
      where: { id: safeId, userId },
      select: {
        resultPath: true,
      },
    });

    if (!current) {
      return NextResponse.json({ error: "NÃ£o encontrado." }, { status: 404 });
    }

    if (current.resultPath) {
      await deleteJobResult(current.resultPath).catch((error) => {
        console.warn("Failed to delete job result file:", error);
      });
    }

    const updated = await prisma.importJob.updateMany({
      where: { id: safeId, userId },
      data: {
        resultPath: null,
        resultJson: Prisma.JsonNull,
        workspaceJson: Prisma.JsonNull,
        resultSavedAt: null,
      },
    });

    if (!updated.count) {
      return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/history/[id] error:", e);
    return NextResponse.json({ error: "Erro ao apagar histórico." }, { status: 500 });
  }
}
