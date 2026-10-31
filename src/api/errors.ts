export class AppError extends Error {
  public readonly name = "AppError";

  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
