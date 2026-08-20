"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// issue #136: 만든 컷툰(세션)을 다시 볼 경로가 DB·API·화면 어디에도 없었다.
// DB·API는 PR #137에서 채워졌다 — 이 화면은 GET /api/session?projectId=를 쓴다.
interface SessionSummary {
  sessionId: string;
  projectId: string;
  presetId: string;
  subject: string;
  version: number;
  status: "complete" | "in_progress";
  cutsDone: number;
  cutsTotal: number;
  thumbnail: string | null;
  updatedAt: string;
}

interface ProjectSummary {
  projectId: string;
  projectName: string;
  presetId: string | null;
  sessionCount: number;
  updatedAt: string;
}

type Phase = "loading" | "error" | "ready";

export default function ProjectSessions({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // 프로젝트 이름·presetId는 GET /api/preset(목록)에서 찾는다 — 전용
        // "프로젝트 단건 조회" 라우트가 없어서 목록 응답에서 이 프로젝트만 뽑는다.
        const [presetRes, sessionRes] = await Promise.all([
          fetch("/api/preset"),
          fetch(`/api/session?projectId=${encodeURIComponent(projectId)}`),
        ]);
        if (cancelled) return;

        if (!presetRes.ok || !sessionRes.ok) {
          setPhase("error");
          return;
        }

        const presetData = await presetRes.json();
        const sessionData = await sessionRes.json();
        if (cancelled) return;

        const found: ProjectSummary | null =
          (presetData.projects ?? []).find((p: ProjectSummary) => p.projectId === projectId) ??
          null;
        const loadedSessions: SessionSummary[] = sessionData.sessions ?? [];

        setProject(found);
        setSessions(loadedSessions);
        setPhase("ready");

        // 썸네일은 asset:// 참조라 리졸브해야 <img>로 그릴 수 있다(#82와 같은 이유).
        // #82 이전 mock 시절 세션은 thumbnail이 이미 data: URI일 수 있어(레거시
        // 호환, EditorFlow.resolveImageUrl과 같은 분기) 그 경우 리졸버를 거치지
        // 않고 그대로 쓴다 — asset:// 형식이 아닌 값을 보내면 리졸버가 400을 준다.
        const entries = await Promise.all(
          loadedSessions.map(async (s) => {
            if (!s.thumbnail) return null;
            if (!s.thumbnail.startsWith("asset://")) return [s.sessionId, s.thumbnail] as const;
            try {
              const res = await fetch(`/api/session/asset-url?uri=${encodeURIComponent(s.thumbnail)}`);
              if (!res.ok) return null;
              const { url } = (await res.json()) as { url: string };
              return [s.sessionId, url] as const;
            } catch {
              return null;
            }
          })
        );
        if (!cancelled) {
          setThumbnailUrls(
            Object.fromEntries(entries.filter((e): e is readonly [string, string] => e !== null))
          );
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function handleStartSession() {
    if (!project?.presetId) return;
    // ProjectList.tsx의 handleStartSession과 같은 관례(issue #41).
    window.sessionStorage.setItem("cuttoon:project-id", project.projectId);
    window.sessionStorage.setItem("cuttoon:preset-id", project.presetId);
    router.push(`/session/${crypto.randomUUID()}`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-2xl flex-col items-center gap-2 text-center">
        <Link href="/" className="self-start text-sm font-medium text-zinc-500 underline hover:text-zinc-900">
          ← 목록으로
        </Link>
        <h1 className="text-2xl font-semibold">{project?.projectName ?? "프로젝트"}</h1>
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

      {phase === "ready" && (
        <>
          <button
            type="button"
            onClick={handleStartSession}
            disabled={!project?.presetId}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            새 컷툰 만들기
          </button>

          {sessions.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <p className="text-base font-medium">아직 만든 컷툰이 없어요</p>
              <p className="text-sm text-zinc-500">위 버튼으로 첫 컷툰을 만들어보세요</p>
            </div>
          ) : (
            <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
              {sessions.map((session) => (
                <Link
                  key={session.sessionId}
                  href={`/editor/${session.sessionId}`}
                  className="flex gap-3 rounded-lg border border-zinc-200 p-3 hover:border-zinc-900"
                >
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-zinc-100">
                    {thumbnailUrls[session.sessionId] && (
                      // eslint-disable-next-line @next/next/no-img-element -- 리졸브한 asset URL, next/image 불필요
                      <img
                        src={thumbnailUrls[session.sessionId]}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-medium">{session.subject}</span>
                    <span className="text-xs text-zinc-500">
                      {session.status === "complete"
                        ? "완성됨"
                        : `진행 중 · ${session.cutsDone}/${session.cutsTotal}컷`}
                      {" · "}
                      {new Date(session.updatedAt).toLocaleDateString("ko-KR")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
