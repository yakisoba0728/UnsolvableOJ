import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";

/** 기업 테스트 화면을 열 수 없을 때(로그인 전·없는 테스트·수정 불가) 보여 주는 안내 */
export function EnterpriseNotice({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="page-width">
      <PageHeader title={title} back={{ to: "/enterprise", label: "기업 테스트" }} />
      <div className="empty-state ent-empty">{children}</div>
    </div>
  );
}

/** 안내 안의 다음 행동 버튼 ("로그인하기 →") */
export function NoticeAction({
  to,
  from,
  children,
}: {
  to: string;
  /** 로그인 뒤 돌아올 주소 */
  from?: string;
  children: ReactNode;
}) {
  return (
    <Link className="button" to={to} state={from ? { from } : undefined}>
      {children} <span aria-hidden="true">→</span>
    </Link>
  );
}

export function TestNotFound({ title }: { title: string }) {
  return (
    <EnterpriseNotice title={title}>
      <strong>테스트를 찾을 수 없어요</strong>
      <p>삭제되었거나 이 브라우저에서 만든 테스트가 아닙니다.</p>
      <NoticeAction to="/enterprise">기업 테스트로</NoticeAction>
    </EnterpriseNotice>
  );
}
