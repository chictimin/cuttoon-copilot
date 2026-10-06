"use client";

import { useEffect, useState } from "react";

// issue #150 C6-ui: 상세 정보 확정 → 마스코트 초안 제안 → 사용자가 수정·확정 →
// 캐릭터 시트 생성(#200 계약 2절). 후보는 선택지로만 보여주고 자동으로 채택하지
// 않는다 — 누르면 아래 입력칸에 채워져 고칠 수 있다(소재 후보 #191과 같은 관례).
// 건너뛰면 mascot 필드 없이 진행한다(빈 문자열 금지).

/** preset.mascot과 같은 모양. label은 계약상 "mascot" 고정이다. */
export interface MascotValue {
  label: string;
  description: string;
}

const MASCOT_LABEL = "mascot";
const SUGGESTION_ROUTE = "/api/preset/mascot-suggestion";

async function fetchMascotSuggestions(input: {
  industry: string[];
  interests: string[];
  keywords: string[];
}): Promise<string[]> {
  const res = await fetch(SUGGESTION_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: { industry: input.industry, interests: input.interests },
      ...(input.keywords.length > 0 ? { style: { keywords: input.keywords } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "마스코트 제안에 실패했습니다");
  }
  const { mascots } = (await res.json()) as { mascots?: Array<{ description?: unknown }> };
  const list = Array.isArray(mascots)
    ? mascots
        .map((m) => (typeof m.description === "string" ? m.description.trim() : ""))
        .filter(Boolean)
    : [];
  if (list.length === 0) throw new Error("마스코트 후보가 비어 있습니다");
  return list;
}

export default function MascotStep({
  industry,
  interests,
  keywords,
  saving,
  error,
  onConfirm,
}: {
  industry: string[];
  interests: string[];
  keywords: string[];
  /** 캐릭터 시트 생성·프리셋 저장 중 */
  saving: boolean;
  /** 시트 생성·저장 실패 문구(부모가 관리) */
  error: string | null;
  /** 확정이면 mascot, 건너뛰면 null */
  onConfirm: (mascot: MascotValue | null) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(true);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [description, setDescription] = useState("");

  async function loadSuggestions() {
    try {
      setSuggestions(await fetchMascotSuggestions({ industry, interests, keywords }));
    } catch {
      setSuggestError("마스코트 후보를 만들지 못했어요. 다시 뽑거나 직접 적어주세요");
    } finally {
      setSuggesting(false);
    }
  }

  // 단계에 들어오면 한 번 제안받는다. setState는 fetch 콜백 안에서만 부른다
  // (react-hooks/set-state-in-effect). 언마운트 뒤 늦게 온 응답은 버린다.
  useEffect(() => {
    let cancelled = false;
    fetchMascotSuggestions({ industry, interests, keywords })
      .then((list) => {
        if (!cancelled) setSuggestions(list);
      })
      .catch(() => {
        if (!cancelled) setSuggestError("마스코트 후보를 만들지 못했어요. 다시 뽑거나 직접 적어주세요");
      })
      .finally(() => {
        if (!cancelled) setSuggesting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRegenerate() {
    setSuggestError(null);
    setSuggestions(null);
    setSuggesting(true);
    void loadSuggestions();
  }

  const trimmed = description.trim();

  if (saving) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-700" />
        <p className="text-base font-medium">캐릭터 시트를 만들고 있어요...</p>
        <p className="text-sm text-zinc-500">프로젝트 그림체를 정리하는 중이에요</p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">함께 등장할 마스코트를 정해볼까요?</h1>
        <p className="text-sm text-zinc-500">
          컷툰마다 조연으로 같은 모습으로 나와요. 없어도 괜찮아요
        </p>
      </div>

      {error && (
        <p className="w-full rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
      )}

      {suggesting ? (
        <p className="text-sm text-zinc-500">프로젝트에 맞는 마스코트를 찾고 있어요...</p>
      ) : (
        <div className="flex w-full flex-col gap-2">
          {suggestError && (
            <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{suggestError}</p>
          )}
          {suggestions?.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => setDescription(text)}
              className={`rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                description === text
                  ? "border-zinc-900 bg-zinc-50"
                  : "border-zinc-200 hover:border-zinc-400"
              }`}
            >
              {text}
            </button>
          ))}
          <button
            type="button"
            onClick={handleRegenerate}
            className="self-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            다시 뽑기
          </button>
        </div>
      )}

      <div className="flex w-full flex-col gap-2 text-left">
        <label htmlFor="mascot_description" className="text-sm font-medium text-zinc-700">
          마스코트 모습과 역할 <span className="font-normal text-zinc-400">(후보를 누르면 채워져요, 고쳐도 돼요)</span>
        </label>
        <textarea
          id="mascot_description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="예: 둥근 안경을 쓴 하얀 고양이 바리스타, 손님에게 메뉴를 추천하는 역할"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onConfirm(null)}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
        >
          마스코트 없이 진행
        </button>
        <button
          type="button"
          disabled={trimmed.length === 0}
          onClick={() => onConfirm({ label: MASCOT_LABEL, description: trimmed })}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          이 마스코트로 할게
        </button>
      </div>
    </div>
  );
}
