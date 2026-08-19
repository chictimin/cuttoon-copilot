import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// service role 키를 쓴다. 클라이언트에서 이 파일을 import하면 server-only가
// 빌드를 실패시킨다 — 런타임에 조용히 깨지는 대신 빌드에서 걸린다.
//
// 클라이언트를 모듈 최상위에서 만들지 않는 이유: next build가 라우트의 page
// data를 수집할 때 이 모듈을 평가하는데, 그 시점에 환경변수가 없으면 빌드
// 자체가 실패한다. 키는 실행 시점에만 있으면 되므로 첫 호출까지 미룬다.
let client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다 (.env 확인)"
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return client;
}
