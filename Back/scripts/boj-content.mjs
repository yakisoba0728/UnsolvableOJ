import { createHash } from 'node:crypto';
import domino from '@mixmark-io/domino';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export const normalizeNewlines = (value) => value.replace(/\r\n?/g, '\n');

export function assertNoNul(value, slug) {
  if (typeof value === 'string') {
    if (value.includes('\u0000')) throw new Error(`NUL in ${slug}`);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) assertNoNul(child, slug);
  }
}

export function mapDifficulty(level) {
  if (!level) return 'MEDIUM';
  if (level <= 5) return 'BEGINNER';
  if (level <= 10) return 'EASY';
  if (level <= 15) return 'MEDIUM';
  if (level <= 20) return 'HARD';
  return 'EXPERT';
}

export function htmlToMarkdown(html, baseUrl, warnings = []) {
  const document = domino.createDocument(
    `<body>${normalizeNewlines(html)}</body>`,
  );
  const body = document.body;
  for (const node of body.querySelectorAll('script,style,meta,link'))
    node.remove();
  for (const node of Array.from(body.querySelectorAll('*'))) {
    if (!/^[a-z][a-z0-9:-]*$/i.test(node.localName)) {
      node.replaceWith(...Array.from(node.childNodes));
      warnings.push('unwrapped_invalid_element');
      continue;
    }
    const safeStyles = (node.getAttribute('style') || '')
      .split(';')
      .map((s) => s.trim())
      .filter(
        (s) =>
          /^(?:color|background-color):\s*(?:#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\))$/i.test(
            s,
          ) || /^text-align:\s*(?:left|right|center|justify)$/i.test(s),
      );
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name) || ['style', 'srcdoc'].includes(attr.name))
        node.removeAttribute(attr.name);
    }
    if (safeStyles.length) node.setAttribute('style', safeStyles.join('; '));
    for (const attribute of ['src', 'href', 'poster']) {
      const value = node.getAttribute(attribute);
      if (!value) continue;
      if (
        node.nodeName === 'IMG' &&
        attribute === 'src' &&
        /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)
      )
        continue;
      try {
        const url = new URL(value, baseUrl);
        if (['http:', 'https:'].includes(url.protocol))
          node.setAttribute(attribute, url.href);
        else node.removeAttribute(attribute);
      } catch {
        node.removeAttribute(attribute);
      }
    }
  }
  for (const node of Array.from(
    body.querySelectorAll('iframe,video,audio,object,embed,canvas,svg'),
  )) {
    const address =
      node.getAttribute('src') ||
      node.getAttribute('data') ||
      node.querySelector('source')?.getAttribute('src');
    const link = document.createElement('a');
    let url;
    try {
      url = new URL(address || baseUrl, baseUrl);
    } catch {
      url = new URL(baseUrl);
    }
    link.setAttribute(
      'href',
      ['http:', 'https:'].includes(url.protocol) ? url.href : baseUrl,
    );
    link.textContent = `${node.localName === 'iframe' || node.localName === 'video' ? '영상' : '시각 자료'} 보기`;
    node.replaceWith(link);
    warnings.push(`linked_media:${node.localName}`);
  }
  // Protect TeX before Turndown escapes backslashes and underscores. Text nodes
  // avoid matching dollar signs or delimiters inside HTML attributes and code.
  const math = new Map();
  const namespace = createHash('sha256')
    .update(html)
    .digest('hex')
    .slice(0, 16);
  function protect(node) {
    if (
      node.nodeType === 1 &&
      ['PRE', 'CODE', 'TEXTAREA'].includes(node.nodeName)
    )
      return;
    if (node.nodeType === 3) {
      node.data = node.data.replace(
        /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g,
        (_, display, inline, displayDollar, inlineDollar) => {
          const token = `BOJMATH${namespace}X${math.size}END`;
          const isDisplay =
            display !== undefined || displayDollar !== undefined;
          const expression = (
            display ??
            inline ??
            displayDollar ??
            inlineDollar
          ).trim();
          math.set(token, {
            expression,
            isDisplay,
            markdown: isDisplay
              ? `\n\n$$\n${expression}\n$$\n\n`
              : `$${expression}$`,
          });
          return token;
        },
      );
    } else for (const child of Array.from(node.childNodes)) protect(child);
  }
  protect(body);
  const converter = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  converter.use(gfm);
  const escape = converter.escape.bind(converter);
  converter.escape = (text) =>
    escape(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rawWithMath = (html) => {
    for (const [token, value] of math) {
      const escaped = value.expression
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      html = html.replaceAll(
        token,
        () =>
          `<code class="math-${value.isDisplay ? 'display' : 'inline'}">${escaped}</code>`,
      );
    }
    return html;
  };
  converter.addRule('preformatted', {
    filter: 'pre',
    replacement: (_, node) => {
      const value = node.textContent.replace(/\n$/, '');
      const size = Math.max(
        3,
        ...Array.from(value.matchAll(/`+/g), (m) => m[0].length + 1),
      );
      const fence = '`'.repeat(size);
      return `\n\n${fence}\n${value}\n${fence}\n\n`;
    },
  });
  converter.addRule('inline-semantics', {
    filter: ['sup', 'sub', 'u', 'var'],
    replacement: (_, node) => rawWithMath(node.outerHTML),
  });
  converter.addRule('colored-text', {
    filter: (node) =>
      ['SPAN', 'P', 'DIV', 'FONT'].includes(node.nodeName) &&
      node.hasAttribute('style'),
    replacement: (_, node) => rawWithMath(node.outerHTML),
  });
  // HTML tables retain merged cells, captions, line breaks and image cells.
  // Character references keep PRE whitespace without ending Markdown's raw HTML block.
  // Double an initial LF because the HTML parser ignores one after <pre>.
  converter.addRule('tables', {
    filter: 'table',
    replacement: (_, node) =>
      `\n\n${rawWithMath(node.outerHTML)
        .replace(/(<pre\b[^>]*>)([\s\S]*?)(<\/pre>)/gi, (_, open, text, close) =>
          `${open}${text.replace(/^\n/, '\n\n').replace(/\n/g, '&#10;')}${close}`,
        )
        .replace(/\n/g, ' ')}\n\n`,
  });
  let markdown = converter.turndown(body);
  for (const [token, value] of math)
    markdown = markdown.replaceAll(token, () => value.markdown);
  return markdown.trim();
}

export function prepareProblem(record, status = 'PUBLISHED') {
  const warnings = [];
  const convert = (html) => htmlToMarkdown(html, record.url, warnings);
  const sections = record.sections.filter((s) => !s.hidden);
  const description = sections.find((s) => s.kind === 'description');
  if (!description?.text || !/[가-힣]/.test(description.text))
    throw new Error(`Missing saved Korean body: ${record.problem_id}`);
  const level = record.difficulty?.level ?? 0;
  const parts = [
    '> 공개 예제로만 채점하는 문제입니다.',
    convert(description.html),
  ];
  for (const section of sections) {
    if (
      ['description', 'input', 'output', 'problem_association'].includes(
        section.kind,
      )
    )
      continue;
    const content = convert(section.html);
    if (content) {
      const heading = `## ${section.heading || section.kind}`;
      parts.push(
        content.startsWith(heading + '\n')
          ? content
          : `${heading}\n\n${content}`,
      );
    }
  }
  if (!level)
    parts.push(
      '> 원본 난이도는 미평가이며, 이 사이트에서는 임시로 보통으로 분류했습니다.',
    );
  parts.push(`[원문: BOJ ${record.problem_id}번](${record.url})`);
  const dto = {
    slug: `boj-${record.problem_id}`,
    title: record.title,
    status,
    statementMarkdown: parts.join('\n\n'),
    inputDescriptionMarkdown: convert(
      sections.find((s) => s.kind === 'input')?.html || '',
    ),
    outputDescriptionMarkdown: convert(
      sections.find((s) => s.kind === 'output')?.html || '',
    ),
    difficulty: mapDifficulty(level),
    timeLimitMs: Math.round(record.limits.time_seconds * 1000),
    memoryLimitMb: record.limits.memory_mb,
    testCases: record.samples.map((s) => ({
      input: normalizeNewlines(s.input),
      expectedOutput: normalizeNewlines(s.output),
      isSample: true,
      score: 1,
    })),
  };
  const provenance = {
    provider: 'BOJ',
    problemId: record.problem_id,
    url: record.url,
    originalSource: record.source,
    originalDifficulty: record.difficulty,
    originalLabels: record.labels,
    tags: record.classification.tags,
    sampleOnly: true,
    newlineNormalization: 'LF',
    conversionWarnings: [...new Set(warnings)],
  };
  const importHash = createHash('sha256')
    .update(JSON.stringify({ dto, provenance }))
    .digest('hex');
  return { dto, provenance: { ...provenance, importHash } };
}
