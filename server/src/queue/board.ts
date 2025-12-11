import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import {
  marketIngestionQueue,
  orderbookIngestionQueue,
  btcPriceIngestionQueue,
  tradeIngestionQueue,
} from "./queues";

const serverAdapter = new FastifyAdapter();

createBullBoard({
  queues: [
    new BullMQAdapter(marketIngestionQueue, { readOnlyMode: true }),
    new BullMQAdapter(orderbookIngestionQueue, { readOnlyMode: true }),
    new BullMQAdapter(btcPriceIngestionQueue, { readOnlyMode: true }),
    new BullMQAdapter(tradeIngestionQueue, { readOnlyMode: true }),
  ],
  serverAdapter,
});

export const bullBoard = serverAdapter.registerPlugin();
