import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * 데이터베이스 클라이언트 생성 함수
 * @param database - D1 Database
 */
export default function createDB(database: D1Database) {
  return drizzle(database, { schema });
}
