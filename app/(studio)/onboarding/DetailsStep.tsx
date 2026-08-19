"use client";

import { useMemo, useState } from "react";
import type { AgeBand, Interest, LifeStage } from "@/lib/llm/preset-guard";
import {
  getCtaPresetById,
  getFallbackCtaId,
  resolveCandidates,
} from "@/lib/llm/cta-presets";

// PRD.md 4절 "딸깍 UX 판정 기준": enum 다중선택은 체크박스로 받는 게 허용된다.
// 아래 세 목록은 preset.schema.json의 context.interests/age_band/life_stage enum 값이다.
const INTERESTS: [Interest, string][] = [
  ["brand_awareness", "브랜드 인지도"],
  ["trust_building", "신뢰 형성"],
  ["product_showcase", "제품 소개"],
  ["sales_conversion", "구매 전환"],
  ["event_promotion", "이벤트 홍보"],
  ["info_education", "정보 전달"],
  ["lead_generation", "문의 확보"],
  ["recruiting", "모집"],
];

const AGE_BANDS: [AgeBand, string][] = [
  ["10s", "10대"],
  ["20s", "20대"],
  ["30s", "30대"],
  ["40s", "40대"],
  ["50s", "50대"],
  ["60s_plus", "60대 이상"],
];

const LIFE_STAGES: [LifeStage, string][] = [
  ["student", "학생"],
  ["job_seeker", "구직자"],
  ["early_career", "사회초년생"],
  ["parent", "부모"],
  ["business_owner", "사업자"],
  ["retired", "은퇴"],
];

export interface DetailsFormValue {
  projectName: string;
  industry: string[];
  mainSubjects: string[];
  forbidden: string[];
  interests: Interest[];
  ageBand: AgeBand[];
  lifeStage: LifeStage[];
  ctaId: string;
}

function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function CheckboxGroup<T extends string>({
  options,
  selected,
  onToggle,
}: {
  options: [T, string][];
  selected: Set<T>;
  onToggle: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map(([value, label]) => (
        <label key={value} className="flex items-center gap-1.5 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={selected.has(value)}
            onChange={() => onToggle(value)}
            className="size-4 rounded border-zinc-300"
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export default function DetailsStep({
  onConfirm,
}: {
  onConfirm: (value: DetailsFormValue) => void;
}) {
  const [projectName, setProjectName] = useState("");
  const [industryText, setIndustryText] = useState("");
  const [mainSubjectsText, setMainSubjectsText] = useState("");
  const [forbiddenText, setForbiddenText] = useState("");
  const [interests, setInterests] = useState<Set<Interest>>(new Set());
  const [ageBand, setAgeBand] = useState<Set<AgeBand>>(new Set());
  const [lifeStage, setLifeStage] = useState<Set<LifeStage>>(new Set());
  const [ctaId, setCtaId] = useState<string | null>(null);

  const ctaCandidates = useMemo(
    () => resolveCandidates(Array.from(interests)),
    [interests]
  );

  function handleSubmit() {
    onConfirm({
      projectName: projectName.trim() || "이름 없는 프로젝트",
      industry: parseTags(industryText),
      mainSubjects: parseTags(mainSubjectsText),
      forbidden: parseTags(forbiddenText),
      interests: Array.from(interests),
      ageBand: Array.from(ageBand),
      lifeStage: Array.from(lifeStage),
      ctaId: ctaId ?? getFallbackCtaId(),
    });
  }

  return (
    <div className="flex w-full max-w-xl flex-col gap-6 text-left">
      <div className="text-center">
        <h1 className="text-xl font-semibold">마지막으로 몇 가지만 알려주세요</h1>
        <p className="mt-1 text-sm text-zinc-500">
          자동으로 뽑을 수 없는 값이라 직접 입력이 필요해요. 비워두면 기본값으로 진행돼요
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="project_name" className="text-sm font-medium text-zinc-700">
          프로젝트 이름
        </label>
        <div className="flex gap-2">
          <input
            id="project_name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="예: 카페 인스타 컷툰"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => setProjectName("이름 없는 프로젝트")}
            className="shrink-0 rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-50"
          >
            이름 없이 진행
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="industry" className="text-sm font-medium text-zinc-700">
          담당 분야 <span className="font-normal text-zinc-400">(쉼표로 구분, 건너뛰기 가능)</span>
        </label>
        <input
          id="industry"
          value={industryText}
          onChange={(e) => setIndustryText(e.target.value)}
          placeholder="예: 카페, 헬스케어"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-zinc-700">마케팅 목적</p>
        <CheckboxGroup options={INTERESTS} selected={interests} onToggle={(v) => setInterests((s) => toggleInSet(s, v))} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-zinc-700">타깃 연령대</p>
        <CheckboxGroup options={AGE_BANDS} selected={ageBand} onToggle={(v) => setAgeBand((s) => toggleInSet(s, v))} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-zinc-700">타깃 생활단계</p>
        <CheckboxGroup options={LIFE_STAGES} selected={lifeStage} onToggle={(v) => setLifeStage((s) => toggleInSet(s, v))} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="main_subjects" className="text-sm font-medium text-zinc-700">
          주요 소재 <span className="font-normal text-zinc-400">(쉼표로 구분, 건너뛰기 가능)</span>
        </label>
        <input
          id="main_subjects"
          value={mainSubjectsText}
          onChange={(e) => setMainSubjectsText(e.target.value)}
          placeholder="예: 원두, 신메뉴"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="forbidden" className="text-sm font-medium text-zinc-700">
          넣지 말 것 <span className="font-normal text-zinc-400">(쉼표로 구분, 건너뛰기 가능)</span>
        </label>
        <input
          id="forbidden"
          value={forbiddenText}
          onChange={(e) => setForbiddenText(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-zinc-700">마지막 컷 CTA 기본값</p>
        <div className="flex flex-wrap gap-2">
          {ctaCandidates.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setCtaId(preset.id)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                ctaId === preset.id
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCtaId(getFallbackCtaId())}
            className="rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50"
          >
            알아서 해줘
          </button>
        </div>
        {ctaId && (
          <p className="text-xs text-zinc-400">
            선택됨: {getCtaPresetById(ctaId)?.label ?? ctaId}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        className="self-start rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
      >
        프리셋 확정
      </button>
    </div>
  );
}
