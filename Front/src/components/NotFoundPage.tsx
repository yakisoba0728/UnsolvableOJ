import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

/** 404: 사과하는 짧은 문구 + 검색으로 빠져나갈 길 + 주요 이동 (NN/G 404 가이드) */
export function NotFoundPage() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  function search(event: FormEvent) {
    event.preventDefault();
    navigate(query.trim() ? `/problems?q=${encodeURIComponent(query.trim())}` : "/problems");
  }

  return (
    <div className="page-width notfound-page">
      <span className="notfound-code" aria-hidden="true">
        404
      </span>
      <h1>찾으시는 페이지가 없어요.</h1>
      <p>주소가 바뀌었거나 삭제된 페이지일 수 있습니다. 문제를 검색하거나 아래에서 이동해 보세요.</p>
      <form className="notfound-search" onSubmit={search} role="search">
        <input
          type="search"
          aria-label="문제 검색"
          placeholder="문제 제목 또는 주소 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="button">검색</button>
      </form>
      <div className="card-actions">
        <Link className="button button-soft" to="/">
          홈으로
        </Link>
        <Link className="button button-outline" to="/problems">
          문제 목록
        </Link>
      </div>
    </div>
  );
}
