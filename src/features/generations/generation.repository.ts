import { and, asc, eq, isNull } from "drizzle-orm";
import type createDB from "../../lib/db";
import { generations } from "../../platform/db/schema";
import type { GenerationEntity } from "../../lib/services/types";
import {
  createAuditRepository,
  listLatestAuditActorsByResourceId,
} from "../audit/audit.repository";

type Database = ReturnType<typeof createDB>;

export type CreateGenerationInput = {
  name: string;
  sortOrder: number;
  startDate: number;
  endDate: number;
};

export type UpdateGenerationInput = Partial<CreateGenerationInput>;

export const createGenerationRepository = (db: Database) => {
  const auditRepository = createAuditRepository(db);

  const findActiveGenerationByName = (name: string) =>
    db.query.generations.findFirst({
      where: and(eq(generations.name, name), isNull(generations.deletedAt)),
    });

  const findActiveGeneration = (id: string) =>
    db.query.generations.findFirst({
      where: and(eq(generations.id, id), isNull(generations.deletedAt)),
    });

  const getGenerationById = async (
    id: string,
  ): Promise<GenerationEntity | null> => {
    const row = (await findActiveGeneration(id)) ?? null;
    if (!row) {
      return null;
    }

    return {
      ...row,
      updatedBy: await auditRepository.getLatestAuditActor(
        "generation",
        row.id,
      ),
    };
  };

  return {
    getGenerationById,

    async listGenerations(): Promise<GenerationEntity[]> {
      const rows = await db
        .select()
        .from(generations)
        .where(isNull(generations.deletedAt))
        .orderBy(asc(generations.sortOrder));

      const updatedByMap = await listLatestAuditActorsByResourceId(
        db,
        "generation",
        rows.map((row) => row.id),
      );

      return rows.map((row) => ({
        ...row,
        updatedBy: updatedByMap[row.id] ?? null,
      }));
    },

    /**
     * 기수 이름은 삭제되지 않은 행들 사이에서만 유일해야 한다.
     * D1에는 부분 유니크 인덱스가 없어 애플리케이션에서 확인한 뒤,
     * 상위 계층이 409로 매핑하는 기존 UNIQUE 에러 메시지를 그대로 던진다.
     */
    async createGeneration(
      input: CreateGenerationInput,
    ): Promise<GenerationEntity> {
      const id = crypto.randomUUID();
      const generationName = input.name.trim();
      const existingGenerationWithSameName =
        await findActiveGenerationByName(generationName);
      if (existingGenerationWithSameName) {
        throw new Error("UNIQUE constraint failed: generations.name");
      }

      await db.insert(generations).values({
        id,
        name: generationName,
        sortOrder: input.sortOrder,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      });
      return (await getGenerationById(id))!;
    },

    async updateGeneration(
      id: string,
      input: UpdateGenerationInput,
    ): Promise<GenerationEntity | null> {
      const exists = await findActiveGeneration(id);
      if (!exists) {
        return null;
      }

      const generationName = input.name?.trim();
      if (generationName !== undefined) {
        const existingGenerationWithSameName =
          await findActiveGenerationByName(generationName);
        if (
          existingGenerationWithSameName &&
          existingGenerationWithSameName.id !== id
        ) {
          throw new Error("UNIQUE constraint failed: generations.name");
        }
      }

      await db
        .update(generations)
        .set({
          ...(generationName !== undefined ? { name: generationName } : {}),
          ...(input.sortOrder !== undefined
            ? { sortOrder: input.sortOrder }
            : {}),
          ...(input.startDate !== undefined
            ? { startDate: new Date(input.startDate) }
            : {}),
          ...(input.endDate !== undefined
            ? { endDate: new Date(input.endDate) }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(generations.id, id), isNull(generations.deletedAt)));

      return getGenerationById(id);
    },

    async deleteGeneration(id: string): Promise<boolean> {
      const exists = await findActiveGeneration(id);
      if (!exists) {
        return false;
      }
      await db
        .update(generations)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(generations.id, id), isNull(generations.deletedAt)));
      return true;
    },
  };
};

export type GenerationRepository = ReturnType<
  typeof createGenerationRepository
>;
