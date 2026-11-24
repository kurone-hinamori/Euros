import { Component, type ReactNode } from "react";

/** 画面の表示中に起きたエラーを、真っ白にせずに知らせる */
export class ErrorBoundary extends Component<{ children: ReactNode; onBack: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <h2>画面を表示できませんでした</h2>
        <p className="error">{error.message}</p>
        <p className="muted">保存したキャラクターは消えていません。一覧に戻ってやり直してください。</p>
        <button
          className="primary"
          onClick={() => {
            this.setState({ error: null });
            this.props.onBack();
          }}
        >
          一覧に戻る
        </button>
      </div>
    );
  }
}
