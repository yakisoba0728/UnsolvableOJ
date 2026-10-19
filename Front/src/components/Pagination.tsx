interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

/** 이전 · 1 2 3 4 5 … 마지막 · 다음 (Figma 페이지 이동) */
export function Pagination({ page, totalPages, onChange }: PaginationProps) {
  if (totalPages <= 1) return null;
  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4, 5].forEach((value) => pages.add(value));
  const visible = [...pages]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  visible.forEach((value, index) => {
    if (index > 0 && value - visible[index - 1] > 1) items.push("gap");
    items.push(value);
  });
  return (
    <nav className="pagination" aria-label="페이지 이동">
      <button
        className="page-button page-nav"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        이전
      </button>
      {items.map((item, index) =>
        item === "gap" ? (
          <span className="page-gap" key={`gap-${index}`} aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            className={`page-button ${item === page ? "current" : ""}`}
            aria-current={item === page ? "page" : undefined}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ),
      )}
      <button
        className="page-button page-nav"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        다음
      </button>
    </nav>
  );
}
