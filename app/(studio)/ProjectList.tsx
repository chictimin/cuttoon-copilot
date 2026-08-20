"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();

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

  function handleStartSession(project: ProjectSummary) {
    if (!project.presetId) return;
    // 세션 화면이 이 두 값을 sessionStorage에서 읽는다 (issue #41).
    window.sessionStorage.setItem("cuttoon:project-id", project.projectId);
    window.sessionStorage.setItem("cuttoon:preset-id", project.presetId);
    router.push(`/session/${crypto.randomUUID()}`);
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
              className="flex items-center justify-between rounded-lg border border-zinc-200 p-4"
            >
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
              <button
                type="button"
                onClick={() => handleStartSession(project)}
                disabled={!project.presetId}
                className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
              >
                새 컷툰 만들기
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
