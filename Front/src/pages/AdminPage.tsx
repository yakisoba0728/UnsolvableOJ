import { useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { confirmOf, useConfirm } from "../components/ConfirmDialog";
import { api } from "../api";
import { useAuth } from "../auth";
import { CopyButton } from "../components/CopyButton";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import { Select } from "../components/Select";
import { SkeletonRows } from "../components/Skeleton";
import {
  useDocumentTitle,
  useRequest,
  useSlashFocus,
  useUrlFilters,
} from "../hooks";
import type { AdminAuditEvent, AdminOps, AdminUser, Page, Role } from "../types";
import { verdictLabel } from "../verdict";

const PAGE_SIZE = 20;
const roleLabels: Record<Role, string> = {
  USER: "일반",
  AUTHOR: "작성자",
  ADMIN: "관리자",
};
const actionLabels: Record<string, string> = {
  "user.role": "역할 변경",
  "user.suspend": "계정 정지",
  "user.temporary_password": "임시 비밀번호 발급",
  "user.unsuspend": "정지 해제",
  "problem.create": "문제 생성",
  "problem.update": "문제 수정",
  "problem.status": "문제 상태 변경",
  "submission.rejudge": "재채점",
  "community_post.delete": "커뮤니티 글 삭제",
  "community_comment.delete": "커뮤니티 답변 삭제",
  "community_post.hide": "커뮤니티 글 숨김",
  "community_post.unhide": "커뮤니티 글 숨김 해제",
  "community_comment.hide": "커뮤니티 답변 숨김",
  "community_comment.unhide": "커뮤니티 답변 숨김 해제",
  "community_report.resolve": "신고 처리",
  "problem.rejudge": "문제 일괄 재채점",
};
const dateTime = (value: string) =>
  new Date(value).toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const shortId = (id: string) => id.slice(0, 8);

/** 관리자 화면. 라우트에서 ADMIN만 들어오게 막는다. */
export function AdminPage() {
  return (
    <div className="page-width page-body admin-page">
      <PageHeader
        title="관리"
        description="사용자 권한과 정지, 커뮤니티 신고, 변경 기록, 채점 운영 상태를 확인합니다."
      />
      <nav className="tab-list admin-tabs" aria-label="관리 메뉴">
        <NavLink className="tab-button" to="/admin/users">
          사용자
        </NavLink>
        <NavLink className="tab-button" to="/admin/community">
          신고
        </NavLink>
        <NavLink className="tab-button" to="/admin/audit">
          감사 로그
        </NavLink>
        <NavLink className="tab-button" to="/admin/ops">
          운영 상태
        </NavLink>
      </nav>
      <Routes>
        <Route index element={<Navigate to="users" replace />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="community" element={<AdminReports />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="ops" element={<AdminOpsView />} />
        <Route path="*" element={<Navigate to="users" replace />} />
      </Routes>
    </div>
  );
}

function AdminUsers() {
  useDocumentTitle("사용자 관리");
  const [confirm, confirmDialog] = useConfirm();
  const { session } = useAuth();
  const { params, update, urlQuery, queryText, setQueryText, page } =
    useUrlFilters();
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  const role = params.get("role") ?? "";
  const query = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  if (urlQuery.trim()) query.set("q", urlQuery.trim());
  if (role) query.set("role", role);
  const path = `/admin/users?${query}`;
  const { data, loading, error } = useRequest<Page<AdminUser> | null>(
    (signal) => api(path, { signal }, session?.accessToken),
    null,
    "사용자 목록을 불러오지 못했습니다.",
    [path, session?.accessToken],
  );
  // 바꾼 행은 목록을 다시 받지 않고 서버 응답으로 덮어쓴다.
  const [changed, setChanged] = useState<Record<string, Partial<AdminUser>>>(
    {},
  );
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  // 발급한 임시 비밀번호는 화면 상태에만 두고 닫으면 다시 볼 수 없다.
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  async function issuePassword(user: AdminUser) {
    if (
      busy ||
      !(await confirm(
        confirmOf(
          `${user.username}에게 임시 비밀번호를 발급할까요? 기존 비밀번호는 쓸 수 없게 되고 그 사용자의 모든 로그인이 끊깁니다.`,
          "발급",
          true,
        ),
      ))
    )
      return;
    setBusy(user.id);
    setActionError("");
    setIssued(null);
    try {
      const { temporaryPassword } = await api<{ temporaryPassword: string }>(
        `/admin/users/${user.id}/temporary-password`,
        { method: "POST" },
        session?.accessToken,
      );
      setIssued({ username: user.username, password: temporaryPassword });
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "임시 비밀번호를 발급하지 못했습니다.",
      );
    } finally {
      setBusy("");
    }
  }

  async function mutate(
    user: AdminUser,
    action: string,
    body: object,
    question: string,
    confirmLabel: string,
    danger = false,
  ) {
    if (busy || !(await confirm(confirmOf(question, confirmLabel, danger))))
      return;
    setBusy(user.id);
    setActionError("");
    try {
      const result = await api<Partial<AdminUser>>(
        `/admin/users/${user.id}/${action}`,
        { method: "PATCH", body: JSON.stringify(body) },
        session?.accessToken,
      );
      setChanged((rows) => ({
        ...rows,
        [user.id]: { ...rows[user.id], ...result },
      }));
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "변경하지 못했습니다.",
      );
    } finally {
      setBusy("");
    }
  }

  const users = (data?.items ?? []).map((user) => ({
    ...user,
    ...changed[user.id],
  }));
  return (
    <section aria-label="사용자">
      {confirmDialog}
      <div className="filter-card">
        <div className="filter-row">
          <div className="search-field">
            <input
              ref={searchRef}
              type="search"
              className="search-input"
              placeholder="사용자 이름이나 이메일 검색"
              aria-label="사용자 검색"
              aria-keyshortcuts="/"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
            />
          </div>
          <Select
            ariaLabel="역할 필터"
            value={role}
            options={[
              { value: "", label: "모든 역할" },
              ...Object.entries(roleLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
            onChange={(next) => update({ role: next || null })}
          />
        </div>
      </div>
      <p className="muted admin-count" role="status" aria-live="polite">
        {data ? `검색 결과 ${data.total}명` : ""}
      </p>
      {error || actionError ? (
        <p className="error-message" role="alert">
          {error || actionError}
        </p>
      ) : null}
      {issued ? (
        <div className="notice-inline admin-issued" role="status">
          <strong>{issued.username}의 임시 비밀번호</strong>
          <code>{issued.password}</code>
          <CopyButton text={issued.password} label="복사" />
          <p>
            이 비밀번호는 지금만 보여요. 사용자에게 안전하게 전달하고 로그인 후
            바꾸게 하세요.
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => setIssued(null)}
          >
            닫기
          </button>
        </div>
      ) : null}
      {loading ? (
        <SkeletonRows count={6} columns={5} />
      ) : users.length ? (
        <table className="ent-table admin-table">
          <thead>
            <tr>
              <th scope="col">사용자</th>
              <th scope="col">역할</th>
              <th scope="col">상태</th>
              <th scope="col">가입일</th>
              <th scope="col">관리</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const self = user.id === session?.user.id;
              return (
                <tr key={user.id}>
                  <td>
                    <strong>{user.username}</strong>
                    {self ? <span className="pill admin-self">나</span> : null}
                    <small>
                      {user.email} · Lv.{user.level} · {user.xp} XP
                    </small>
                  </td>
                  <td>
                    <Select
                      ariaLabel={`${user.username} 역할`}
                      value={user.role}
                      disabled={self || busy === user.id}
                      options={Object.entries(roleLabels).map(
                        ([value, label]) => ({ value, label }),
                      )}
                      onChange={(next) =>
                        next !== user.role &&
                        void mutate(
                          user,
                          "role",
                          { role: next },
                          `${user.username}의 역할을 ${roleLabels[next as Role]}(으)로 바꿀까요? 그 사용자는 다시 로그인해야 합니다.`,
                          "역할 바꾸기",
                          // 관리자 권한을 주거나 거두는 변경은 위험 동작으로 보인다.
                          next === "ADMIN" || user.role === "ADMIN",
                        )
                      }
                    />
                  </td>
                  <td>
                    {user.suspendedAt ? (
                      <span className="pill pill-warning" title={dateTime(user.suspendedAt)}>
                        정지됨
                      </span>
                    ) : (
                      <span className="pill pill-success">정상</span>
                    )}
                  </td>
                  <td className="ent-period" data-label="가입">{new Date(user.createdAt).toLocaleDateString("ko-KR")}</td>
                  <td>
                    <div className="admin-actions">
                      {self ? null : (
                        <button
                          type="button"
                          className="button button-outline button-small"
                          disabled={busy === user.id}
                          onClick={() =>
                            void mutate(
                              user,
                              "suspension",
                              { suspended: !user.suspendedAt },
                              user.suspendedAt
                                ? `${user.username}의 정지를 해제할까요?`
                                : `${user.username} 계정을 정지할까요? 바로 로그아웃되고 해제할 때까지 로그인할 수 없습니다.`,
                              user.suspendedAt ? "정지 해제" : "정지",
                              !user.suspendedAt,
                            )
                          }
                        >
                          {user.suspendedAt ? "정지 해제" : "정지"}
                        </button>
                      )}
                      {self ? null : (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy === user.id}
                          onClick={() => void issuePassword(user)}
                        >
                          임시 비밀번호
                        </button>
                      )}
                      <NavLink
                        className="text-button"
                        to={`/admin/audit?targetId=${user.id}`}
                        aria-label={`${user.username} 관련 기록`}
                      >
                        기록
                      </NavLink>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : error ? null : (
        <div className="empty-state">
          <strong>조건에 맞는 사용자가 없어요</strong>
        </div>
      )}
      {data ? (
        <Pagination
          page={page}
          totalPages={data.totalPages}
          onChange={(next) => update({ page: String(next) })}
        />
      ) : null}
    </section>
  );
}

interface CommunityReport {
  id: string;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  targetType: "POST" | "COMMENT";
  reporter: { id: string; username: string };
  author: { id: string; username: string };
  post: { id: string; title: string; hidden: boolean };
  comment: { id: string; body: string; hidden: boolean } | null;
}
const reportStatusLabels = { open: "처리 전", resolved: "처리됨", all: "전체" };

function AdminReports() {
  useDocumentTitle("커뮤니티 신고");
  const [confirm, confirmDialog] = useConfirm();
  const { session } = useAuth();
  const { params, update, page } = useUrlFilters();
  const status = params.get("status") ?? "open";
  const query = new URLSearchParams({
    status,
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  const path = `/admin/community/reports?${query}`;
  const { data, loading, error, retry } = useRequest<Page<CommunityReport> | null>(
    (signal) => api(path, { signal }, session?.accessToken),
    null,
    "신고 목록을 불러오지 못했습니다.",
    [path, session?.accessToken],
  );
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");

  // 숨김·해제는 같은 대상의 다른 신고도 처리됨으로 바꾸므로 고친 행만 덮지 않고 목록을 다시 받는다.
  async function act(
    report: CommunityReport,
    path: string,
    method: string,
    question: string,
    confirmLabel: string,
    danger = false,
  ) {
    if (busy || !(await confirm(confirmOf(question, confirmLabel, danger))))
      return;
    setBusy(report.id);
    setActionError("");
    try {
      await api(`/admin/community/${path}`, { method }, session?.accessToken);
      retry();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "처리하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section aria-label="커뮤니티 신고">
      {confirmDialog}
      <div className="filter-card">
        <div className="filter-row">
          <Select
            ariaLabel="신고 상태 필터"
            value={status}
            options={Object.entries(reportStatusLabels).map(([value, label]) => ({
              value,
              label,
            }))}
            onChange={(next) => update({ status: next === "open" ? null : next })}
          />
        </div>
      </div>
      <p className="muted admin-count" role="status" aria-live="polite">
        {data ? `신고 ${data.total}건` : ""}
      </p>
      {error || actionError ? (
        <p className="error-message" role="alert">
          {error || actionError}
        </p>
      ) : null}
      {loading && !data ? (
        <SkeletonRows count={6} columns={5} />
      ) : data?.items.length ? (
        <table className="ent-table admin-table">
          <thead>
            <tr>
              <th scope="col">신고 시각</th>
              <th scope="col">대상</th>
              <th scope="col">사유</th>
              <th scope="col">상태</th>
              <th scope="col">관리</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((report) => {
              const target = report.comment
                ? { kind: "comments", name: "답변", ...report.comment }
                : { kind: "posts", name: "글", ...report.post };
              return (
                <tr key={report.id}>
                  <td className="ent-period">{dateTime(report.createdAt)}</td>
                  <td data-label="대상">
                    <Link
                      to={
                        report.comment
                          ? `/community/${report.post.id}#${report.comment.id}`
                          : `/community/${report.post.id}`
                      }
                    >
                      {report.comment
                        ? `답변: ${report.comment.body}`
                        : report.post.title}
                    </Link>
                    {target.hidden ? <span className="pill pill-warning">숨김</span> : null}
                    <small>작성자 {report.author.username}</small>
                  </td>
                  <td data-label="사유">
                    {report.reason}
                    <small>신고자 {report.reporter.username}</small>
                  </td>
                  <td>
                    {report.resolvedAt ? (
                      <span className="pill pill-success" title={dateTime(report.resolvedAt)}>
                        처리됨
                      </span>
                    ) : (
                      <span className="pill pill-warning">처리 전</span>
                    )}
                  </td>
                  <td>
                    <div className="admin-actions">
                      {report.resolvedAt ? null : (
                        <button
                          type="button"
                          className="button button-outline button-small"
                          disabled={busy === report.id}
                          onClick={() =>
                            void act(
                              report,
                              `reports/${report.id}/resolved`,
                              "PUT",
                              `이 신고를 숨기지 않고 처리됨으로 닫을까요?`,
                              "처리 완료",
                            )
                          }
                        >
                          처리 완료
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy === report.id}
                        onClick={() =>
                          void act(
                            report,
                            `${target.kind}/${target.id}/hidden`,
                            target.hidden ? "DELETE" : "PUT",
                            target.hidden
                              ? `이 ${target.name}의 숨김을 해제할까요? 다시 모두에게 보입니다.`
                              : `이 ${target.name}을(를) 숨길까요? 작성자와 관리자에게만 보이고, 이 대상의 처리 전 신고는 모두 처리됨이 됩니다.`,
                            target.hidden ? "숨김 해제" : "숨기기",
                            !target.hidden,
                          )
                        }
                      >
                        {target.hidden ? `${target.name} 숨김 해제` : `${target.name} 숨기기`}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : error ? null : (
        <div className="empty-state">
          <strong>조건에 맞는 신고가 없어요</strong>
        </div>
      )}
      {data ? (
        <Pagination
          page={page}
          totalPages={data.totalPages}
          onChange={(next) => update({ page: String(next) })}
        />
      ) : null}
    </section>
  );
}

function AdminAudit() {
  useDocumentTitle("감사 로그");
  const { session } = useAuth();
  const { params, update, page } = useUrlFilters();
  const action = params.get("action") ?? "";
  const actorId = params.get("actorId") ?? "";
  const targetId = params.get("targetId") ?? "";
  const query = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  if (action) query.set("action", action);
  if (actorId) query.set("actorId", actorId);
  if (targetId) query.set("targetId", targetId);
  const path = `/admin/audit?${query}`;
  const { data, loading, error } = useRequest<Page<AdminAuditEvent> | null>(
    (signal) => api(path, { signal }, session?.accessToken),
    null,
    "감사 로그를 불러오지 못했습니다.",
    [path, session?.accessToken],
  );
  const first = data?.items[0];
  const chip = (key: "actorId" | "targetId", label: string, name?: string | null) =>
    params.get(key) ? (
      <button
        type="button"
        className="pill admin-chip"
        aria-label={`${label} 조건 지우기`}
        onClick={() => update({ [key]: null })}
      >
        {label}: {name ?? shortId(params.get(key)!)} ×
      </button>
    ) : null;
  return (
    <section aria-label="감사 로그">
      <div className="filter-card">
        <div className="filter-row">
          <Select
            ariaLabel="동작 필터"
            value={action}
            options={[
              { value: "", label: "모든 동작" },
              ...Object.entries(actionLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
            onChange={(next) => update({ action: next || null })}
          />
          {chip(
            "actorId",
            "수행자",
            first && first.actorId === actorId ? first.actorUsername : null,
          )}
          {chip(
            "targetId",
            "대상",
            first && first.targetId === targetId ? first.targetUsername : null,
          )}
        </div>
      </div>
      <p className="muted admin-count" role="status" aria-live="polite">
        {data ? `기록 ${data.total}건` : ""}
      </p>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <SkeletonRows count={6} columns={5} />
      ) : data?.items.length ? (
        <table className="ent-table admin-table">
          <thead>
            <tr>
              <th scope="col">시각</th>
              <th scope="col">동작</th>
              <th scope="col">수행자</th>
              <th scope="col">대상</th>
              <th scope="col">상세</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((event) => (
              <tr key={event.id}>
                <td className="ent-period">{dateTime(event.createdAt)}</td>
                <td>{actionLabels[event.action] ?? event.action}</td>
                <td data-label="수행자">
                  {event.actorId ? (
                    <button
                      type="button"
                      className="text-button"
                      title="이 수행자의 기록만 보기"
                      onClick={() => update({ actorId: event.actorId })}
                    >
                      {event.actorUsername ?? shortId(event.actorId)}
                    </button>
                  ) : (
                    <span className="muted">삭제된 사용자</span>
                  )}
                </td>
                <td data-label="대상">
                  <button
                    type="button"
                    className="text-button"
                    title="이 대상의 기록만 보기"
                    onClick={() => update({ targetId: event.targetId })}
                  >
                    {event.targetUsername ??
                      `${event.targetType} ${shortId(event.targetId)}`}
                  </button>
                </td>
                <td>
                  <code className="admin-details">
                    {Object.keys(event.details ?? {}).length
                      ? JSON.stringify(event.details)
                      : "—"}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : error ? null : (
        <div className="empty-state">
          <strong>조건에 맞는 기록이 없어요</strong>
        </div>
      )}
      {data ? (
        <Pagination
          page={page}
          totalPages={data.totalPages}
          onChange={(next) => update({ page: String(next) })}
        />
      ) : null}
    </section>
  );
}

const queueLabels: [keyof AdminOps["queue"], string][] = [
  ["waiting", "대기"],
  ["active", "채점 중"],
  ["delayed", "지연"],
  ["failed", "실패"],
];

function AdminOpsView() {
  useDocumentTitle("운영 상태");
  const { session } = useAuth();
  const [version, setVersion] = useState(0);
  const { data, loading, error } = useRequest<AdminOps | null>(
    (signal) => api("/admin/ops", { signal }, session?.accessToken),
    null,
    "운영 상태를 불러오지 못했습니다.",
    [session?.accessToken, version],
  );
  return (
    <section aria-label="운영 상태">
      <div className="admin-ops-head">
        <p className="muted" role="status">
          {data ? `${dateTime(data.timestamp)} 기준` : ""}
        </p>
        <button
          type="button"
          className="button button-outline button-small"
          disabled={loading}
          onClick={() => setVersion((value) => value + 1)}
        >
          새로고침
        </button>
      </div>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <SkeletonRows count={4} columns={4} />
      ) : data ? (
        <>
          <div className="stat-tiles" aria-label="채점 큐">
            {queueLabels.map(([key, label]) => (
              <div className="stat-tile" key={key}>
                <small>큐 {label}</small>
                <strong>{data.queue[key] ?? 0}</strong>
              </div>
            ))}
          </div>
          <div className="admin-ops-grid">
            <section aria-labelledby="ops-workers">
              <h2 id="ops-workers">워커 {data.workers.length}대</h2>
              {data.workers.length ? (
                <ul className="admin-list">
                  {data.workers.map((worker) => (
                    <li key={worker.id}>
                      <code>{shortId(worker.id)}</code>
                      <span className="muted">
                        {dateTime(worker.lastSeenAt)} 응답
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="error-message" role="alert">
                  최근 30초 안에 응답한 채점 워커가 없습니다.
                </p>
              )}
            </section>
            <section aria-labelledby="ops-submissions">
              <h2 id="ops-submissions">판정별 제출</h2>
              <ul className="admin-list">
                {data.submissions.map((row) => (
                  <li key={row.status}>
                    <span>{verdictLabel(row.status)}</span>
                    <strong>{row.count}</strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <section aria-labelledby="ops-failed">
            <h2 id="ops-failed">최근 실패 작업</h2>
            {data.recentFailedJobs.length ? (
              <ul className="admin-list">
                {data.recentFailedJobs.map((job) => (
                  <li key={job.id}>
                    <code>{job.id}</code>
                    <span>{job.failedReason}</span>
                    <span className="muted">{job.attemptsMade}회 시도</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">실패한 작업이 없습니다.</p>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
