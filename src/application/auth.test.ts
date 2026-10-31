import { describe, expect, it } from "vitest";

import { AuthService, AuthenticationError, AuthorizationError, type AuthRepository, type AuthUser, type StoredUser } from "./auth.js";

class FakeUsers implements AuthRepository {
  private readonly users: StoredUser[] = [];
  public countUsers(): Promise<number> { return Promise.resolve(this.users.length); }
  public async findByEmail(email: string): Promise<StoredUser | undefined> { return this.users.find((item) => item.email === email); }
  public async findById(id: string): Promise<AuthUser | undefined> { const item = this.users.find((user) => user.id === id); return item && { id: item.id, email: item.email, displayName: item.displayName, role: item.role }; }
  public async createUser(input: AuthUser & { passwordHash: string }): Promise<AuthUser> { this.users.push(input); return { id: input.id, email: input.email, displayName: input.displayName, role: input.role }; }
}

describe("authentication", () => {
  it("bootstraps one admin, authenticates it, and returns an authenticated user", async () => {
    const auth = new AuthService(new FakeUsers(), "a".repeat(32));
    const user = await auth.bootstrap({ email: "Admin@FieldOps.test", displayName: "Admin", password: "a-long-secure-password" });
    const session = await auth.login("admin@fieldops.test", "a-long-secure-password");

    expect(user.role).toBe("ADMIN");
    await expect(auth.authenticate(session.token)).resolves.toMatchObject({ email: "admin@fieldops.test", role: "ADMIN" });
  });

  it("rejects an invalid password and prevents a second public bootstrap", async () => {
    const auth = new AuthService(new FakeUsers(), "a".repeat(32));
    await auth.bootstrap({ email: "admin@fieldops.test", displayName: "Admin", password: "a-long-secure-password" });
    await expect(auth.login("admin@fieldops.test", "incorrect-password")).rejects.toBeInstanceOf(AuthenticationError);
    await expect(auth.bootstrap({ email: "second@fieldops.test", displayName: "Second", password: "another-secure-password" })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects a tampered token", async () => {
    const auth = new AuthService(new FakeUsers(), "a".repeat(32));
    await auth.bootstrap({ email: "admin@fieldops.test", displayName: "Admin", password: "a-long-secure-password" });
    const { token } = await auth.login("admin@fieldops.test", "a-long-secure-password");
    await expect(auth.authenticate(`${token}x`)).rejects.toBeInstanceOf(AuthenticationError);
  });
});
