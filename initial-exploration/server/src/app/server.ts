import "zod-openapi/extend";
import Fastify from "fastify";
import {
  type FastifyZodOpenApiTypeProvider,
  fastifyZodOpenApiPlugin,
  fastifyZodOpenApiTransform,
  fastifyZodOpenApiTransformObject,
  serializerCompiler,
  validatorCompiler,
} from "fastify-zod-openapi";
import { bullBoard } from "../queue/board";
import { withV1 } from "../routes";
import { config } from "./config";

const fastify = Fastify({
  logger: true,
});

fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

export const app = fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>();

// Register Bull Board UI at /v1/admin/queues
app.register(bullBoard, { prefix: "/v1/admin/queues" });

await fastify.register(fastifyZodOpenApiPlugin);
await fastify.register(import("@fastify/swagger"), {
  // Zod support
  transform: fastifyZodOpenApiTransform,
  transformObject: fastifyZodOpenApiTransformObject,

  // Base OpenAPI document
  openapi: {
    openapi: "3.1.0",
    info: {
      title: config.name,
      description: config.description,
      version: "1.0.0-alpha",
    },
    servers: [
      {
        url: "/v1",
        description: "Universal",
      },
    ],
    tags: [
      { name: "Ingestion", description: "Data ingestion endpoints" },
      { name: "Meta", description: "Meta and health endpoints" },
    ],
    components: {
      securitySchemes: {
        apiKey: {
          type: "apiKey",
          name: "apiKey",
          in: "header",
        },
      },
    },
    externalDocs: {
      url: "https://swagger.io",
      description: "Find more info here",
    },
  },
});

await fastify.register(import("@scalar/fastify-api-reference"), {
  routePrefix: "/meta/docs",
});

await app.register(import("@fastify/swagger-ui"), {
  routePrefix: "/documentation",
  uiConfig: {
    docExpansion: "full",
    deepLinking: false,
  },
  staticCSP: true,
  transformStaticCSP: (header) => header,
  transformSpecification: (swaggerObject, _request, _reply) => {
    return swaggerObject;
  },
  transformSpecificationClone: true,
});

withV1(app);
export type App = typeof app;
