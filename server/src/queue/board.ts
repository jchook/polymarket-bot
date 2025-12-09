import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { marketIngestionQueue, orderbookIngestionQueue } from "./queues";

const serverAdapter = new FastifyAdapter();

createBullBoard({
  queues: [
    new BullMQAdapter(marketIngestionQueue, { readOnlyMode: true }),
    new BullMQAdapter(orderbookIngestionQueue, { readOnlyMode: true }),
  ],
  serverAdapter,
});

export const bullBoard = serverAdapter.registerPlugin();
