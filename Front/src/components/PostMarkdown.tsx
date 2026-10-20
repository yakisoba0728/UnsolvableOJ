import Markdown from "react-markdown";

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number } };
}

/**
 * 밑줄(_)을 기울임·굵게 문법으로 쓰지 않고 글자 그대로 보여 준다.
 * `__init__`, `_private`, `_x_` 처럼 코드 이름을 본문에 적을 때 밑줄이 사라지는 것을 막는다.
 * `*기울임*`, `**굵게**`와 코드 블록은 그대로 동작한다.
 */
function remarkLiteralUnderscore() {
  return (tree: MdNode, file: { value?: unknown }) => {
    const source = String(file.value ?? "");
    const walk = (node: MdNode) => {
      if (!node.children) return;
      const next: MdNode[] = [];
      for (const child of node.children) {
        walk(child);
        const offset = child.position?.start.offset;
        if (
          (child.type === "emphasis" || child.type === "strong") &&
          offset !== undefined &&
          source[offset] === "_"
        ) {
          const mark = child.type === "strong" ? "__" : "_";
          next.push({ type: "text", value: mark }, ...(child.children ?? []), {
            type: "text",
            value: mark,
          });
        } else {
          next.push(child);
        }
      }
      node.children = next;
    };
    walk(tree);
  };
}

/** 글·답변 본문과 글 작성 미리보기가 함께 쓰는 마크다운 표시(같은 규칙이라 미리보기와 실제 글이 같다). */
export function PostMarkdown({ children }: { children: string }) {
  return (
    <Markdown remarkPlugins={[remarkLiteralUnderscore]}>{children}</Markdown>
  );
}
