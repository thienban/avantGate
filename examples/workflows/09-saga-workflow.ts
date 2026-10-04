import { createWorkflow } from "avantgate/workflow";
import { z } from "zod";

export const travelBookingSaga = createWorkflow({
  name: "travel_booking",
  inputSchema: z.object({ destination: z.string(), travelerId: z.string() }),
})
  .step("book_flight", {
    execute: async (input) => {
      console.log(`Booking flight to ${input.destination}...`);
      return { flightId: "FL-994" };
    },
    compensate: async (result) => {
      // ⏪ Automatically executed in reverse order if a later step fails
      console.warn(`Cancelling flight ${result.flightId}...`);
    },
  })
  .step("book_hotel", {
    execute: async (input) => {
      console.log(`Booking hotel in ${input.destination}...`);
      return { hotelId: "HT-102" };
    },
    compensate: async (result) => {
      console.warn(`Cancelling hotel ${result.hotelId}...`);
    },
  });

export const runSagaExample = async (): Promise<void> => {
  const result = await travelBookingSaga.run({
    destination: "Tokyo",
    travelerId: "usr_42",
  });
  console.log("Saga Workflow Completed Successfully:", result);
};
