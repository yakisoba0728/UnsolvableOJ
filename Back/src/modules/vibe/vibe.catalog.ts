import { BadRequestException } from '@nestjs/common';
import type { ProjectFiles } from './vibe.types.js';

export const VIBE_LIMITS = {
  aiRequests: 20,
  runs: 20,
  dailyAttempts: 5,
  fileBytes: 30_000,
  minutes: 45,
};
export const editablePaths = [
  'src/search.ts',
  'src/tags.ts',
  'tests/search.test.ts',
];
// Published challenge IDs are immutable: change the ID when changing the contract or fixtures.
export const challenge = {
  id: 'post-search-v1',
  title: '게시글 검색 API 개선하기',
  summary:
    '검색 누락을 고치고 태그 필터를 추가하세요. 파트너와의 대화부터 회귀 테스트까지 함께 평가합니다.',
  difficulty: '입문 · 실무형',
  stack: 'TypeScript · Node.js',
  durationMin: VIBE_LIMITS.minutes,
  requirements: [
    'searchPosts(posts, query, tag)는 제목과 slug에서 검색합니다. 검색어 앞뒤 공백과 대소문자는 무시합니다.',
    '검색어가 비어 있으면 전체 게시글을 반환합니다. 입력 배열과 게시글은 수정하지 않습니다.',
    'tag가 주어지면 해당 태그가 정확히 일치하는 게시글만 반환합니다. 태그 비교는 대소문자를 구분합니다.',
    '검색과 태그 필터를 함께 적용하고 게시글의 원래 순서를 유지합니다.',
    'tests/search.test.ts에 버그 재현과 추가 기능의 회귀 테스트를 작성하세요.',
  ],
  rubric: [
    {
      label: '결과물',
      max: 40,
      description: '공개·숨김 기능 테스트 통과 여부',
    },
    {
      label: '프롬프트',
      max: 30,
      description: '맥락·문제·제약·완료 기준 전달과 후속 지시의 구체성',
    },
    {
      label: '협업·검증',
      max: 30,
      description: '변경 검토, 회귀 테스트, 실패 분석과 최종 검증의 근거',
    },
  ],
};

export const initialFiles: ProjectFiles = {
  'README.md': `# 게시글 검색 API\n\n${challenge.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nsearchPosts와 matchesTag는 외부 패키지 없이 동작해야 합니다. 공개 테스트는 고정된 기준이며, 작성한 테스트는 별도로 실행됩니다.\n`,
  'package.json':
    JSON.stringify(
      {
        name: 'post-search',
        private: true,
        type: 'module',
        scripts: { test: 'tsx tests/search.test.ts' },
        devDependencies: { tsx: '^4.0.0' },
      },
      null,
      2,
    ) + '\n',
  'src/search.ts': `import { matchesTag } from './tags';\n\nexport interface Post {\n  id: number;\n  title: string;\n  slug: string;\n  tags: string[];\n}\n\nexport function searchPosts(posts: Post[], query = '', tag = ''): Post[] {\n  return posts.filter(post => post.title.includes(query) && matchesTag(post.tags, tag));\n}\n`,
  'src/tags.ts': `export function matchesTag(tags: string[], tag: string): boolean {\n  return true;\n}\n`,
  'tests/search.test.ts': `import assert from 'node:assert/strict';\nimport { searchPosts } from '../src/search';\n\nconst posts = [\n  { id: 1, title: 'Hello TypeScript', slug: 'hello-ts', tags: ['입문'] },\n  { id: 2, title: '배열 정렬', slug: 'sort-array', tags: ['정렬'] },\n];\nassert.deepEqual(searchPosts(posts, 'Hello').map(post => post.id), [1]);\n// 버그를 재현하고 태그 필터를 확인하는 테스트를 추가하세요.\nconsole.log('작성한 테스트를 통과했습니다.');\n`,
};

const posts = [
  {
    id: 1,
    title: 'Hello TypeScript',
    slug: 'hello-ts',
    tags: ['입문', '구현'],
  },
  { id: 2, title: '배열 정렬', slug: 'sort-array', tags: ['정렬'] },
  { id: 3, title: 'HELLO Node', slug: 'node-api', tags: ['구현'] },
];
export const publicChecks = [
  {
    name: '제목의 대소문자를 무시하고 검색',
    input: { posts, query: 'hello' },
    expected: [1, 3],
  },
  {
    name: '검색어 앞뒤 공백 제거',
    input: { posts, query: '  HELLO  ' },
    expected: [1, 3],
  },
  { name: 'slug로 검색', input: { posts, query: 'SORT-ARRAY' }, expected: [2] },
  {
    name: '태그가 정확히 일치하는 게시글',
    input: { posts, query: '', tag: '구현' },
    expected: [1, 3],
  },
  {
    name: '검색과 태그를 함께 적용',
    input: { posts, query: 'hello', tag: '입문' },
    expected: [1],
  },
];
export const hiddenChecks = [
  { name: '숨김 테스트 1', input: { posts, query: ' ' }, expected: [1, 2, 3] },
  {
    name: '숨김 테스트 2',
    input: { posts: [], query: '', tag: '' },
    expected: [],
  },
  {
    name: '숨김 테스트 3',
    input: { posts, query: 'hello', tag: '없는 태그' },
    expected: [],
  },
  {
    name: '숨김 테스트 4',
    input: {
      posts: [{ id: 8, title: 'x', slug: 'x', tags: ['Tag'] }],
      query: '',
      tag: 'tag',
    },
    expected: [],
  },
  {
    name: '숨김 테스트 5',
    input: { posts: [...posts].reverse(), query: 'HELLO', tag: '' },
    expected: [3, 1],
  },
  {
    name: '숨김 테스트 6',
    input: { posts, query: '없는 검색어', tag: '' },
    expected: [],
  },
];

export const harness = `import { readFileSync } from 'node:fs';\nimport { searchPosts } from './src/search';\nconst { posts, query = '', tag = '' } = JSON.parse(readFileSync(0, 'utf8'));\nconst before = JSON.stringify(posts);\nconst result = searchPosts(posts, query, tag);\nif (JSON.stringify(posts) !== before) throw new Error('입력 데이터를 수정했습니다.');\nprocess.stdout.write(JSON.stringify(result.map(post => post.id)));\n`;

export function validateFiles(value: unknown, partial = false): ProjectFiles {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('프로젝트 파일 형식이 올바르지 않습니다.');
  const entries = Object.entries(value);
  if (
    (!partial && entries.length !== editablePaths.length) ||
    entries.length > editablePaths.length ||
    entries.some(
      ([path, content]) =>
        !editablePaths.includes(path) ||
        typeof content !== 'string' ||
        !/^[^\0\p{Cs}]*$/u.test(content) ||
        Buffer.byteLength(content) > VIBE_LIMITS.fileBytes,
    )
  )
    throw new BadRequestException(
      '수정 가능한 파일과 파일당 30KB 제한을 확인해 주세요.',
    );
  return Object.fromEntries(entries) as ProjectFiles;
}

export const editableFiles = () =>
  Object.fromEntries(editablePaths.map((path) => [path, initialFiles[path]]));
