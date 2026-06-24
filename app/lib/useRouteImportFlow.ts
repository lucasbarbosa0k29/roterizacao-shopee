"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChangeEvent, FormEvent } from "react";

export type RouteImportAccess = {
  canStartRoute?: boolean;
} | null;

export type RouteJobProgress = {
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  processedStops: number;
  totalStops: number;
  errorMessage?: string | null;
} | null;

type UseRouteImportFlowArgs = {
  access: RouteImportAccess;
  deferJobUrlUpdate?: boolean;
  onImportStart?: (file: File) => void;
  onJobId?: (jobId: string) => void;
  onImportSuccess?: (payload: {
    jobId: string;
    rows: any[];
    dataImport: any;
    dataProcess: any;
    file: File;
  }) => void;
  onDuplicateImport?: () => void;
};

export function useRouteImportFlow({
  access,
  deferJobUrlUpdate = false,
  onImportStart,
  onJobId,
  onImportSuccess,
  onDuplicateImport,
}: UseRouteImportFlowArgs) {
  const router = useRouter();
  const mountedRef = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [jobProgress, setJobProgress] = useState<RouteJobProgress>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (access && !access.canStartRoute) {
        e.currentTarget.value = "";
        setFile(null);
        router.replace("/planos");
        return;
      }

      setFile(e.target.files?.[0] || null);
    },
    [access, router]
  );

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (!file) return alert("Selecione uma planilha");
      if (access && !access.canStartRoute) {
        router.replace("/planos");
        return;
      }

      setLoading(true);
      setJobProgress(null);
      onImportStart?.(file);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const resImport = await fetch("/api/import", {
          method: "POST",
          body: formData,
        });
        const dataImport = await resImport.json().catch(() => ({}));

        if (!resImport.ok) {
          if (dataImport?.code === "DUPLICATE_IMPORT_FILE") {
            if (mountedRef.current) {
              setLoading(false);
              setJobProgress(null);
            }
            onDuplicateImport?.();
            return;
          }

          alert(dataImport?.error || "Erro no import");
          return;
        }

        if (!Array.isArray(dataImport?.rows) || dataImport.rows.length === 0) {
          alert("Import veio vazio (rows). Verifique a planilha/colunas.");
          return;
        }

        const jobId =
          dataImport?.jobId ||
          dataImport?.job?.id ||
          dataImport?.importJobId ||
          dataImport?.importJob?.id ||
          "";

        if (jobId) {
          onJobId?.(jobId);
          if (!deferJobUrlUpdate) {
            window.history.replaceState({}, "", `/?job=${encodeURIComponent(jobId)}`);
          }
        }

        const resProcess = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: dataImport.rows,
            jobId,
          }),
        });
        const dataProcess = await resProcess.json().catch(() => ({}));

        if (!resProcess.ok) {
          alert(dataProcess?.error || "Erro no processamento");
          return;
        }

        onImportSuccess?.({
          jobId,
          rows: dataProcess.rows || [],
          dataImport,
          dataProcess,
          file,
        });
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [access, deferJobUrlUpdate, file, onDuplicateImport, onImportStart, onImportSuccess, onJobId, router]
  );

  return {
    file,
    setFile,
    loading,
    setLoading,
    jobProgress,
    setJobProgress,
    handleFileChange,
    handleSubmit,
  };
}
