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

export function ProblemMarkdown({ children }: { children: string }) {
  return (
    <Markdown
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
