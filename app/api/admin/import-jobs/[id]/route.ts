import {
  deleteJobResult,
  isManagedJobResultPath,
  loadJobResult,
} from "@/app/lib/job-storage";
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getToken } from "next-auth/jwt";

export const runtime = "nodejs";

async function requireAdmin(req: Request) {
  const token = await getToken({
    req: req as any,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const role = (token as any)?.role;
  if (!token || role !== "ADMIN") return null;
  return token;
}

// ✅ Next 15/16: params pode vir como Promise
async function getIdFromCtx(ctx: any) {
  const params = await ctx?.params;
  const id = String(params?.id || "").trim();
  return id;
}

export async function GET(req: Request, ctx: any) {
  const ok = await requireAdmin(req);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = await getIdFromCtx(ctx);
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const url = new URL(req.url);
  const progressOnly = url.searchParams.get("mode") === "progress";

  const job = await prisma.importJob.findUnique({
    where: { id },
    select: progressOnly
      ? {
          id: true,
          status: true,
          originalName: true,
          totalStops: true,
          processedStops: true,
          errorMessage: true,
          createdAt: true,
          finishedAt: true,
          resultPath: true,
          resultJson: true,
          resultSavedAt: true,
          user: { select: { name: true, email: true, role: true } },
        }
      : {
          id: true,
          status: true,
          originalName: true,
          totalStops: true,
          processedStops: true,
          errorMessage: true,
          createdAt: true,
          finishedAt: true,
          resultPath: true,
          resultJson: true,
          resultSavedAt: true,
          user: { select: { name: true, email: true, role: true } },
        },
  });

  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (progressOnly) {
    return NextResponse.json({ job });
  }

  let resultPayload = job.resultJson;

  if (job.resultPath && isManagedJobResultPath(job.resultPath)) {
    try {
      resultPayload = await loadJobResult(job.resultPath);
    } catch (error) {
      console.error("Failed to load admin job result file:", error);

      if (!job.resultJson) {
        return NextResponse.json(
          { error: "Failed to load stored result file" },
          { status: 500 },
        );
      }
    }
  } else if (job.resultPath) {
    console.warn("Admin job result path ignored as invalid/legacy:", job.id);
  }

  return NextResponse.json({
    job: {
      ...job,
      resultPath: undefined,
      resultJson: resultPayload ?? null,
    },
  });
}

export async function DELETE(req: Request, ctx: any) {
  const ok = await requireAdmin(req);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = await getIdFromCtx(ctx);
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const actorId = String((ok as any)?.id || "").trim();
  const actorEmail = String((ok as any)?.email || "").trim().toLowerCase();

  const job = await prisma.importJob.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      originalName: true,
      createdAt: true,
      status: true,
      resultPath: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (job?.resultPath && isManagedJobResultPath(job.resultPath)) {
    await deleteJobResult(job.resultPath).catch((error) => {
      console.warn("Failed to delete admin job result file:", error);
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminAccessLog.create({
      data: {
        adminId: actorId,
        targetUserId: job.userId,
        action: "DELETE_IMPORT_JOB",
        metadata: {
          actorEmail,
          action: "DELETE_IMPORT_JOB",
          before: {
            jobId: job.id,
            userId: job.userId,
            filename: job.originalName ?? null,
            createdAt: job.createdAt.toISOString(),
            status: job.status,
          },
          after: null,
          createdAt: new Date().toISOString(),
        },
      },
    });

    await tx.importJob.delete({
      where: { id },
    });
  });

  return NextResponse.json({ ok: true });
}
