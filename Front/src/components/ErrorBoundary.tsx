import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../monitoring";

interface State {
  failed: boolean;
}

/** 렌더링 중 예외가 나도 흰 화면 대신 복구 안내를 보여준다. */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  State
> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  // 다른 화면으로 이동하면 다시 그려 본다: 한 화면의 오류로 사이트 전체가 막히지 않게 한다.
  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    reportError(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page-width notfound-page" role="alert">
        <h1>화면을 표시하지 못했어요.</h1>
        <p>
          일시적인 문제일 수 있습니다. 새로고침해도 계속되면 잠시 후 다시
          시도해 주세요.
        </p>
        <div className="card-actions">
          <button className="button" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      </div>
    );
  }
}
