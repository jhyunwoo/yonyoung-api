import { R2_STORAGE_LIMIT_BYTES } from "../storage/usage";

export const UPLOAD_RESERVATION_MAX_ACTIVE_PER_ACTOR = 10;
export const UPLOAD_RESERVATION_MAX_BYTES_PER_ACTOR = 1024 * 1024 * 1024;
export const UPLOAD_RESERVATION_EXPIRED_CLEANUP_LIMIT = 100;
export const UPLOAD_RESERVATION_OBSERVATION_MAX_AGE_MS = 30 * 1000;
export const UPLOAD_RESERVATION_CLEANUP_GRACE_MS = 60 * 1000;
export const UPLOAD_RESERVATION_SETTLEMENT_GRACE_MS = 2 * 60 * 1000;

export class UploadReservationLimitError extends Error {
  constructor() {
    super("동시에 예약할 수 있는 업로드 수 또는 용량을 초과했습니다.");
    this.name = "UploadReservationLimitError";
  }
}

export class UploadStorageCapacityError extends Error {
  constructor() {
    super("예약된 업로드를 포함하면 버킷 저장공간 10GB 한도를 초과합니다.");
    this.name = "UploadStorageCapacityError";
  }
}

export class UploadReservationObservationStaleError extends Error {
  constructor() {
    super("스토리지 사용량 관측이 만료되어 업로드를 차단했습니다.");
    this.name = "UploadReservationObservationStaleError";
  }
}

export type UploadReservation = {
  id: string;
  actorId: string;
  fileSize: number;
  observedUsedBytes: number;
  observedAt: number;
  grantExpiresAt: number;
  expiresAt: number;
};

export interface UploadReservationStore {
  assertActorCapacity(
    actorId: string,
    fileSize: number,
    now: number,
  ): Promise<void>;
  reserve(reservation: UploadReservation): Promise<void>;
  get(id: string): Promise<UploadReservation | null>;
  remove(id: string): Promise<void>;
  settle(id: string, expiresAt: number): Promise<void>;
}

type UploadReservationDatabase = Pick<D1Database, "prepare">;

type UploadReservationRow = {
  id: string;
  actor_id: string;
  file_size: number;
  observed_used_bytes: number;
  observed_at: number;
  grant_expires_at: number;
  expires_at: number;
};

const toReservation = (row: UploadReservationRow): UploadReservation => ({
  id: row.id,
  actorId: row.actor_id,
  fileSize: Number(row.file_size),
  observedUsedBytes: Number(row.observed_used_bytes),
  observedAt: Number(row.observed_at),
  grantExpiresAt: Number(row.grant_expires_at),
  expiresAt: Number(row.expires_at),
});

const constraintMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).toUpperCase();

export const createD1UploadReservationStore = (
  database: UploadReservationDatabase,
): UploadReservationStore => {
  const assertActorCapacity = async (
    actorId: string,
    fileSize: number,
    now: number,
  ) => {
    const active = await database
      .prepare(
        `
          SELECT
            SUM(CASE WHEN grant_expires_at > ? THEN 1 ELSE 0 END) AS count,
            COALESCE(SUM(file_size), 0) AS reserved_bytes
          FROM upload_reservations
          WHERE actor_id = ? AND expires_at > ?
        `,
      )
      .bind(now, actorId, now)
      .first<{ count: number; reserved_bytes: number }>();
    if (
      Number(active?.count ?? 0) >= UPLOAD_RESERVATION_MAX_ACTIVE_PER_ACTOR ||
      Number(active?.reserved_bytes ?? 0) + fileSize >
        UPLOAD_RESERVATION_MAX_BYTES_PER_ACTOR
    ) {
      throw new UploadReservationLimitError();
    }
  };

  return {
    assertActorCapacity,

    async reserve(reservation) {
      const now = Date.now();
      await database
        .prepare(
          `
          DELETE FROM upload_reservations
          WHERE id IN (
            SELECT id
            FROM upload_reservations
            WHERE expires_at <= ?
            ORDER BY expires_at ASC
            LIMIT ?
          )
          `,
        )
        .bind(
          now - UPLOAD_RESERVATION_CLEANUP_GRACE_MS,
          UPLOAD_RESERVATION_EXPIRED_CLEANUP_LIMIT,
        )
        .run();

      try {
        const result = await database
          .prepare(
            `
            INSERT INTO upload_reservations (
              id,
              actor_id,
              file_size,
              observed_used_bytes,
              observed_at,
              grant_expires_at,
              expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .bind(
            reservation.id,
            reservation.actorId,
            reservation.fileSize,
            reservation.observedUsedBytes,
            reservation.observedAt,
            reservation.grantExpiresAt,
            reservation.expiresAt,
          )
          .run();

        if ((result as { success?: boolean }).success === false) {
          throw new Error("upload reservation failed");
        }
      } catch (error) {
        const message = constraintMessage(error);
        if (message.includes("UPLOAD_ACTIVE_RESERVATION_LIMIT")) {
          throw new UploadReservationLimitError();
        }
        if (message.includes("UPLOAD_STORAGE_CAPACITY_EXCEEDED")) {
          throw new UploadStorageCapacityError();
        }
        if (message.includes("UPLOAD_RESERVATION_OBSERVATION_STALE")) {
          throw new UploadReservationObservationStaleError();
        }
        throw error;
      }
    },

    async get(id) {
      const row = await database
        .prepare(
          `
          SELECT
            id,
            actor_id,
            file_size,
            observed_used_bytes,
            observed_at,
            grant_expires_at,
            expires_at
          FROM upload_reservations
          WHERE id = ?
          LIMIT 1
          `,
        )
        .bind(id)
        .first<UploadReservationRow>();
      return row ? toReservation(row) : null;
    },

    async remove(id) {
      await database
        .prepare("DELETE FROM upload_reservations WHERE id = ?")
        .bind(id)
        .run();
    },

    async settle(id, expiresAt) {
      await database
        .prepare("UPDATE upload_reservations SET expires_at = ? WHERE id = ?")
        .bind(expiresAt, id)
        .run();
    },
  };
};

export const createMemoryUploadReservationStore = (): UploadReservationStore => {
  const reservations = new Map<string, UploadReservation>();

  const removeExpired = (now: number) => {
    for (const [id, existing] of reservations) {
      if (
        existing.expiresAt <=
        now - UPLOAD_RESERVATION_CLEANUP_GRACE_MS
      ) {
        reservations.delete(id);
      }
    }
  };

  const assertActorCapacity = async (
    actorId: string,
    fileSize: number,
    now: number,
  ) => {
    removeExpired(now);
    const actorReservations = [...reservations.values()].filter(
      (candidate) =>
        candidate.actorId === actorId && candidate.expiresAt > now,
    );
    const activeForActor = actorReservations.filter(
      (candidate) => candidate.grantExpiresAt > now,
    ).length;
    const reservedBytesForActor = actorReservations.reduce(
      (total, candidate) => total + candidate.fileSize,
      0,
    );
    if (
      activeForActor >= UPLOAD_RESERVATION_MAX_ACTIVE_PER_ACTOR ||
      reservedBytesForActor + fileSize > UPLOAD_RESERVATION_MAX_BYTES_PER_ACTOR
    ) {
      throw new UploadReservationLimitError();
    }
  };

  return {
    assertActorCapacity,

    async reserve(reservation) {
      const now = Date.now();
      removeExpired(now);
      if (
        reservation.observedAt <
          now - UPLOAD_RESERVATION_OBSERVATION_MAX_AGE_MS ||
        reservation.observedAt > now + 5_000
      ) {
        throw new UploadReservationObservationStaleError();
      }
      const active = [...reservations.values()].filter(
        (candidate) => candidate.expiresAt > reservation.observedAt,
      );
      await assertActorCapacity(reservation.actorId, reservation.fileSize, now);

      const reservedBytes = active.reduce(
        (total, candidate) => total + candidate.fileSize,
        0,
      );
      if (
        reservation.observedUsedBytes + reservedBytes + reservation.fileSize >
        R2_STORAGE_LIMIT_BYTES
      ) {
        throw new UploadStorageCapacityError();
      }

      if (reservations.has(reservation.id)) {
        throw new Error("SQLITE_CONSTRAINT: duplicate upload reservation");
      }
      reservations.set(reservation.id, { ...reservation });
    },

    async get(id) {
      const reservation = reservations.get(id);
      return reservation ? { ...reservation } : null;
    },

    async remove(id) {
      reservations.delete(id);
    },

    async settle(id, expiresAt) {
      const reservation = reservations.get(id);
      if (reservation) {
        reservations.set(id, { ...reservation, expiresAt });
      }
    },
  };
};
