export interface InAppNotification {
  readonly id: string;
  readonly technicianId: string;
  readonly technicianName: string;
  readonly scheduleVersionId: string;
  readonly scheduleVersionNumber: number;
  readonly type: string;
  readonly message: string;
  readonly deliveryStatus: "PENDING" | "DELIVERED" | "FAILED";
  readonly createdAt: Date;
}

export interface NotificationRepository {
  list(limit?: number): Promise<readonly InAppNotification[]>;
  acknowledge(id: string): Promise<boolean>;
}

type Database = Record<string, any>;

export class PrismaNotificationRepository implements NotificationRepository {
  public constructor(private readonly database: Database) {}

  public async list(limit = 30): Promise<readonly InAppNotification[]> {
    const rows = await this.database.mockNotification.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { technician: { select: { name: true } }, scheduleVersion: { select: { versionNumber: true } } },
    });
    return rows.map((row: any) => ({
      id: row.id, technicianId: row.technicianId, technicianName: row.technician.name,
      scheduleVersionId: row.scheduleVersionId, scheduleVersionNumber: row.scheduleVersion.versionNumber,
      type: row.type, message: row.message, deliveryStatus: row.deliveryStatus, createdAt: row.createdAt,
    }));
  }

  public async acknowledge(id: string): Promise<boolean> {
    const result = await this.database.mockNotification.updateMany({
      where: { id, deliveryStatus: "PENDING" }, data: { deliveryStatus: "DELIVERED" },
    });
    return result.count === 1;
  }
}
