import { extendZodWithOpenApi } from "@hono/zod-openapi";
import { z } from "zod";

// @hono/zod-openapi 1.5.2's generated declaration omits its internal zod
// namespace import. Importing Zod directly preserves inference while this call
// installs the same OpenAPI metadata methods used by the runtime package.
extendZodWithOpenApi(z);

export { z };
