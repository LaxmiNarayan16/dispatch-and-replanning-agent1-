import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type UserRole = "ADMIN" | "DISPATCHER" | "VIEWER";
export interface AuthUser { readonly id: string; readonly email: string; readonly displayName: string; readonly role: UserRole; }
export interface StoredUser extends AuthUser { readonly passwordHash: string; }
export interface AuthRepository {
  countUsers(): Promise<number>;
  findByEmail(email: string): Promise<StoredUser | undefined>;
  findById(id: string): Promise<AuthUser | undefined>;
  createUser(input: AuthUser & { readonly passwordHash: string }): Promise<AuthUser>;
}

export class AuthenticationError extends Error { public readonly name = "AuthenticationError"; }
export class AuthorizationError extends Error { public readonly name = "AuthorizationError"; }

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${encode(salt)}:${encode(key)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltEncoded, keyEncoded] = stored.split(":");
  if (!saltEncoded || !keyEncoded) return false;
  const expected = Buffer.from(keyEncoded, "base64url");
  const actual = await scrypt(password, Buffer.from(saltEncoded, "base64url"), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class AuthService {
  public constructor(private readonly repository: AuthRepository, private readonly secret: string) {
    if (secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  }

  public async bootstrap(input: { email: string; displayName: string; password: string }): Promise<AuthUser> {
    if (await this.repository.countUsers() > 0) throw new AuthorizationError("Initial setup is already complete.");
    return this.repository.createUser({ id: randomUUID(), email: normalizeEmail(input.email), displayName: input.displayName.trim(), role: "ADMIN", passwordHash: await passwordForStorage(input.password) });
  }

  public async login(email: string, password: string): Promise<{ readonly user: AuthUser; readonly token: string }> {
    const user = await this.repository.findByEmail(normalizeEmail(email));
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new AuthenticationError("Email or password is invalid.");
    return { user: withoutHash(user), token: this.createToken(withoutHash(user)) };
  }

  public async authenticate(token: string): Promise<AuthUser> {
    const [header, payload, signature] = token.split(".");
    const expectedSignature = header && payload ? this.sign(`${header}.${payload}`) : "";
    if (!header || !payload || !signature || signature.length !== expectedSignature.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) throw new AuthenticationError("Session token is invalid.");
    const claims = JSON.parse(decode(payload)) as { sub?: string; exp?: number };
    if (!claims.sub || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) throw new AuthenticationError("Session token has expired.");
    const user = await this.repository.findById(claims.sub);
    if (!user) throw new AuthenticationError("Session user no longer exists.");
    return user;
  }

  private createToken(user: AuthUser): string {
    const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = encode(JSON.stringify({ sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }));
    return `${header}.${payload}.${this.sign(`${header}.${payload}`)}`;
  }
  private sign(value: string): string { return createHmac("sha256", this.secret).update(value).digest("base64url"); }
}

function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
function withoutHash(user: StoredUser): AuthUser { const { passwordHash: _passwordHash, ...safe } = user; return safe; }
async function passwordForStorage(password: string): Promise<string> {
  if (password.length < 12) throw new AuthenticationError("Password must have at least 12 characters.");
  return hashPassword(password);
}
