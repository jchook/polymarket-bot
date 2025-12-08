import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { marketIngestionQueue } from "./queues";

const serverAdapter = new FastifyAdapter();

createBullBoard({
  queues: [new BullMQAdapter(marketIngestionQueue)],
  serverAdapter,
});

serverAdapter.setBasePath("/v1/admin/queues");

export const bullBoard = serverAdapter.registerPlugin();
