import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppBindings } from "../../types/honoAppType";
import type { PresignService } from "../services/types";

export const UPLOAD_LIMITS = {
  maxSinglePartBytes: 1024 * 1024 * 1024,
  maxMultipartBytes: 1024 * 1024 * 1024,
  multipartPartSizeBytes: 8 * 1024 * 1024,
  multipartMaxParts: 10_000,
} as const;

export const ALLOWED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
] as const;

type StorageEnv = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
};

const PRESIGNED_URL_EXPIRES_IN_SECONDS = 3600;

const storageEnvKeyMap = {
  endpoint: "R2_S3_ENDPOINT",
  accessKeyId: "R2_ACCESS_KEY_ID",
  secretAccessKey: "R2_SECRET_ACCESS_KEY",
  bucket: "R2_BUCKET",
  publicBaseUrl: "R2_PUBLIC_BASE_URL",
} as const;

type StorageEnvKey = keyof typeof storageEnvKeyMap;

export class MissingStorageConfigError extends Error {
  readonly missingKeys: string[];

  constructor(missingKeys: string[]) {
    super(`필수 스토리지 설정이 누락되었습니다: ${missingKeys.join(", ")}`);
    this.name = "MissingStorageConfigError";
    this.missingKeys = missingKeys;
  }
}

const getEnvValue = (
  env: AppBindings,
  key: StorageEnvKey,
): string | undefined => {
  const envKey = storageEnvKeyMap[key];
  const bindingValue = env[envKey];
  if (typeof bindingValue === "string" && bindingValue.trim()) {
    return bindingValue.trim();
  }

  const processValue = process.env[envKey];
  if (processValue?.trim()) {
    return processValue.trim();
  }

  return undefined;
};

const sanitizeFileName = (fileName: string): string => {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "file";
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
};

const encodeKeyForPublicUrl = (key: string) => {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
};

const buildPublicUrl = (input: {
  objectKey: string;
  uploadUrl: string;
  configuredPublicBaseUrl?: string;
}): string => {
  const encodedKey = encodeKeyForPublicUrl(input.objectKey);

  if (input.configuredPublicBaseUrl) {
    return `${input.configuredPublicBaseUrl}/${encodedKey}`;
  }

  const parsedUploadUrl = new URL(input.uploadUrl);
  return `${parsedUploadUrl.origin}${parsedUploadUrl.pathname}`;
};

const resolveStorageEnv = (env: AppBindings): StorageEnv => {
  const endpoint = getEnvValue(env, "endpoint");
  const accessKeyId = getEnvValue(env, "accessKeyId");
  const secretAccessKey = getEnvValue(env, "secretAccessKey");
  const bucket = getEnvValue(env, "bucket");
  const publicBaseUrl = getEnvValue(env, "publicBaseUrl");

  const missingKeys: string[] = [];
  if (!endpoint) {
    missingKeys.push(storageEnvKeyMap.endpoint);
  }
  if (!accessKeyId) {
    missingKeys.push(storageEnvKeyMap.accessKeyId);
  }
  if (!secretAccessKey) {
    missingKeys.push(storageEnvKeyMap.secretAccessKey);
  }
  if (!bucket) {
    missingKeys.push(storageEnvKeyMap.bucket);
  }

  if (missingKeys.length > 0) {
    throw new MissingStorageConfigError(missingKeys);
  }

  const resolvedEndpoint = endpoint as string;
  const resolvedAccessKeyId = accessKeyId as string;
  const resolvedSecretAccessKey = secretAccessKey as string;
  const resolvedBucket = bucket as string;

  return {
    endpoint: resolvedEndpoint,
    accessKeyId: resolvedAccessKeyId,
    secretAccessKey: resolvedSecretAccessKey,
    bucket: resolvedBucket,
    publicBaseUrl: publicBaseUrl?.replace(/\/+$/, ""),
  };
};

const buildObjectKey = (input: {
  actorId: string;
  resource: "activities" | "exhibitions" | "users" | "notices" | "market";
  slot: "cover" | "detail" | "profile" | "image";
  fileName: string;
}): string => {
  const safeFileName = sanitizeFileName(input.fileName);
  return `${input.resource}/${input.actorId}/${input.slot}/${Date.now()}-${safeFileName}`;
};

export const createR2PresignService = (env: AppBindings): PresignService => {
  const storageEnv = resolveStorageEnv(env);
  const client = new S3Client({
    region: "auto",
    endpoint: storageEnv.endpoint,
    credentials: {
      accessKeyId: storageEnv.accessKeyId,
      secretAccessKey: storageEnv.secretAccessKey,
    },
  });

  const resolvePublicUrlFromSignedUrl = (uploadUrl: string, objectKey: string) => {
    return buildPublicUrl({
      objectKey,
      uploadUrl,
      configuredPublicBaseUrl: storageEnv.publicBaseUrl,
    });
  };

  return {
    async issuePresignedPutUrl(input) {
      const objectKey = buildObjectKey(input);

      const command = new PutObjectCommand({
        Bucket: storageEnv.bucket,
        Key: objectKey,
        ContentType: input.contentType,
        ContentLength: input.fileSize,
      });

      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
      });

      return {
        uploadUrl,
        objectKey,
        publicUrl: resolvePublicUrlFromSignedUrl(uploadUrl, objectKey),
        requiredHeaders: {
          "Content-Type": input.contentType,
        },
      };
    },

    async initiateMultipartUpload(input) {
      const objectKey = buildObjectKey(input);

      const created = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: storageEnv.bucket,
          Key: objectKey,
          ContentType: input.contentType,
        }),
      );

      if (!created.UploadId) {
        throw new Error("multipart uploadId 생성에 실패했습니다.");
      }

      const maxPartNumber = Math.ceil(
        input.fileSize / UPLOAD_LIMITS.multipartPartSizeBytes,
      );

      return {
        uploadId: created.UploadId,
        objectKey,
        publicUrl: storageEnv.publicBaseUrl
          ? `${storageEnv.publicBaseUrl}/${encodeKeyForPublicUrl(objectKey)}`
          : `${storageEnv.endpoint.replace(/\/+$/, "")}/${storageEnv.bucket}/${encodeKeyForPublicUrl(objectKey)}`,
        partSize: UPLOAD_LIMITS.multipartPartSizeBytes,
        maxPartNumber,
      };
    },

    async issueMultipartUploadPartUrl(input) {
      const command = new UploadPartCommand({
        Bucket: storageEnv.bucket,
        Key: input.objectKey,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
      });

      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
      });

      return {
        uploadUrl,
        requiredHeaders: {},
      };
    },

    async completeMultipartUpload(input) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: storageEnv.bucket,
          Key: input.objectKey,
          UploadId: input.uploadId,
          MultipartUpload: {
            Parts: [...input.parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((part) => ({
                ETag: part.etag,
                PartNumber: part.partNumber,
              })),
          },
        }),
      );

      const fallbackUploadUrl = `${storageEnv.endpoint.replace(/\/+$/, "")}/${storageEnv.bucket}/${encodeKeyForPublicUrl(input.objectKey)}`;

      return {
        objectKey: input.objectKey,
        publicUrl: resolvePublicUrlFromSignedUrl(fallbackUploadUrl, input.objectKey),
      };
    },

    async abortMultipartUpload(input) {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: storageEnv.bucket,
          Key: input.objectKey,
          UploadId: input.uploadId,
        }),
      );
    },
  };
};
