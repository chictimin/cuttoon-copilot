"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MANIFEST_URL, setDemoMode, useDemoMode } from "./demo-mode";

interface ProjectSummary {
  projectId: string;
  projectName: string;
  presetId: string | null;
  presetVersion: string | null;
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
}

type Phase = "loading" | "error" | "ready";

export default function ProjectList() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<ProjectSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  // #311: 데모 캐시 기준 프로젝트는 삭제 버튼을 숨긴다. manifest를 못 읽으면
  // 빈 집합으로 두고 모든 카드에 삭제 버튼을 보인다(오류 안내 없음).
  // 조회가 끝날 때까지(manifestLoaded=false) 삭제 버튼을 렌더하지 않는다(보호 경합 방지).
  const [protectedIds, setProtectedIds] = useState<ReadonlySet<string>>(new Set());
  const [manifestLoaded, setManifestLoaded] = useState(false);
  const router = useRouter();
  // #307: ?demo=1로 들어오면 여기서 기억해 두어 세션 화면까지 이어진다.
  const demoMode = useDemoMode();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/preset");
        if (cancelled) return;

        if (!res.ok) {
          setPhase("error");
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        setProjects(data.projects ?? []);
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(MANIFEST_URL, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) return;
        const raw = (await res.json()) as {
          generated?: { project_id?: unknown };
        } | null;
        const projectId = raw?.generated?.project_id;
        if (cancelled) return;
        if (typeof projectId === "string" && projectId.length > 0) {
          setProtectedIds(new Set([projectId]));
          // #311: 보호 목록이 갱신됐을 때 열린 확인 창의 대상이 보호 id면 창을 닫는다.
          setConfirmTarget((prev) =>
            prev && prev.projectId === projectId ? null : prev
          );
        }
      } catch {
        // 못 읽으면 보호 목록은 빈 것으로 보고 오류 안내는 띄우지 않는다.
      } finally {
        if (!cancelled) setManifestLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleStartSession(project: ProjectSummary) {
    if (!project.presetId) return;
    // 세션 화면이 이 두 값을 sessionStorage에서 읽는다 (issue #41).
    window.sessionStorage.setItem("cuttoon:project-id", project.projectId);
    window.sessionStorage.setItem("cuttoon:preset-id", project.presetId);
    router.push(`/session/${crypto.randomUUID()}`);
  }

  // #311: 목록에서 숨기기(서버는 archived_at 소프트 삭제). 성공하면 목록에서
  // 카드를 빼고, 실패하면 카드를 유지하고 짧은 안내만 보인다(서버 error 원문 노출 금지).
  async function handleConfirmDelete() {
    if (!confirmTarget || deletingId) return;
    const targetId = confirmTarget.projectId;
    // #311: 조회 완료 후 보호 대상으로 판명되면 요청하지 않고 창을 닫는다.
    if (protectedIds.has(targetId)) {
      setConfirmTarget(null);
      return;
    }
    setDeletingId(targetId);
    setDeleteError(false);
    try {
      const res = await fetch(
        `/api/preset?projectId=${encodeURIComponent(targetId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        setDeleteError(true);
        return;
      }
      setProjects((prev) => prev.filter((p) => p.projectId !== targetId));
      setConfirmTarget(null);
    } catch {
      setDeleteError(true);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-2xl items-center justify-between">
        <h1 className="text-2xl font-semibold">컷툰 코파일럿</h1>
        <Link
          href="/onboarding"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          새 프로젝트 만들기
        </Link>
      </div>

      {demoMode && (
        <div className="flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>데모 캐시 사용 중 — 새 컷툰의 표지·컷 그림이 미리 만들어 둔 이미지로 채워져요</span>
          <button
            type="button"
            onClick={() => setDemoMode(false)}
            className="rounded-md border border-amber-300 px-3 py-1 text-xs font-medium hover:bg-amber-100"
          >
            데모 끄기
          </button>
        </div>
      )}

      {phase === "loading" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-700" />
          <p className="text-sm text-zinc-500">불러오는 중...</p>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-red-600">목록을 불러오지 못했어요</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            다시 시도
          </button>
        </div>
      )}

      {phase === "ready" && projects.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-base font-medium">아직 만든 프로젝트가 없어요</p>
          <p className="text-sm text-zinc-500">
            온보딩에서 회사만의 그림체를 먼저 정해보세요
          </p>
        </div>
      )}

      {phase === "ready" && projects.length > 0 && (
        <div className="flex w-full max-w-2xl flex-col gap-3">
          {projects.map((project) => (
            <div
              key={project.projectId}
              className="rounded-lg border border-zinc-200 p-4"
            >
              {/* #311: 삭제 버튼은 "새 컷툰 만들기" 버튼과 같은 줄에 두지 않고
                  카드 우측 상단의 작은 보조 버튼으로 둔다(오클릭 방지). */}
              <div className="flex items-start justify-between gap-3">
                <Link href={`/projects/${project.projectId}`} className="flex flex-col gap-1">
                  <span className="font-medium hover:underline">{project.projectName}</span>
                  <span className="text-xs text-zinc-500">
                    {project.sessionCount > 0
                      ? `컷툰 ${project.sessionCount}편`
                      : "아직 만든 컷툰 없음"}
                    {" · "}
                    {new Date(project.updatedAt).toLocaleDateString("ko-KR")}
                  </span>
                </Link>
                {/* #311: manifest 조회 중에는 삭제 버튼을 렌더하지 않고,
                    조회 완료 후 데모 캐시 기준 프로젝트에는 렌더하지 않는다. */}
                {manifestLoaded && !protectedIds.has(project.projectId) && (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmTarget(project);
                      setDeleteError(false);
                    }}
                    aria-label={`${project.projectName} 삭제`}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600"
                  >
                    삭제
                  </button>
                )}
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => handleStartSession(project)}
                  disabled={!project.presetId}
                  className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
                >
                  새 컷툰 만들기
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* #311: 삭제 확인 창. 화면 안 모달(OnboardingFlow의 unmapped 확인 창과 같은 패턴). */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-delete-title"
            className="w-full max-w-md rounded-lg bg-white p-6 text-left shadow-lg"
          >
            <h2 id="project-delete-title" className="text-base font-semibold">
              &ldquo;{confirmTarget.projectName}&rdquo;을(를) 삭제할까요?
            </h2>
            <p className="mt-2 text-sm text-zinc-600">
              목록에서 사라지고, 화면에서는 되돌릴 수 없어요
            </p>
            {deleteError && (
              <p className="mt-2 text-sm text-red-600">
                삭제하지 못했어요. 다시 시도해 주세요
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmTarget(null)}
                disabled={deletingId !== null}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deletingId !== null}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
              >
                {deletingId !== null ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
