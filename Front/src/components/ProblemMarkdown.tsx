import type { ReactNode } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "var"],
  protocols: { ...defaultSchema.protocols, src: [...(defaultSchema.protocols?.src ?? []), "data"] },
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      ["style", /^(?:(?:color|background-color):\s*(?:#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\))|text-align:\s*(?:left|right|center|justify))(?:;\s*(?:(?:color|background-color):\s*(?:#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\))|text-align:\s*(?:left|right|center|justify)))*;?$/i],
    ],
    code: [
      ["className", /^language-./, "math-inline", "math-display"],
    ],
    td: [...(defaultSchema.attributes?.td ?? []), "rowSpan", "colSpan"],
    th: [...(defaultSchema.attributes?.th ?? []), "rowSpan", "colSpan"],
  },
};

const headingLevels = [1, 2, 3, 4, 5, 6] as const;

/**
 * headingOffset: 본문 안의 제목을 이만큼 낮춘다(# → h2). 글 제목이 이미 h1인 화면에서
 * 본문의 #이 h1을 또 만들지 않게 한다. 6단계를 넘으면 h6으로 둔다.
 */
export function ProblemMarkdown({
  children,
  headingOffset = 0,
}: {
  children: string;
  headingOffset?: number;
}) {
  const components = headingOffset
    ? Object.fromEntries(
        headingLevels.map((level) => {
          const Tag = `h${Math.min(6, level + headingOffset)}` as
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6";
          return [
            `h${level}`,
            ({ children: content }: { children?: ReactNode }) => (
              <Tag>{content}</Tag>
            ),
          ];
        }),
      )
    : undefined;
  return (
    <Markdown
      components={components}
      urlTransform={(url, key, node) =>
        key === "src" && node.tagName === "img" && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(url)
          ? url
          : defaultUrlTransform(url)
      }
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        rehypeRaw,
        [rehypeSanitize, schema],
        [rehypeKatex, { strict: false, trust: false }],
      ]}
    >
      {children}
    </Markdown>
  );
}
