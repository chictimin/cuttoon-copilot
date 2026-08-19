"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ProjectSummary } from "@/lib/db/presets";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/preset");
        if (!response.ok) {
          throw new Error("프로젝트 목록을 가져올 수 없습니다");
        }
        const data = await response.json();
        setProjects(data.projects || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "알 수 없는 오류");
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-start gap-8 p-8">
      <div className="w-full max-w-4xl">
        <h1 className="text-3xl font-bold">프로젝트</h1>
        <p className="mt-2 text-zinc-500">진행 중인 컷툰 프로젝트들</p>
      </div>

      {loading && (
        <div className="flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-700" />
        </div>
      )}

      {error && (
        <div className="w-full max-w-4xl rounded-md bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="w-full max-w-4xl rounded-lg border border-dashed border-zinc-300 p-12 text-center">
          <p className="text-zinc-500">아직 프로젝트가 없습니다</p>
          <Link
            href="/onboarding"
            className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            첫 번째 프로젝트 만들기
          </Link>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div className="w-full max-w-4xl grid gap-4">
          {projects.map((project) => (
            <Link
              key={project.projectId}
              href={`/session/${project.presetId}`}
              className="block rounded-lg border border-zinc-300 p-6 transition-all hover:border-zinc-400 hover:bg-zinc-50"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h2 className="text-lg font-semibold">{project.projectName}</h2>
                  <div className="mt-2 flex gap-4 text-sm text-zinc-500">
                    <span>세션: {project.sessionCount}</span>
                    {project.presetVersion && (
                      <span>프리셋 v{project.presetVersion}</span>
                    )}
                    <span>
                      수정됨: {new Date(project.updatedAt).toLocaleDateString("ko-KR")}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-100">
                  →
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
