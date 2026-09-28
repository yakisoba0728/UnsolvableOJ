import { PasswordHasher } from './password-hasher.service.js';

describe('PasswordHasher', () => {
  const passwordHasher = new PasswordHasher();

  it('hashes and verifies a password without storing the plain text', async () => {
    const password = 'a-strong-password';
    const hash = await passwordHasher.hash(password);

    expect(hash).not.toContain(password);
    await expect(passwordHasher.verify(password, hash)).resolves.toBe(true);
  });

  it('rejects a different password and malformed hashes', async () => {
    const hash = await passwordHasher.hash('correct-password');

    await expect(passwordHasher.verify('wrong-password', hash)).resolves.toBe(
      false,
    );
    await expect(
      passwordHasher.verify('correct-password', 'not-a-valid-hash'),
    ).resolves.toBe(false);
  });
});
