interface FavoriteButtonProps {
  active: boolean;
  title: string;
  onToggle: () => void;
  className?: string;
}

/** 즐겨찾기 별. 링크 안에 중첩하지 않고 형제로 둔다(버튼을 눌러도 문제 페이지로 이동하지 않는다). */
export function FavoriteButton({ active, title, onToggle, className = "" }: FavoriteButtonProps) {
  return (
    <button
      type="button"
      className={`star-button ${active ? "active" : ""} ${className}`}
      aria-pressed={active}
      aria-label={`${title} 즐겨찾기`}
      title={active ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          d="m12 3.4 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8L12 3.4Z"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
