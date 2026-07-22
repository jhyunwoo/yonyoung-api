import { describe, expect, it, vi } from "vitest";
import { R2_STORAGE_LIMIT_BYTES } from "../lib/storage/usage";
import {
  UPLOAD_RESERVATION_MAX_BYTES_PER_ACTOR,
  UPLOAD_RESERVATION_CLEANUP_GRACE_MS,
  UPLOAD_RESERVATION_OBSERVATION_MAX_AGE_MS,
  UPLOAD_RESERVATION_SETTLEMENT_GRACE_MS,
  UploadReservationLimitError,
  UploadReservationObservationStaleError,
  UploadStorageCapacityError,
  createMemoryUploadReservationStore,
  type UploadReservation,
} from "../lib/uploads/upload-reservation";

const activeReservation = (
  id: string,
  overrides: Partial<UploadReservation> = {},
): UploadReservation => ({
  id,
  actorId: "actor-1",
  fileSize: 1,
  observedUsedBytes: 0,
  observedAt: Date.now(),
  grantExpiresAt: Date.now() + 60_000,
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  ...overrides,
});

describe("memory upload reservation store", () => {
  it("동일 사용자의 11번째 활성 예약을 거부한다", async () => {
    const store = createMemoryUploadReservationStore();

    for (let index = 0; index < 10; index += 1) {
      await store.reserve(activeReservation(`reservation-${index}`));
    }

    await expect(
      store.reserve(activeReservation("reservation-10")),
    ).rejects.toBeInstanceOf(UploadReservationLimitError);
  });

  it("동일한 R2 관측값을 사용한 서로 다른 사용자의 예약 합계가 10GiB를 초과하면 거부한다", async () => {
    const store = createMemoryUploadReservationStore();
    const oneGiB = 1024 * 1024 * 1024;

    for (let index = 0; index < 10; index += 1) {
      await store.reserve(
        activeReservation(`reservation-${index}`, {
          actorId: `actor-${index}`,
          fileSize: oneGiB,
        }),
      );
    }

    await expect(
      store.reserve(
        activeReservation("reservation-10", {
          actorId: "actor-10",
          fileSize: oneGiB,
        }),
      ),
    ).rejects.toBeInstanceOf(UploadStorageCapacityError);
    expect(oneGiB * 10).toBe(R2_STORAGE_LIMIT_BYTES);
  });

  it("한 사용자의 활성 용량 예약 합계가 1GiB를 초과하면 거부한다", async () => {
    const store = createMemoryUploadReservationStore();
    await store.reserve(
      activeReservation("first", {
        fileSize: UPLOAD_RESERVATION_MAX_BYTES_PER_ACTOR,
      }),
    );

    await expect(
      store.reserve(activeReservation("second")),
    ).rejects.toBeInstanceOf(UploadReservationLimitError);
  });

  it("만료된 예약을 회수한 뒤 용량을 다시 예약할 수 있다", async () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      const store = createMemoryUploadReservationStore();
      await store.reserve(
        activeReservation("expired", {
          fileSize: UPLOAD_RESERVATION_MAX_BYTES_PER_ACTOR,
          observedAt: startedAt,
          grantExpiresAt: startedAt + 1_000,
          expiresAt: startedAt + 2_000,
        }),
      );
      vi.setSystemTime(
        startedAt + 2_000 + UPLOAD_RESERVATION_CLEANUP_GRACE_MS + 1,
      );

      await expect(
        store.reserve(
          activeReservation("replacement", {
            actorId: "actor-2",
            fileSize: UPLOAD_RESERVATION_MAX_BYTES_PER_ACTOR,
          }),
        ),
      ).resolves.toBeUndefined();
      expect(await store.get("expired")).toBeNull();
      expect(await store.get("replacement")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("완료 정착 유예 중에는 완료 직전 관측이 기존 예약을 계속 계산한다", async () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      const store = createMemoryUploadReservationStore();
      const oneGiB = UPLOAD_RESERVATION_MAX_BYTES_PER_ACTOR;
      await store.reserve(
        activeReservation("completed", {
          actorId: "actor-a",
          fileSize: oneGiB,
          observedAt: startedAt,
          grantExpiresAt: startedAt + 60_000,
          expiresAt: startedAt + 600_000,
        }),
      );
      const staleButFreshObservation = Date.now();
      vi.setSystemTime(startedAt + 1);
      await store.settle(
        "completed",
        Date.now() + UPLOAD_RESERVATION_SETTLEMENT_GRACE_MS,
      );

      await expect(
        store.reserve(
          activeReservation("racing", {
            actorId: "actor-b",
            fileSize: oneGiB,
            observedUsedBytes: R2_STORAGE_LIMIT_BYTES - oneGiB,
            observedAt: staleButFreshObservation,
          }),
        ),
      ).rejects.toBeInstanceOf(UploadStorageCapacityError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("30초보다 오래된 R2 사용량 관측을 거부한다", async () => {
    const store = createMemoryUploadReservationStore();
    await expect(
      store.reserve(
        activeReservation("stale-observation", {
          observedAt:
            Date.now() - UPLOAD_RESERVATION_OBSERVATION_MAX_AGE_MS - 1,
        }),
      ),
    ).rejects.toBeInstanceOf(UploadReservationObservationStaleError);
  });

  it("예약을 명시적으로 제거한다", async () => {
    const store = createMemoryUploadReservationStore();
    await store.reserve(activeReservation("removable"));

    await store.remove("removable");

    expect(await store.get("removable")).toBeNull();
  });
});
