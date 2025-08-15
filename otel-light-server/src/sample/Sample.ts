import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { TimeoutWait } from "../utils-std-ts/Timeout";

export async function SampleApplication(): Promise<void> {
  const span = StandardTracerStartSpan("SampleApplication");
  await TimeoutWait(10000);
  span.end();
  setTimeout(() => {
    SampleApplication();
  }, 10000);
}
