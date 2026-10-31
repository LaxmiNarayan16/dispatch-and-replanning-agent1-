import type { AuthRepository, AuthUser, StoredUser } from "../application/auth.js";

export class PrismaAuthRepository implements AuthRepository {
  public constructor(private readonly database: Record<string, any>) {}
  public countUsers(): Promise<number> { return this.database.user.count(); }
  public async findByEmail(email: string): Promise<StoredUser | undefined> { return (await this.database.user.findUnique({ where: { email } })) ?? undefined; }
  public async findById(id: string): Promise<AuthUser | undefined> {
    const row = await this.database.user.findUnique({ where: { id }, select: { id: true, email: true, displayName: true, role: true } });
    return row ?? undefined;
  }
  public async createUser(input: AuthUser & { passwordHash: string }): Promise<AuthUser> {
    const { passwordHash, ...user } = await this.database.user.create({ data: input });
    return user;
  }
}
