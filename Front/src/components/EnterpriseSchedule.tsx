import type { EnterpriseTest } from "../enterprise/model";

export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

export function EnterpriseStorageNotice() {
  return (
    <p className="local-storage-notice" role="note">
      기업 테스트는 이 계정의 현재 브라우저에만 저장되며 다른 기기·사용자와
      공유되지 않습니다. 일정상 상태만 표시하며 실제 응시·결과 수집은 아직
      제공되지 않습니다.
    </p>
  );
}

export function EnterpriseSchedule({
  test,
  compact = false,
}: {
  test: Pick<EnterpriseTest, "startsAt" | "endsAt">;
  compact?: boolean;
}) {
  const format = (iso: string) =>
    new Date(iso).toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
  const contents = (
    <>
      <dl className="enterprise-exact-schedule">
        <div>
          <dt>시작</dt>
          <dd>
            <time dateTime={test.startsAt}>{format(test.startsAt)}</time>
          </dd>
        </div>
        <div>
          <dt>종료</dt>
          <dd>
            <time dateTime={test.endsAt}>{format(test.endsAt)}</time>
          </dd>
        </div>
      </dl>
      <p className="schedule-zone muted">
        기준 시간대: {deviceTimeZone()} (이 기기의 현지 시간)
      </p>
    </>
  );
  return compact ? (
    <details className="enterprise-schedule">
      <summary>정확한 일시·시간대</summary>
      {contents}
    </details>
  ) : (
    <section className="enterprise-schedule" aria-label="정확한 테스트 일정">
      {contents}
    </section>
  );
}
