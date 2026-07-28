import { describe, expect, it } from "vitest";
import {
  IDs,
  createActor,
  createPresignServiceMock,
  createTestApp,
  expectErrorCode,
  fn,
  readJson,
} from "./test-helpers";
import { MissingStorageConfigError } from "../lib/storage/presign";
import { UPLOAD_LIMITS } from "../lib/storage/presign";
import { R2_STORAGE_LIMIT_BYTES } from "../lib/storage/usage";
import {
  MULTIPART_UPLOAD_EXPIRED_CLEANUP_LIMIT,
  MultipartUploadLimitError,
  createMemoryMultipartUploadStateStore,
  type MultipartUploadState,
  type MultipartUploadStateStore,
} from "../lib/uploads/multipart-state";
import {
  createMemoryUploadReservationStore,
  type UploadReservation,
  type UploadReservationStore,
} from "../lib/uploads/upload-reservation";

const createActiveMultipartStateStore = async (
  overrides: Partial<MultipartUploadState> = {},
) => {
  const store = createMemoryMultipartUploadStateStore();
  await store.reserve({
    uploadId: "upload-id-1",
    objectKey: `activities/${IDs.manager}/detail/multipart-key`,
    actorId: IDs.manager,
    contentType: "image/png",
    fileSize: UPLOAD_LIMITS.multipartPartSizeBytes,
    partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
    maxPartNumber: 1,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  });
  return store;
};

const createObservedUploadReservationStore = () => {
  const backingStore = createMemoryUploadReservationStore();
  const reservedIds: string[] = [];
  const removedIds: string[] = [];
  const settledIds: string[] = [];
  const store: UploadReservationStore = {
    assertActorCapacity: (actorId, fileSize, now) =>
      backingStore.assertActorCapacity(actorId, fileSize, now),
    async reserve(reservation: UploadReservation) {
      await backingStore.reserve(reservation);
      reservedIds.push(reservation.id);
    },
    get: (id) => backingStore.get(id),
    async remove(id) {
      await backingStore.remove(id);
      removedIds.push(id);
    },
    async settle(id, expiresAt) {
      await backingStore.settle(id, expiresAt);
      settledIds.push(id);
    },
  };

  return { store, reservedIds, removedIds, settledIds };
};

describe("upload presign routes", /** describe 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 함수 실행 결과를 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ () => {
  const resourceRoutes = [
    {
      path: "/api/activities/presign/cover",
      role: "manager" as const,
      expected: { resource: "activities", slot: "cover" as const },
    },
    {
      path: "/api/activities/presign/detail",
      role: "manager" as const,
      expected: { resource: "activities", slot: "detail" as const },
    },
    {
      path: "/api/exhibitions/presign/cover",
      role: "manager" as const,
      expected: { resource: "exhibitions", slot: "cover" as const },
    },
    {
      path: "/api/exhibitions/presign/detail",
      role: "manager" as const,
      expected: { resource: "exhibitions", slot: "detail" as const },
    },
    {
      path: "/api/recruiting/presign/image",
      role: "vice_president" as const,
      expected: { resource: "notices", slot: "image" as const },
    },
  ];

  describe("upload capacity reservations", () => {
    it("서로 다른 11명의 1GiB 프로필 업로드 중 11번째를 presign 전에 차단한다", async () => {
      const reservationStore = createMemoryUploadReservationStore();
      const issuePresignedPutUrl = fn(async () => ({
        uploadUrl: "https://upload.example.com/signed",
        objectKey: "users/profile-key",
        publicUrl: "https://cdn.example.com/users/profile-key",
        requiredHeaders: { "Content-Type": "image/png" },
      }));
      const presignService = createPresignServiceMock({ issuePresignedPutUrl });
      const oneGiB = 1024 * 1024 * 1024;

      for (let index = 0; index < 11; index += 1) {
        const actorId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
        const app = createTestApp({
          actor: createActor("regular_member", actorId),
          presignService,
          readR2TotalUsageBytes: () => 0,
          uploadReservationStore: reservationStore,
        });
        const response = await app.request("/api/users/presign/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileName: `profile-${index}.png`,
            contentType: "image/png",
            fileSize: oneGiB,
          }),
        });

        if (index < 10) {
          expect(response.status).toBe(201);
        } else {
          expect(response.status).toBe(413);
          await expectErrorCode(response, "BAD_REQUEST");
        }
      }

      expect(issuePresignedPutUrl).toHaveBeenCalledTimes(10);
    });

    it("단일 presign 발급 실패 시 생성한 용량 예약을 해제한다", async () => {
      const observedStore = createObservedUploadReservationStore();
      const issuePresignedPutUrl = fn(async () => {
        throw new Error("presign failed");
      });
      const app = createTestApp({
        actor: createActor("regular_member", IDs.member),
        presignService: createPresignServiceMock({ issuePresignedPutUrl }),
        uploadReservationStore: observedStore.store,
      });

      const response = await app.request("/api/users/presign/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "profile.png",
          contentType: "image/png",
          fileSize: 1024,
        }),
      });

      expect(response.status).toBe(500);
      expect(observedStore.reservedIds).toHaveLength(1);
      expect(observedStore.removedIds).toEqual(observedStore.reservedIds);
      expect(
        await observedStore.store.get(observedStore.reservedIds[0]),
      ).toBeNull();
    });

    it("멀티파트 초기화 실패 시 생성한 용량 예약을 해제한다", async () => {
      const observedStore = createObservedUploadReservationStore();
      const initiateMultipartUpload = fn(async () => {
        throw new Error("multipart init failed");
      });
      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        presignService: createPresignServiceMock({ initiateMultipartUpload }),
        uploadReservationStore: observedStore.store,
      });

      const response = await app.request(
        "/api/activities/multipart/detail/init",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileName: "detail.png",
            contentType: "image/png",
            fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
          }),
        },
      );

      expect(response.status).toBe(500);
      expect(observedStore.reservedIds).toHaveLength(1);
      expect(observedStore.removedIds).toEqual(observedStore.reservedIds);
      expect(
        await observedStore.store.get(observedStore.reservedIds[0]),
      ).toBeNull();
    });

    it("명시적 멀티파트 abort 시 연결된 용량 예약을 해제한다", async () => {
      const observedStore = createObservedUploadReservationStore();
      const reservationId = "abort-reservation";
      await observedStore.store.reserve({
        id: reservationId,
        actorId: IDs.manager,
        fileSize: UPLOAD_LIMITS.multipartPartSizeBytes,
        observedUsedBytes: 0,
        observedAt: Date.now(),
        grantExpiresAt: Date.now() + 60_000,
        expiresAt: Date.now() + 120_000,
      });
      const stateStore = await createActiveMultipartStateStore({ reservationId });
      const abortMultipartUpload = fn(async () => undefined);
      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        presignService: createPresignServiceMock({ abortMultipartUpload }),
        multipartUploadStateStore: stateStore,
        uploadReservationStore: observedStore.store,
      });

      const response = await app.request("/api/uploads/multipart/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uploadId: "upload-id-1",
          objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        }),
      });

      expect(response.status).toBe(204);
      expect(abortMultipartUpload).toHaveBeenCalledOnce();
      expect(observedStore.removedIds).toContain(reservationId);
      expect(await observedStore.store.get(reservationId)).toBeNull();
    });
  });

  for (const route of resourceRoutes) {
    it(`${route.path}는 인증되지 않은 요청에 401을 반환한다`, /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
      const app = createTestApp({ actor: null });
      const response = await app.request(route.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "cover.png",
          contentType: "image/png",
          fileSize: 1024,
        }),
      });

      expect(response.status).toBe(401);
      await expectErrorCode(response, "UNAUTHORIZED");
    });

    it(`${route.path}는 권한 없는 사용자에게 403을 반환한다`, /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
      const forbiddenRole = route.path.startsWith("/api/activities/")
        ? ("unverified" as const)
        : ("regular_member" as const);
      const issuePresignedPutUrl = fn(
        /** fn 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => ({
          uploadUrl: "https://upload.example.com/signed",
          objectKey: "object-key",
          publicUrl: "https://cdn.example.com/object-key",
          requiredHeaders: { "Content-Type": "image/png" },
        }),
      );
      const app = createTestApp({
        actor: createActor(forbiddenRole),
        presignService: createPresignServiceMock({ issuePresignedPutUrl }),
      });

      const response = await app.request(route.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "cover.png",
          contentType: "image/png",
          fileSize: 1024,
        }),
      });

      expect(response.status).toBe(403);
      await expectErrorCode(response, "FORBIDDEN");
      expect(issuePresignedPutUrl).not.toHaveBeenCalled();
    });

    it(`${route.path}는 본문 검증 실패 시 400을 반환한다`, /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
      const app = createTestApp({
        actor: createActor(route.role, IDs.manager),
      });

      const response = await app.request(route.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: "" }),
      });

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
    });

    it(`${route.path}는 JSON 본문이 깨졌으면 400을 반환한다`, async () => {
      const app = createTestApp({
        actor: createActor(route.role, IDs.manager),
      });
      const response = await app.request(route.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Malformed");
    });

    it(`${route.path}는 presign 생성 성공 시 201과 URL을 반환한다`, /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
      const issuePresignedPutUrl = fn(
        /** fn 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => ({
          uploadUrl: "https://upload.example.com/signed",
          objectKey: "object-key",
          publicUrl: "https://cdn.example.com/object-key",
          requiredHeaders: { "Content-Type": "image/png" },
        }),
      );
      const app = createTestApp({
        actor: createActor(route.role, IDs.manager),
        presignService: createPresignServiceMock({ issuePresignedPutUrl }),
      });

      const response = await app.request(route.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "cover.png",
          contentType: "image/png",
          fileSize: 1024,
        }),
      });

      expect(response.status).toBe(201);
      const body = await readJson<{
        data: { uploadUrl: string; publicUrl: string };
      }>(response);
      expect(body.data.uploadUrl).toContain("upload.example.com");
      expect(body.data.publicUrl).toContain("cdn.example.com");
      expect(issuePresignedPutUrl).toHaveBeenCalledWith({
        actorId: IDs.manager,
        resource: route.expected.resource,
        slot: route.expected.slot,
        fileName: "cover.png",
        contentType: "image/png",
        fileSize: 1024,
      });
    });

    it(`${route.path}는 버킷 10GB 한도 초과가 예상되면 413으로 업로드를 차단한다`, async () => {
      const issuePresignedPutUrl = fn(async () => ({
        uploadUrl: "https://upload.example.com/signed",
        objectKey: "object-key",
        publicUrl: "https://cdn.example.com/object-key",
        requiredHeaders: { "Content-Type": "image/png" },
      }));
      const app = createTestApp({
        actor: createActor(route.role, IDs.manager),
        presignService: createPresignServiceMock({ issuePresignedPutUrl }),
        readR2TotalUsageBytes: () => R2_STORAGE_LIMIT_BYTES - 512,
      });

      const response = await app.request(route.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "cover.png",
          contentType: "image/png",
          fileSize: 1024,
        }),
      });

      expect(response.status).toBe(413);
      await expectErrorCode(response, "BAD_REQUEST");
      expect(issuePresignedPutUrl).not.toHaveBeenCalled();
    });

    it(`${route.path}는 버킷 사용량 확인 실패 시 500으로 업로드를 차단한다`, async () => {
      const issuePresignedPutUrl = fn(async () => ({
        uploadUrl: "https://upload.example.com/signed",
        objectKey: "object-key",
        publicUrl: "https://cdn.example.com/object-key",
        requiredHeaders: { "Content-Type": "image/png" },
      }));
      const app = createTestApp({
        actor: createActor(route.role, IDs.manager),
        presignService: createPresignServiceMock({ issuePresignedPutUrl }),
        readR2TotalUsageBytes: async () => {
          throw new Error("r2 usage unavailable");
        },
      });

      const response = await app.request(route.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "cover.png",
          contentType: "image/png",
          fileSize: 1024,
        }),
      });

      expect(response.status).toBe(500);
      await expectErrorCode(response, "INTERNAL_ERROR");
      expect(issuePresignedPutUrl).not.toHaveBeenCalled();
    });

    it(`${route.path}는 사용량 스캔이 불완전하면 500으로 업로드를 차단한다`, async () => {
      const issuePresignedPutUrl = fn(async () => ({
        uploadUrl: "https://upload.example.com/signed",
        objectKey: "object-key",
        publicUrl: "https://cdn.example.com/object-key",
        requiredHeaders: { "Content-Type": "image/png" },
      }));
      const app = createTestApp({
        actor: createActor(route.role, IDs.manager),
        presignService: createPresignServiceMock({ issuePresignedPutUrl }),
        // 부분 스캔 결과는 한도 미만처럼 보여도 신뢰할 수 없다.
        readR2TotalUsageBytes: async () => ({
          totalUsageBytes: 1024,
          objectCount: 1,
          pages: 1,
          complete: false,
          elapsedMs: 0,
          observedAt: Date.now(),
        }),
      });

      const response = await app.request(route.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "cover.png",
          contentType: "image/png",
          fileSize: 1024,
        }),
      });

      expect(response.status).toBe(500);
      await expectErrorCode(response, "INTERNAL_ERROR");
      expect(issuePresignedPutUrl).not.toHaveBeenCalled();
    });

    it(`${route.path}는 presign 서비스 예외 시 500을 반환한다`, /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
      const issuePresignedPutUrl = fn(
        /** fn 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
          throw new Error("r2 unavailable");
        },
      );
      const app = createTestApp({
        actor: createActor(route.role, IDs.manager),
        presignService: createPresignServiceMock({ issuePresignedPutUrl }),
      });

      const response = await app.request(route.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "cover.png",
          contentType: "image/png",
          fileSize: 1024,
        }),
      });

      expect(response.status).toBe(500);
      await expectErrorCode(response, "INTERNAL_ERROR");
    });
  }

  it("세션 조회 중 예외가 발생해도 500 대신 401을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      resolveActor: async () => {
        throw new Error("Network connection lost.");
      },
    });

    const response = await app.request("/api/activities/presign/cover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "cover.png",
        contentType: "image/png",
        fileSize: 1024,
      }),
    });

    expect(response.status).toBe(401);
    await expectErrorCode(response, "UNAUTHORIZED");
  });

  for (const path of [
    "/api/activities/presign/cover",
    "/api/activities/presign/detail",
  ]) {
    it(`${path}는 regular_member에게 403을 반환한다`, async () => {
      const issuePresignedPutUrl = fn(async () => ({
        uploadUrl: "https://upload.example.com/signed",
        objectKey: "activities/object-key",
        publicUrl: "https://cdn.example.com/activities/object-key",
        requiredHeaders: { "Content-Type": "image/png" },
      }));
      const app = createTestApp({
        actor: createActor("regular_member", IDs.member),
        presignService: createPresignServiceMock({ issuePresignedPutUrl }),
      });

      const response = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "cover.png",
          contentType: "image/png",
          fileSize: 1024,
        }),
      });

      expect(response.status).toBe(403);
      await expectErrorCode(response, "FORBIDDEN");
      expect(issuePresignedPutUrl).not.toHaveBeenCalled();
    });
  }

  it("R2 설정 누락 에러는 내부 오류로 처리하되 상세 안내 메시지를 반환한다", /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
    const issuePresignedPutUrl = fn(
      /** fn 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
        throw new MissingStorageConfigError([
          "R2_S3_ENDPOINT",
          "R2_ACCESS_KEY_ID",
        ]);
      },
    );
    const consoleSpy = fn();
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ issuePresignedPutUrl }),
    });

    const originalConsoleError = console.error;
    console.error = consoleSpy;
    try {
      const response = await app.request("/api/activities/presign/cover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "cover.png",
          contentType: "image/png",
          fileSize: 1024,
        }),
      });

      expect(response.status).toBe(500);
      const body = await readJson<{ error: { message: string } }>(response);
      expect(body.error.message).toContain("R2_*");
      expect(body.error.message).toContain("공개 URL 서명");
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("/api/users/presign/profile는 manager에게 403을 반환한다", /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
    const issuePresignedPutUrl = fn(
      /** fn 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => ({
        uploadUrl: "https://upload.example.com/signed",
        objectKey: "users/profile-key",
        publicUrl: "https://cdn.example.com/users/profile-key",
        requiredHeaders: { "Content-Type": "image/png" },
      }),
    );
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ issuePresignedPutUrl }),
    });

    const response = await app.request("/api/users/presign/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile.png",
        contentType: "image/png",
        fileSize: 1024,
      }),
    });

    expect(response.status).toBe(403);
    await expectErrorCode(response, "FORBIDDEN");
    expect(issuePresignedPutUrl).not.toHaveBeenCalled();
  });

  it("/api/users/presign/profile는 인증되지 않은 요청에 401을 반환한다", async () => {
    const app = createTestApp({ actor: null });
    const response = await app.request("/api/users/presign/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile.png",
        contentType: "image/png",
        fileSize: 1024,
      }),
    });

    expect(response.status).toBe(401);
    await expectErrorCode(response, "UNAUTHORIZED");
  });

  it("/api/users/presign/profile는 member 계열 사용자에게 허용된다", /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
    const issuePresignedPutUrl = fn(
      /** fn 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => ({
        uploadUrl: "https://upload.example.com/signed",
        objectKey: "users/profile-key",
        publicUrl: "https://cdn.example.com/users/profile-key",
        requiredHeaders: { "Content-Type": "image/png" },
      }),
    );
    const app = createTestApp({
      actor: createActor("associate_member", IDs.member),
      presignService: createPresignServiceMock({ issuePresignedPutUrl }),
    });

    const response = await app.request("/api/users/presign/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile.png",
        contentType: "image/png",
        fileSize: 1024,
      }),
    });

    expect(response.status).toBe(201);
    expect(issuePresignedPutUrl).toHaveBeenCalledWith({
      actorId: IDs.member,
      resource: "users",
      slot: "profile",
      fileName: "profile.png",
      contentType: "image/png",
      fileSize: 1024,
    });
  });

  it("/api/users/presign/profile는 user update 권한이 있는 관리자에게 허용된다", /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
    const issuePresignedPutUrl = fn(
      /** fn 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => ({
        uploadUrl: "https://upload.example.com/signed",
        objectKey: "users/profile-key",
        publicUrl: "https://cdn.example.com/users/profile-key",
        requiredHeaders: { "Content-Type": "image/png" },
      }),
    );
    const app = createTestApp({
      actor: createActor("vice_president", IDs.vicePresident),
      presignService: createPresignServiceMock({ issuePresignedPutUrl }),
    });

    const response = await app.request("/api/users/presign/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile.png",
        contentType: "image/png",
        fileSize: 1024,
      }),
    });

    expect(response.status).toBe(201);
    expect(issuePresignedPutUrl).toHaveBeenCalledWith({
      actorId: IDs.vicePresident,
      resource: "users",
      slot: "profile",
      fileName: "profile.png",
      contentType: "image/png",
      fileSize: 1024,
    });
  });

  it("/api/users/presign/profile 본문이 유효하지 않으면 400을 반환한다", /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
    const app = createTestApp({
      actor: createActor("associate_member", IDs.member),
    });

    const response = await app.request("/api/users/presign/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: "" }),
    });

    expect(response.status).toBe(400);
    await expectErrorCode(response, "BAD_REQUEST");
  });

  it("/api/users/presign/profile는 JSON 본문이 깨졌으면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: createActor("associate_member", IDs.member),
    });
    const response = await app.request("/api/users/presign/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Malformed");
  });

  it("/api/users/presign/profile는 presign 서비스 예외 시 500을 반환한다", /** it 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
    const issuePresignedPutUrl = fn(
      /** fn 실행 과정에서 필요한 연산을 수행하는 콜백 함수입니다. @returns 비동기 처리 결과를 Promise로 반환합니다. @remarks 상위 함수의 호출 시점과 조건에 따라 실행 순서가 달라질 수 있습니다. */ async () => {
        throw new Error("r2 unavailable");
      },
    );
    const app = createTestApp({
      actor: createActor("associate_member", IDs.member),
      presignService: createPresignServiceMock({ issuePresignedPutUrl }),
    });

    const response = await app.request("/api/users/presign/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile.png",
        contentType: "image/png",
        fileSize: 1024,
      }),
    });

    expect(response.status).toBe(500);
    await expectErrorCode(response, "INTERNAL_ERROR");
  });

  it("/api/users/presign/profile는 버킷 10GB 한도 초과가 예상되면 413으로 업로드를 차단한다", async () => {
    const issuePresignedPutUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/signed",
      objectKey: "users/profile-key",
      publicUrl: "https://cdn.example.com/users/profile-key",
      requiredHeaders: { "Content-Type": "image/png" },
    }));
    const app = createTestApp({
      actor: createActor("associate_member", IDs.member),
      presignService: createPresignServiceMock({ issuePresignedPutUrl }),
      readR2TotalUsageBytes: () => R2_STORAGE_LIMIT_BYTES - 256,
    });

    const response = await app.request("/api/users/presign/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile.png",
        contentType: "image/png",
        fileSize: 1024,
      }),
    });

    expect(response.status).toBe(413);
    await expectErrorCode(response, "BAD_REQUEST");
    expect(issuePresignedPutUrl).not.toHaveBeenCalled();
  });

  it("/api/users/presign/profile는 스토리지 설정 누락 시 안내 메시지와 함께 500을 반환한다", async () => {
    const issuePresignedPutUrl = fn(async () => {
      throw new MissingStorageConfigError(["R2_BUCKET_NAME"]);
    });
    const app = createTestApp({
      actor: createActor("associate_member", IDs.member),
      presignService: createPresignServiceMock({ issuePresignedPutUrl }),
    });

    const response = await app.request("/api/users/presign/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile.png",
        contentType: "image/png",
        fileSize: 1024,
      }),
    });

    expect(response.status).toBe(500);
    const body = await readJson<{ error: { message: string } }>(response);
    expect(body.error.message).toContain("R2_*");
  });

  it("단일 업로드는 허용 크기 초과 시 413을 반환한다", async () => {
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
    });

    const response = await app.request("/api/activities/presign/cover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "cover.png",
        contentType: "image/png",
        fileSize: 1024 * 1024 * 1024 + 1,
      }),
    });

    expect(response.status).toBe(413);
    await expectErrorCode(response, "BAD_REQUEST");
  });

  it("단일 업로드는 허용되지 않은 content-type 요청을 거부한다", async () => {
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
    });

    const response = await app.request("/api/activities/presign/cover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "cover.svg",
        contentType: "image/svg+xml",
        fileSize: 1024,
      }),
    });

    expect(response.status).toBe(415);
    await expectErrorCode(response, "BAD_REQUEST");
  });

  it("/api/recruiting/presign/image는 허용되지 않은 content-type 요청을 거부한다", async () => {
    const app = createTestApp({
      actor: createActor("vice_president", IDs.vicePresident),
    });

    const response = await app.request("/api/recruiting/presign/image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "notice.svg",
        contentType: "image/svg+xml",
        fileSize: 1024,
      }),
    });

    expect(response.status).toBe(415);
    await expectErrorCode(response, "BAD_REQUEST");
  });

  it("/api/recruiting/presign/image는 허용 크기 초과 시 413을 반환한다", async () => {
    const app = createTestApp({
      actor: createActor("vice_president", IDs.vicePresident),
    });

    const response = await app.request("/api/recruiting/presign/image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "notice.png",
        contentType: "image/png",
        fileSize: 1024 * 1024 * 1024 + 1,
      }),
    });

    expect(response.status).toBe(413);
    await expectErrorCode(response, "BAD_REQUEST");
  });

  it("멀티파트 업로드 init/part/complete/abort 경로가 정상 동작한다", async () => {
    const initiateMultipartUpload = fn(async () => ({
      uploadId: "upload-id-1",
      objectKey: `activities/${IDs.manager}/detail/multipart-key`,
      publicUrl: "https://cdn.example.com/multipart-key",
      partSize: 8 * 1024 * 1024,
      maxPartNumber: 2,
    }));
    const issueMultipartUploadPartUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/multipart/part-1",
      requiredHeaders: {},
    }));
    const completeMultipartUpload = fn(async () => ({
      objectKey: `activities/${IDs.manager}/detail/multipart-key`,
      publicUrl: "https://cdn.example.com/multipart-key",
    }));
    const abortMultipartUpload = fn(async () => undefined);

    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({
        initiateMultipartUpload,
        issueMultipartUploadPartUrl,
        completeMultipartUpload,
        abortMultipartUpload,
      }),
    });

    const initResponse = await app.request(
      "/api/activities/multipart/detail/init",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "large.png",
          contentType: "image/png",
          fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
        }),
      },
    );
    expect(initResponse.status).toBe(201);
    expect(initiateMultipartUpload).toHaveBeenCalled();

    const partResponse = await app.request("/api/uploads/multipart/part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        partNumber: 1,
      }),
    });
    expect(partResponse.status).toBe(200);
    expect(issueMultipartUploadPartUrl).toHaveBeenCalled();

    const completeResponse = await app.request(
      "/api/uploads/multipart/complete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uploadId: "upload-id-1",
          objectKey: `activities/${IDs.manager}/detail/multipart-key`,
          parts: [
            { partNumber: 1, etag: '"etag-1"' },
            { partNumber: 2, etag: '"etag-2"' },
          ],
        }),
      },
    );
    expect(completeResponse.status).toBe(200);
    expect(completeMultipartUpload).toHaveBeenCalled();

    const secondInitResponse = await app.request(
      "/api/activities/multipart/detail/init",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "large-again.png",
          contentType: "image/png",
          fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
        }),
      },
    );
    expect(secondInitResponse.status).toBe(201);

    const abortResponse = await app.request("/api/uploads/multipart/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
      }),
    });
    expect(abortResponse.status).toBe(204);
    expect(abortMultipartUpload).toHaveBeenCalled();
  });

  it("멀티파트 part 요청은 본인 소유 objectKey가 아니면 403을 반환한다", async () => {
    const issueMultipartUploadPartUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/multipart/part-1",
      requiredHeaders: {},
    }));
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({
        issueMultipartUploadPartUrl,
      }),
    });

    const response = await app.request("/api/uploads/multipart/part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.otherUser}/detail/multipart-key`,
        partNumber: 1,
      }),
    });

    expect(response.status).toBe(403);
    await expectErrorCode(response, "FORBIDDEN");
    expect(issueMultipartUploadPartUrl).not.toHaveBeenCalled();
  });

  it("멀티파트 part 요청에서 objectKey 형식이 잘못되면 400을 반환한다", async () => {
    const issueMultipartUploadPartUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/multipart/part-1",
      requiredHeaders: {},
    }));
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ issueMultipartUploadPartUrl }),
    });

    const response = await app.request("/api/uploads/multipart/part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: "invalid-object-key",
        partNumber: 1,
      }),
    });

    expect(response.status).toBe(400);
    await expectErrorCode(response, "BAD_REQUEST");
    expect(issueMultipartUploadPartUrl).not.toHaveBeenCalled();
  });

  it("멀티파트 part 요청은 user profile objectKey에서 manager 권한을 거부한다", async () => {
    const issueMultipartUploadPartUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/multipart/part-1",
      requiredHeaders: {},
    }));
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ issueMultipartUploadPartUrl }),
    });

    const response = await app.request("/api/uploads/multipart/part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `users/${IDs.manager}/profile/multipart-key`,
        partNumber: 1,
      }),
    });

    expect(response.status).toBe(403);
    await expectErrorCode(response, "FORBIDDEN");
    expect(issueMultipartUploadPartUrl).not.toHaveBeenCalled();
  });

  it("멀티파트 part 요청은 user profile objectKey에서 member 계열 사용자를 허용한다", async () => {
    const issueMultipartUploadPartUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/multipart/part-1",
      requiredHeaders: {},
    }));
    const app = createTestApp({
      actor: createActor("regular_member", IDs.member),
      presignService: createPresignServiceMock({ issueMultipartUploadPartUrl }),
      multipartUploadStateStore: await createActiveMultipartStateStore({
        objectKey: `users/${IDs.member}/profile/multipart-key`,
        actorId: IDs.member,
      }),
    });

    const response = await app.request("/api/uploads/multipart/part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `users/${IDs.member}/profile/multipart-key`,
        partNumber: 1,
      }),
    });

    expect(response.status).toBe(200);
    expect(issueMultipartUploadPartUrl).toHaveBeenCalledWith({
      uploadId: "upload-id-1",
      objectKey: `users/${IDs.member}/profile/multipart-key`,
      partNumber: 1,
      contentLength: UPLOAD_LIMITS.multipartPartSizeBytes,
    });
  });

  it("멀티파트 part 서비스 예외 시 500을 반환한다", async () => {
    const issueMultipartUploadPartUrl = fn(async () => {
      throw new Error("part failed");
    });
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ issueMultipartUploadPartUrl }),
      multipartUploadStateStore: await createActiveMultipartStateStore(),
    });

    const response = await app.request("/api/uploads/multipart/part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        partNumber: 1,
      }),
    });

    expect(response.status).toBe(500);
    await expectErrorCode(response, "INTERNAL_ERROR");
  });

  it("멀티파트 complete 요청에서 중복 partNumber가 있으면 422를 반환한다", async () => {
    const completeMultipartUpload = fn(async () => ({
      objectKey: `activities/${IDs.manager}/detail/multipart-key`,
      publicUrl: "https://cdn.example.com/multipart-key",
    }));
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ completeMultipartUpload }),
      multipartUploadStateStore: await createActiveMultipartStateStore(),
    });

    const response = await app.request("/api/uploads/multipart/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        parts: [
          { partNumber: 1, etag: '"etag-1"' },
          { partNumber: 1, etag: '"etag-1-dup"' },
        ],
      }),
    });

    expect(response.status).toBe(422);
    await expectErrorCode(response, "BAD_REQUEST");
    expect(completeMultipartUpload).not.toHaveBeenCalled();
  });

  it("멀티파트 complete 본문이 유효하지 않으면 400을 반환한다", async () => {
    const completeMultipartUpload = fn(async () => ({
      objectKey: `activities/${IDs.manager}/detail/multipart-key`,
      publicUrl: "https://cdn.example.com/multipart-key",
    }));
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ completeMultipartUpload }),
    });

    const response = await app.request("/api/uploads/multipart/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    await expectErrorCode(response, "BAD_REQUEST");
    expect(completeMultipartUpload).not.toHaveBeenCalled();
  });

  it("멀티파트 complete 서비스 예외 시 500을 반환한다", async () => {
    const completeMultipartUpload = fn(async () => {
      throw new Error("complete failed");
    });
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ completeMultipartUpload }),
      multipartUploadStateStore: await createActiveMultipartStateStore(),
    });

    const response = await app.request("/api/uploads/multipart/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        parts: [{ partNumber: 1, etag: '"etag-1"' }],
      }),
    });

    expect(response.status).toBe(500);
    await expectErrorCode(response, "INTERNAL_ERROR");
  });

  it("이미 종료된 멀티파트 complete는 stale 상태를 제거하고 400을 반환한다", async () => {
    const completeMultipartUpload = fn(async () => {
      throw Object.assign(new Error("upload no longer exists"), {
        name: "NoSuchUpload",
        $fault: "client",
        $metadata: { httpStatusCode: 404 },
      });
    });
    const stateStore = await createActiveMultipartStateStore();
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ completeMultipartUpload }),
      multipartUploadStateStore: stateStore,
    });

    const response = await app.request("/api/uploads/multipart/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        parts: [{ partNumber: 1, etag: '"etag-1"' }],
      }),
    });

    expect(response.status).toBe(400);
    await expectErrorCode(response, "BAD_REQUEST");
    expect(
      await stateStore.get(
        "upload-id-1",
        `activities/${IDs.manager}/detail/multipart-key`,
      ),
    ).toBeNull();
  });

  it("멀티파트 abort 본문이 유효하지 않으면 400을 반환한다", async () => {
    const abortMultipartUpload = fn(async () => undefined);
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ abortMultipartUpload }),
      multipartUploadStateStore: await createActiveMultipartStateStore(),
    });

    const response = await app.request("/api/uploads/multipart/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    await expectErrorCode(response, "BAD_REQUEST");
    expect(abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("멀티파트 abort 본인 소유가 아니면 403을 반환한다", async () => {
    const abortMultipartUpload = fn(async () => undefined);
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ abortMultipartUpload }),
    });

    const response = await app.request("/api/uploads/multipart/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.otherUser}/detail/multipart-key`,
      }),
    });

    expect(response.status).toBe(403);
    await expectErrorCode(response, "FORBIDDEN");
    expect(abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("멀티파트 abort 요청에서 objectKey 형식이 잘못되면 400을 반환한다", async () => {
    const abortMultipartUpload = fn(async () => undefined);
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ abortMultipartUpload }),
    });

    const response = await app.request("/api/uploads/multipart/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: "invalid-object-key",
      }),
    });

    expect(response.status).toBe(400);
    await expectErrorCode(response, "BAD_REQUEST");
    expect(abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("멀티파트 abort 서비스 예외 시 500을 반환한다", async () => {
    const abortMultipartUpload = fn(async () => {
      throw new Error("abort failed");
    });
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ abortMultipartUpload }),
      multipartUploadStateStore: await createActiveMultipartStateStore(),
    });

    const response = await app.request("/api/uploads/multipart/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
      }),
    });

    expect(response.status).toBe(500);
    await expectErrorCode(response, "INTERNAL_ERROR");
  });

  it("이미 사라진 멀티파트 abort는 멱등 성공으로 처리하고 stale 상태를 제거한다", async () => {
    const abortMultipartUpload = fn(async () => {
      throw Object.assign(new Error("upload no longer exists"), {
        name: "NoSuchUpload",
        $fault: "client",
        $metadata: { httpStatusCode: 404 },
      });
    });
    const stateStore = await createActiveMultipartStateStore();
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ abortMultipartUpload }),
      multipartUploadStateStore: stateStore,
    });

    const response = await app.request("/api/uploads/multipart/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
      }),
    });

    expect(response.status).toBe(204);
    expect(
      await stateStore.get(
        "upload-id-1",
        `activities/${IDs.manager}/detail/multipart-key`,
      ),
    ).toBeNull();
  });

  it("멀티파트 상태가 없거나 파트 범위를 벗어난 요청을 거부한다", async () => {
    const issueMultipartUploadPartUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/multipart/part",
      requiredHeaders: {},
    }));
    const missingStateApp = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ issueMultipartUploadPartUrl }),
    });
    const missingStateResponse = await missingStateApp.request(
      "/api/uploads/multipart/part",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uploadId: "upload-id-1",
          objectKey: `activities/${IDs.manager}/detail/multipart-key`,
          partNumber: 1,
        }),
      },
    );
    expect(missingStateResponse.status).toBe(400);
    expect(issueMultipartUploadPartUrl).not.toHaveBeenCalled();

    const boundedState = await createActiveMultipartStateStore({
      fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
      maxPartNumber: 2,
    });
    const boundedApp = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ issueMultipartUploadPartUrl }),
      multipartUploadStateStore: boundedState,
    });
    const outOfRangeResponse = await boundedApp.request(
      "/api/uploads/multipart/part",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uploadId: "upload-id-1",
          objectKey: `activities/${IDs.manager}/detail/multipart-key`,
          partNumber: 3,
        }),
      },
    );
    expect(outOfRangeResponse.status).toBe(422);
    expect(issueMultipartUploadPartUrl).not.toHaveBeenCalled();
  });

  it("멀티파트 complete는 초기화 시 확정된 전체 파트 집합을 요구한다", async () => {
    const completeMultipartUpload = fn(async () => ({
      objectKey: `activities/${IDs.manager}/detail/multipart-key`,
      publicUrl: "https://cdn.example.com/multipart-key",
    }));
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ completeMultipartUpload }),
      multipartUploadStateStore: await createActiveMultipartStateStore({
        fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
        maxPartNumber: 2,
      }),
    });

    const response = await app.request("/api/uploads/multipart/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        parts: [{ partNumber: 1, etag: '"etag-1"' }],
      }),
    });

    expect(response.status).toBe(422);
    expect(completeMultipartUpload).not.toHaveBeenCalled();
  });

  it("만료된 멀티파트 상태는 원격 업로드를 정리하고 파트 URL을 발급하지 않는다", async () => {
    const issueMultipartUploadPartUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/multipart/part",
      requiredHeaders: {},
    }));
    const abortMultipartUpload = fn(async () => undefined);
    const stateStore = await createActiveMultipartStateStore({
      expiresAt: Date.now() - 1,
    });
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({
        issueMultipartUploadPartUrl,
        abortMultipartUpload,
      }),
      multipartUploadStateStore: stateStore,
    });

    const response = await app.request("/api/uploads/multipart/part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        partNumber: 1,
      }),
    });

    expect(response.status).toBe(400);
    expect(abortMultipartUpload).toHaveBeenCalledWith({
      uploadId: "upload-id-1",
      objectKey: `activities/${IDs.manager}/detail/multipart-key`,
    });
    expect(
      await stateStore.get(
        "upload-id-1",
        `activities/${IDs.manager}/detail/multipart-key`,
      ),
    ).toBeNull();
    expect(issueMultipartUploadPartUrl).not.toHaveBeenCalled();
  });

  it("만료된 멀티파트 원격 중단이 실패하면 로컬 상태를 보존한다", async () => {
    const issueMultipartUploadPartUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/multipart/part",
      requiredHeaders: {},
    }));
    const abortMultipartUpload = fn(async () => {
      throw new Error("temporary R2 failure");
    });
    const stateStore = await createActiveMultipartStateStore({
      expiresAt: Date.now() - 1,
    });
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({
        issueMultipartUploadPartUrl,
        abortMultipartUpload,
      }),
      multipartUploadStateStore: stateStore,
    });

    const response = await app.request("/api/uploads/multipart/part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        partNumber: 1,
      }),
    });

    expect(response.status).toBe(400);
    expect(
      await stateStore.get(
        "upload-id-1",
        `activities/${IDs.manager}/detail/multipart-key`,
      ),
    ).not.toBeNull();
    expect(issueMultipartUploadPartUrl).not.toHaveBeenCalled();
  });

  it("만료된 멀티파트가 R2에 이미 없으면 로컬 상태를 제거한다", async () => {
    const issueMultipartUploadPartUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/multipart/part",
      requiredHeaders: {},
    }));
    const abortMultipartUpload = fn(async () => {
      throw Object.assign(new Error("upload no longer exists"), {
        name: "NoSuchUpload",
        $fault: "client",
        $metadata: { httpStatusCode: 404 },
      });
    });
    const stateStore = await createActiveMultipartStateStore({
      expiresAt: Date.now() - 1,
    });
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({
        issueMultipartUploadPartUrl,
        abortMultipartUpload,
      }),
      multipartUploadStateStore: stateStore,
    });

    const response = await app.request("/api/uploads/multipart/part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        partNumber: 1,
      }),
    });

    expect(response.status).toBe(400);
    expect(
      await stateStore.get(
        "upload-id-1",
        `activities/${IDs.manager}/detail/multipart-key`,
      ),
    ).toBeNull();
    expect(issueMultipartUploadPartUrl).not.toHaveBeenCalled();
  });

  it("사용자별 활성 멀티파트 상한을 사전 확인해 원격 업로드를 만들지 않고 409를 반환한다", async () => {
    const stateStore = createMemoryMultipartUploadStateStore();
    for (let index = 0; index < 10; index += 1) {
      await stateStore.reserve({
        uploadId: `active-upload-${index}`,
        objectKey: `activities/${IDs.manager}/detail/active-key-${index}`,
        actorId: IDs.manager,
        contentType: "image/png",
        fileSize: UPLOAD_LIMITS.multipartPartSizeBytes,
        partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
        maxPartNumber: 1,
        expiresAt: Date.now() + 60_000,
      });
    }

    const initiateMultipartUpload = fn(async () => ({
      uploadId: "rejected-upload",
      objectKey: `activities/${IDs.manager}/detail/rejected-key`,
      publicUrl: "https://cdn.example.com/rejected-key",
      partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
      maxPartNumber: 1,
    }));
    const abortMultipartUpload = fn(async () => undefined);
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({
        initiateMultipartUpload,
        abortMultipartUpload,
      }),
      multipartUploadStateStore: stateStore,
    });

    const response = await app.request(
      "/api/activities/multipart/detail/init",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "new.png",
          contentType: "image/png",
          fileSize: UPLOAD_LIMITS.multipartPartSizeBytes,
        }),
      },
    );

    expect(response.status).toBe(409);
    await expectErrorCode(response, "CONFLICT");
    expect(initiateMultipartUpload).not.toHaveBeenCalled();
    expect(abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("용량 사전 확인 뒤 예약 경합에서 상한에 도달하면 새 원격 업로드를 보상 중단한다", async () => {
    const backingStore = createMemoryMultipartUploadStateStore();
    const stateStore: MultipartUploadStateStore = {
      ...backingStore,
      assertActorCapacity: fn(async () => undefined),
      reserve: fn(async () => {
        throw new MultipartUploadLimitError();
      }),
    };
    const initiateMultipartUpload = fn(async () => ({
      uploadId: "raced-upload",
      objectKey: `activities/${IDs.manager}/detail/raced-key`,
      publicUrl: "https://cdn.example.com/raced-key",
      partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
      maxPartNumber: 1,
    }));
    const abortMultipartUpload = fn(async () => undefined);
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({
        initiateMultipartUpload,
        abortMultipartUpload,
      }),
      multipartUploadStateStore: stateStore,
    });

    const response = await app.request(
      "/api/activities/multipart/detail/init",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "raced.png",
          contentType: "image/png",
          fileSize: UPLOAD_LIMITS.multipartPartSizeBytes,
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(initiateMultipartUpload).toHaveBeenCalledOnce();
    expect(abortMultipartUpload).toHaveBeenCalledWith({
      uploadId: "raced-upload",
      objectKey: `activities/${IDs.manager}/detail/raced-key`,
    });
  });

  it("초기화 시 해당 사용자의 만료 업로드만 제한된 수만큼 원격 정리하고 성공 건만 제거한다", async () => {
    const stateStore = createMemoryMultipartUploadStateStore();
    const expiredAt = Date.now() - 60_000;
    for (
      let index = 0;
      index < MULTIPART_UPLOAD_EXPIRED_CLEANUP_LIMIT + 1;
      index += 1
    ) {
      await stateStore.reserve({
        uploadId: `expired-upload-${index}`,
        objectKey: `activities/${IDs.manager}/detail/expired-key-${index}`,
        actorId: IDs.manager,
        contentType: "image/png",
        fileSize: UPLOAD_LIMITS.multipartPartSizeBytes,
        partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
        maxPartNumber: 1,
        expiresAt: expiredAt + index,
      });
    }
    await stateStore.reserve({
      uploadId: "other-actor-expired-upload",
      objectKey: `activities/${IDs.member}/detail/other-expired-key`,
      actorId: IDs.member,
      contentType: "image/png",
      fileSize: UPLOAD_LIMITS.multipartPartSizeBytes,
      partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
      maxPartNumber: 1,
      expiresAt: expiredAt - 1,
    });

    const initiateMultipartUpload = fn(async () => ({
      uploadId: "new-upload",
      objectKey: `activities/${IDs.manager}/detail/new-key`,
      publicUrl: "https://cdn.example.com/new-key",
      partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
      maxPartNumber: 1,
    }));
    const abortMultipartUpload = fn(async (input: { uploadId: string }) => {
      if (input.uploadId === "expired-upload-0") {
        throw new Error("temporary R2 failure");
      }
    });
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({
        initiateMultipartUpload,
        abortMultipartUpload,
      }),
      multipartUploadStateStore: stateStore,
    });

    const response = await app.request(
      "/api/activities/multipart/detail/init",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "new.png",
          contentType: "image/png",
          fileSize: UPLOAD_LIMITS.multipartPartSizeBytes,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(abortMultipartUpload).toHaveBeenCalledTimes(
      MULTIPART_UPLOAD_EXPIRED_CLEANUP_LIMIT,
    );
    expect(
      await stateStore.get(
        "expired-upload-0",
        `activities/${IDs.manager}/detail/expired-key-0`,
      ),
    ).not.toBeNull();
    expect(
      await stateStore.get(
        "expired-upload-1",
        `activities/${IDs.manager}/detail/expired-key-1`,
      ),
    ).toBeNull();
    expect(
      await stateStore.get(
        `expired-upload-${MULTIPART_UPLOAD_EXPIRED_CLEANUP_LIMIT}`,
        `activities/${IDs.manager}/detail/expired-key-${MULTIPART_UPLOAD_EXPIRED_CLEANUP_LIMIT}`,
      ),
    ).not.toBeNull();
    expect(
      await stateStore.get(
        "other-actor-expired-upload",
        `activities/${IDs.member}/detail/other-expired-key`,
      ),
    ).not.toBeNull();
  });

  it("multipart part/complete/abort는 인증되지 않은 요청에 401을 반환한다", async () => {
    const app = createTestApp({ actor: null });

    const partResponse = await app.request("/api/uploads/multipart/part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        partNumber: 1,
      }),
    });
    expect(partResponse.status).toBe(401);
    await expectErrorCode(partResponse, "UNAUTHORIZED");

    const completeResponse = await app.request("/api/uploads/multipart/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
        parts: [{ partNumber: 1, etag: '"etag-1"' }],
      }),
    });
    expect(completeResponse.status).toBe(401);
    await expectErrorCode(completeResponse, "UNAUTHORIZED");

    const abortResponse = await app.request("/api/uploads/multipart/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: "upload-id-1",
        objectKey: `activities/${IDs.manager}/detail/multipart-key`,
      }),
    });
    expect(abortResponse.status).toBe(401);
    await expectErrorCode(abortResponse, "UNAUTHORIZED");
  });

  it("리소스 멀티파트 init 경로는 인증/권한/스토리지 설정 누락 분기를 처리한다", async () => {
    const unauthorizedApp = createTestApp({ actor: null });
    const unauthorizedResponse = await unauthorizedApp.request(
      "/api/activities/multipart/detail/init",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "large.png",
          contentType: "image/png",
          fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
        }),
      },
    );
    expect(unauthorizedResponse.status).toBe(401);
    await expectErrorCode(unauthorizedResponse, "UNAUTHORIZED");

    const forbiddenInitiate = fn(async () => ({
      uploadId: "should-not-be-called",
      objectKey: `exhibitions/${IDs.member}/detail/mock`,
      publicUrl: "https://cdn.example.com/mock",
      partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
      maxPartNumber: 2,
    }));
    const forbiddenApp = createTestApp({
      actor: createActor("regular_member", IDs.member),
      presignService: createPresignServiceMock({ initiateMultipartUpload: forbiddenInitiate }),
    });
    const forbiddenResponse = await forbiddenApp.request(
      "/api/exhibitions/multipart/detail/init",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "detail.png",
          contentType: "image/png",
          fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
        }),
      },
    );
    expect(forbiddenResponse.status).toBe(403);
    await expectErrorCode(forbiddenResponse, "FORBIDDEN");
    expect(forbiddenInitiate).not.toHaveBeenCalled();

    const missingStorage = fn(async () => {
      throw new MissingStorageConfigError(["R2_BUCKET_NAME"]);
    });
    const missingStorageApp = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ initiateMultipartUpload: missingStorage }),
    });
    const missingStorageResponse = await missingStorageApp.request(
      "/api/activities/multipart/detail/init",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "large.png",
          contentType: "image/png",
          fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
        }),
      },
    );
    expect(missingStorageResponse.status).toBe(500);
    const missingStorageBody = await readJson<{ error: { message: string } }>(
      missingStorageResponse,
    );
    expect(missingStorageBody.error.message).toContain("R2_*");
  });

  it("/api/activities/multipart/detail/init은 regular_member에게 403을 반환한다", async () => {
    const initiateMultipartUpload = fn(async () => ({
      uploadId: "activity-upload-id",
      objectKey: `activities/${IDs.member}/detail/activity-image-key`,
      publicUrl: "https://cdn.example.com/activities/activity-image-key",
      partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
      maxPartNumber: 4,
    }));
    const app = createTestApp({
      actor: createActor("regular_member", IDs.member),
      presignService: createPresignServiceMock({ initiateMultipartUpload }),
    });

    const response = await app.request("/api/activities/multipart/detail/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "detail.png",
        contentType: "image/png",
        fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
      }),
    });

    expect(response.status).toBe(403);
    await expectErrorCode(response, "FORBIDDEN");
    expect(initiateMultipartUpload).not.toHaveBeenCalled();
  });

  it("/api/users/multipart/profile/init은 member 계열 사용자에게 허용된다", async () => {
    const initiateMultipartUpload = fn(async () => ({
      uploadId: "profile-upload-id",
      objectKey: `users/${IDs.member}/profile/profile-key`,
      publicUrl: "https://cdn.example.com/users/profile-key",
      partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
      maxPartNumber: 5,
    }));
    const app = createTestApp({
      actor: createActor("regular_member", IDs.member),
      presignService: createPresignServiceMock({ initiateMultipartUpload }),
    });

    const response = await app.request("/api/users/multipart/profile/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile-large.png",
        contentType: "image/png",
        fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
      }),
    });

    expect(response.status).toBe(201);
    expect(initiateMultipartUpload).toHaveBeenCalledWith({
      actorId: IDs.member,
      resource: "users",
      slot: "profile",
      fileName: "profile-large.png",
      contentType: "image/png",
      fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
    });
  });

  it("/api/users/multipart/profile/init은 manager에게 403을 반환한다", async () => {
    const initiateMultipartUpload = fn(async () => ({
      uploadId: "profile-upload-id",
      objectKey: `users/${IDs.manager}/profile/profile-key`,
      publicUrl: "https://cdn.example.com/users/profile-key",
      partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
      maxPartNumber: 5,
    }));
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ initiateMultipartUpload }),
    });

    const response = await app.request("/api/users/multipart/profile/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile-large.png",
        contentType: "image/png",
        fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
      }),
    });

    expect(response.status).toBe(403);
    await expectErrorCode(response, "FORBIDDEN");
    expect(initiateMultipartUpload).not.toHaveBeenCalled();
  });

  it("/api/users/multipart/profile/init은 인증되지 않은 요청에 401을 반환한다", async () => {
    const app = createTestApp({ actor: null });
    const response = await app.request("/api/users/multipart/profile/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile-large.png",
        contentType: "image/png",
        fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
      }),
    });

    expect(response.status).toBe(401);
    await expectErrorCode(response, "UNAUTHORIZED");
  });

  it("/api/users/multipart/profile/init은 최대 파트 수 초과 시 413을 반환한다", async () => {
    const initiateMultipartUpload = fn(async () => ({
      uploadId: "profile-upload-id",
      objectKey: `users/${IDs.member}/profile/profile-key`,
      publicUrl: "https://cdn.example.com/users/profile-key",
      partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
      maxPartNumber: 5,
    }));
    const app = createTestApp({
      actor: createActor("regular_member", IDs.member),
      presignService: createPresignServiceMock({ initiateMultipartUpload }),
    });

    const response = await app.request("/api/users/multipart/profile/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile-huge.png",
        contentType: "image/png",
        fileSize:
          UPLOAD_LIMITS.multipartPartSizeBytes *
            (UPLOAD_LIMITS.multipartMaxParts + 1) +
          1,
      }),
    });

    expect(response.status).toBe(413);
    await expectErrorCode(response, "BAD_REQUEST");
    expect(initiateMultipartUpload).not.toHaveBeenCalled();
  });

  it("/api/users/multipart/profile/init은 스토리지 설정 누락 시 500을 반환한다", async () => {
    const initiateMultipartUpload = fn(async () => {
      throw new MissingStorageConfigError(["R2_BUCKET_NAME"]);
    });
    const app = createTestApp({
      actor: createActor("regular_member", IDs.member),
      presignService: createPresignServiceMock({ initiateMultipartUpload }),
    });

    const response = await app.request("/api/users/multipart/profile/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile-large.png",
        contentType: "image/png",
        fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
      }),
    });

    expect(response.status).toBe(500);
    const body = await readJson<{ error: { message: string } }>(response);
    expect(body.error.message).toContain("R2_*");
  });

  it("/api/activities/multipart/detail/init은 버킷 10GB 한도 초과가 예상되면 413으로 업로드를 차단한다", async () => {
    const initiateMultipartUpload = fn(async () => ({
      uploadId: "upload-id-1",
      objectKey: `activities/${IDs.manager}/detail/multipart-key`,
      publicUrl: "https://cdn.example.com/multipart-key",
      partSize: 8 * 1024 * 1024,
      maxPartNumber: 2,
    }));
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ initiateMultipartUpload }),
      readR2TotalUsageBytes: () => R2_STORAGE_LIMIT_BYTES - 1,
    });

    const response = await app.request("/api/activities/multipart/detail/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "large.png",
        contentType: "image/png",
        fileSize: 2,
      }),
    });

    expect(response.status).toBe(413);
    await expectErrorCode(response, "BAD_REQUEST");
    expect(initiateMultipartUpload).not.toHaveBeenCalled();
  });

  it("/api/users/multipart/profile/init은 버킷 10GB 한도 초과가 예상되면 413으로 업로드를 차단한다", async () => {
    const initiateMultipartUpload = fn(async () => ({
      uploadId: "profile-upload-id",
      objectKey: `users/${IDs.member}/profile/profile-key`,
      publicUrl: "https://cdn.example.com/users/profile-key",
      partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
      maxPartNumber: 5,
    }));
    const app = createTestApp({
      actor: createActor("regular_member", IDs.member),
      presignService: createPresignServiceMock({ initiateMultipartUpload }),
      readR2TotalUsageBytes: () => R2_STORAGE_LIMIT_BYTES - 4,
    });

    const response = await app.request("/api/users/multipart/profile/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile-large.png",
        contentType: "image/png",
        fileSize: 8,
      }),
    });

    expect(response.status).toBe(413);
    await expectErrorCode(response, "BAD_REQUEST");
    expect(initiateMultipartUpload).not.toHaveBeenCalled();
  });

  it("/api/users/multipart/profile/init 서비스 예외 시 500을 반환한다", async () => {
    const initiateMultipartUpload = fn(async () => {
      throw new Error("init failed");
    });
    const app = createTestApp({
      actor: createActor("regular_member", IDs.member),
      presignService: createPresignServiceMock({ initiateMultipartUpload }),
    });

    const response = await app.request("/api/users/multipart/profile/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "profile-large.png",
        contentType: "image/png",
        fileSize: UPLOAD_LIMITS.multipartPartSizeBytes * 2,
      }),
    });

    expect(response.status).toBe(500);
    await expectErrorCode(response, "INTERNAL_ERROR");
  });
});

describe("attachment file presign routes", () => {
  const pdfPayload = {
    fileName: "2026-06-회계내역.pdf",
    contentType: "application/pdf",
    fileSize: 1024 * 1024,
  };

  it("/api/site/presign/file는 manager에게 403을 반환한다", async () => {
    const issuePresignedPutUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/signed",
      objectKey: "object-key",
      publicUrl: "https://cdn.example.com/object-key",
      requiredHeaders: { "Content-Type": "application/pdf" },
    }));
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ issuePresignedPutUrl }),
    });

    const response = await app.request("/api/site/presign/file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pdfPayload),
    });

    expect(response.status).toBe(403);
    await expectErrorCode(response, "FORBIDDEN");
    expect(issuePresignedPutUrl).not.toHaveBeenCalled();
  });

  it("/api/site/presign/file는 부회장에게 site/file 슬롯 presign을 발급한다", async () => {
    const issuePresignedPutUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/signed",
      objectKey: "object-key",
      publicUrl: "https://cdn.example.com/object-key",
      requiredHeaders: { "Content-Type": "application/pdf" },
    }));
    const app = createTestApp({
      actor: createActor("vice_president", IDs.vicePresident),
      presignService: createPresignServiceMock({ issuePresignedPutUrl }),
    });

    const response = await app.request("/api/site/presign/file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pdfPayload),
    });

    expect(response.status).toBe(201);
    expect(issuePresignedPutUrl).toHaveBeenCalledWith({
      actorId: IDs.vicePresident,
      resource: "site",
      slot: "file",
      fileName: pdfPayload.fileName,
      contentType: "application/pdf",
      fileSize: pdfPayload.fileSize,
    });
  });

  it("/api/activities/presign/file는 manager에게 activities/file 슬롯 presign을 발급한다", async () => {
    const issuePresignedPutUrl = fn(async () => ({
      uploadUrl: "https://upload.example.com/signed",
      objectKey: "object-key",
      publicUrl: "https://cdn.example.com/object-key",
      requiredHeaders: { "Content-Type": "application/pdf" },
    }));
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock({ issuePresignedPutUrl }),
    });

    const response = await app.request("/api/activities/presign/file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pdfPayload),
    });

    expect(response.status).toBe(201);
    expect(issuePresignedPutUrl).toHaveBeenCalledWith({
      actorId: IDs.manager,
      resource: "activities",
      slot: "file",
      fileName: pdfPayload.fileName,
      contentType: "application/pdf",
      fileSize: pdfPayload.fileSize,
    });
  });

  it("/api/activities/presign/file는 일반 멤버에게 403을 반환한다", async () => {
    const app = createTestApp({
      actor: createActor("regular_member", IDs.member),
      presignService: createPresignServiceMock(),
    });

    const response = await app.request("/api/activities/presign/file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pdfPayload),
    });

    expect(response.status).toBe(403);
    await expectErrorCode(response, "FORBIDDEN");
  });

  it("file presign 경로는 이미지 content-type을 415로 거부한다", async () => {
    const app = createTestApp({
      actor: createActor("vice_president", IDs.vicePresident),
      presignService: createPresignServiceMock(),
    });

    const response = await app.request("/api/site/presign/file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "cover.png",
        contentType: "image/png",
        fileSize: 1024,
      }),
    });

    expect(response.status).toBe(415);
  });

  it("이미지 presign 경로는 문서 content-type을 415로 거부한다", async () => {
    const app = createTestApp({
      actor: createActor("manager", IDs.manager),
      presignService: createPresignServiceMock(),
    });

    const response = await app.request("/api/activities/presign/cover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pdfPayload),
    });

    expect(response.status).toBe(415);
  });
});
