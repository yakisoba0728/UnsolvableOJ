import dataSource from '../dist/database/data-source.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error('사용법: npm run db:bootstrap:admin -- admin@example.com');

await dataSource.initialize();
try {
  const changed = await dataSource.query(
    "UPDATE users SET role = 'ADMIN', token_version = token_version + 1, updated_at = now() WHERE email = $1 RETURNING id, email, role",
    [email],
  );
  if (!changed[0]) throw new Error('해당 이메일의 회원가입 계정이 없습니다.');
  console.log(`관리자 지정 완료: ${changed[0].email}. 다시 로그인해야 합니다.`);
} finally {
  await dataSource.destroy();
}
