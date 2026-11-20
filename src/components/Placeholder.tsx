/** まだ作っていない画面 */
export function Placeholder(props: { title: string; text: string; onBack?: () => void }) {
  return (
    <div className="page">
      <header className="page-head">
        {props.onBack && (
          <button className="ghost" onClick={props.onBack}>
            ← 一覧
          </button>
        )}
        <h2>{props.title}</h2>
      </header>
      <div className="empty">{props.text}</div>
    </div>
  );
}
