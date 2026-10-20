import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../monitoring";

interface State {
  failed: boolean;
}

/** 렌더링 중 예외가 나도 흰 화면 대신 복구 안내를 보여준다. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    reportError(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page-width soon-page" role="alert">
        <h1>화면을 표시하지 못했어요.</h1>
        <p className="soon-lead">
          일시적인 문제일 수 있습니다. 새로고침해도 계속되면 잠시 후 다시
          시도해 주세요.
        </p>
        <button className="button" onClick={() => window.location.reload()}>
          새로고침
        </button>
      </div>
    );
  }
}
