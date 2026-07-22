export const MULTIPART_UPLOAD_STATE_TTL_MS = 2 * 60 * 60 * 1000;
export const MULTIPART_UPLOAD_MAX_ACTIVE_PER_ACTOR = 10;
export const MULTIPART_UPLOAD_EXPIRED_CLEANUP_LIMIT = 10;

export class MultipartUploadLimitError extends Error {
  constructor() {
    super("동시에 진행할 수 있는 멀티파트 업로드 수를 초과했습니다.");
    this.name = "MultipartUploadLimitError";
  }
}

export type MultipartUploadState = {
  uploadId: string;
  objectKey: string;
  reservationId?: string | null;
  actorId: string;
  contentType: string;
  fileSize: number;
  partSize: number;
  maxPartNumber: number;
  expiresAt: number;
};

export interface MultipartUploadStateStore {
  assertActorCapacity(actorId: string, now: number): Promise<void>;
  reserve(state: MultipartUploadState): Promise<void>;
  get(uploadId: string, objectKey: string): Promise<MultipartUploadState | null>;
  remove(uploadId: string, objectKey: string): Promise<void>;
  listExpiredByActor(
    actorId: string,
    now: number,
    limit: number,
  ): Promise<MultipartUploadState[]>;
}

type MultipartStateDatabase = Pick<D1Database, "prepare">;

type MultipartUploadRow = {
  upload_id: string;
  object_key: string;
  reservation_id: string | null;
  actor_id: string;
  content_type: string;
  file_size: number;
  part_size: number;
  max_part_number: number;
  expires_at: number;
};

type CountRow = { count: number };

const isActiveUploadLimitConstraint = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("multipart_active_upload_limit");
};

const toState = (row: MultipartUploadRow): MultipartUploadState => ({
  uploadId: row.upload_id,
  objectKey: row.object_key,
  reservationId: row.reservation_id,
  actorId: row.actor_id,
  contentType: row.content_type,
  fileSize: Number(row.file_size),
  partSize: Number(row.part_size),
  maxPartNumber: Number(row.max_part_number),
  expiresAt: Number(row.expires_at),
});

export const createD1MultipartUploadStateStore = (
  database: MultipartStateDatabase,
): MultipartUploadStateStore => {
  const assertActorCapacity = async (actorId: string, now: number) => {
    const active = await database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM multipart_uploads
          WHERE actor_id = ? AND expires_at > ?
        `,
      )
      .bind(actorId, now)
      .first<CountRow>();
    if (Number(active?.count ?? 0) >= MULTIPART_UPLOAD_MAX_ACTIVE_PER_ACTOR) {
      throw new MultipartUploadLimitError();
    }
  };

  return {
    assertActorCapacity,

    async reserve(state) {
      await assertActorCapacity(state.actorId, Date.now());

      try {
        const result = await database
          .prepare(
            `
            INSERT INTO multipart_uploads (
              upload_id,
              object_key,
              reservation_id,
              actor_id,
              content_type,
              file_size,
              part_size,
              max_part_number,
              expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          )
          .bind(
            state.uploadId,
            state.objectKey,
            state.reservationId ?? null,
            state.actorId,
            state.contentType,
            state.fileSize,
            state.partSize,
            state.maxPartNumber,
            state.expiresAt,
          )
          .run();

        if ((result as { success?: boolean }).success === false) {
          throw new Error("multipart upload state reservation failed");
        }
      } catch (error) {
        if (isActiveUploadLimitConstraint(error)) {
          throw new MultipartUploadLimitError();
        }
        throw error;
      }
    },

    async get(uploadId, objectKey) {
      const row = await database
        .prepare(
          `
            SELECT
              upload_id,
              object_key,
              reservation_id,
              actor_id,
              content_type,
              file_size,
              part_size,
              max_part_number,
              expires_at
            FROM multipart_uploads
            WHERE upload_id = ? AND object_key = ?
            LIMIT 1
          `,
        )
        .bind(uploadId, objectKey)
        .first<MultipartUploadRow>();

      return row ? toState(row) : null;
    },

    async remove(uploadId, objectKey) {
      await database
        .prepare(
          "DELETE FROM multipart_uploads WHERE upload_id = ? AND object_key = ?",
        )
        .bind(uploadId, objectKey)
        .run();
    },

    async listExpiredByActor(actorId, now, limit) {
      const result = await database
        .prepare(
          `
            SELECT
              upload_id,
              object_key,
              reservation_id,
              actor_id,
              content_type,
              file_size,
              part_size,
              max_part_number,
              expires_at
            FROM multipart_uploads
            WHERE actor_id = ? AND expires_at <= ?
            ORDER BY expires_at ASC
            LIMIT ?
          `,
        )
        .bind(actorId, now, limit)
        .all<MultipartUploadRow>();

      return (result.results ?? []).map(toState);
    },
  };
};

export const createMemoryMultipartUploadStateStore = (): MultipartUploadStateStore => {
  const states = new Map<string, MultipartUploadState>();
  const keyFor = (uploadId: string, objectKey: string) => `${uploadId}\u0000${objectKey}`;

  const assertActorCapacity = async (actorId: string, now: number) => {
    const activeForActor = [...states.values()].filter(
      (candidate) => candidate.actorId === actorId && candidate.expiresAt > now,
    ).length;
    if (activeForActor >= MULTIPART_UPLOAD_MAX_ACTIVE_PER_ACTOR) {
      throw new MultipartUploadLimitError();
    }
  };

  return {
    assertActorCapacity,
    async reserve(state) {
      await assertActorCapacity(state.actorId, Date.now());

      const key = keyFor(state.uploadId, state.objectKey);
      if (states.has(key)) {
        throw new Error("SQLITE_CONSTRAINT: duplicate multipart upload state");
      }
      states.set(key, { ...state });
    },
    async get(uploadId, objectKey) {
      return states.get(keyFor(uploadId, objectKey)) ?? null;
    },
    async remove(uploadId, objectKey) {
      states.delete(keyFor(uploadId, objectKey));
    },
    async listExpiredByActor(actorId, now, limit) {
      return [...states.values()]
        .filter(
          (state) => state.actorId === actorId && state.expiresAt <= now,
        )
        .sort((left, right) => left.expiresAt - right.expiresAt)
        .slice(0, limit)
        .map((state) => ({ ...state }));
    },
  };
};
