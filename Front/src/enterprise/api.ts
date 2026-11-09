import { api } from "../api";
import { useRequest } from "../hooks";
import type { Session } from "../types";
import type { EnterpriseTest, TestInput, TestResults } from "./model";

/** 내가 만든 기업 테스트(서버 저장). */
export function useEnterpriseTests(session: Session | null) {
  const token = session?.accessToken;
  return useRequest<EnterpriseTest[]>(
    token ? (signal) => api("/enterprise/tests", { signal }, token) : null,
    [],
    "기업 테스트를 불러오지 못했어요.",
    [token],
  );
}

export function useEnterpriseTest(session: Session | null, id: string | undefined) {
  const token = session?.accessToken;
  return useRequest<EnterpriseTest | null>(
    token && id ? (signal) => api(`/enterprise/tests/${id}`, { signal }, token) : null,
    null,
    "테스트를 불러오지 못했어요.",
    [token, id],
  );
}

export function useTestResults(session: Session | null, id: string | undefined, enabled: boolean) {
  const token = session?.accessToken;
  return useRequest<TestResults | null>(
    token && id && enabled
      ? (signal) => api(`/enterprise/tests/${id}/results`, { signal }, token)
      : null,
    null,
    "응시 결과를 불러오지 못했어요.",
    [token, id, enabled],
  );
}

export const enterpriseApi = {
  create: (token: string, input: TestInput) =>
    api<EnterpriseTest>("/enterprise/tests", { method: "POST", body: JSON.stringify(input) }, token),
  update: (token: string, id: string, input: TestInput) =>
    api<EnterpriseTest>(`/enterprise/tests/${id}`, { method: "PATCH", body: JSON.stringify(input) }, token),
  remove: (token: string, id: string) =>
    api<{ id: string }>(`/enterprise/tests/${id}`, { method: "DELETE" }, token),
};

export const inviteUrl = (code: string) =>
  `${window.location.origin}/enterprise/join/${code}`;
