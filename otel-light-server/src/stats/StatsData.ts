import { StatsNodeMesurement } from "../model/StatsNodeMesurement";
import { Config } from "../Config";
import { Span } from "@opentelemetry/api";
import { Logger } from "../utils-std-ts/Logger";
import { StandardTracerStartSpan } from "../utils-std-ts/StandardTracer";
import { SystemCommandExecute } from "../utils-std-ts/SystemCommand";

let stats: StatsNodeMesurement[] = [];
const logger = new Logger("StatsData");

export async function StatsDataInit(
  context: Span,
  config: Config
): Promise<void> {
  const executeStatsCapture = async () => {
    try {
      const span = StandardTracerStartSpan("StatsDataInit-Loop");
      await StatsDataCapture();
      const cutoffTime = new Date(Date.now() - config.STATS_RETENTION * 1000);
      stats = stats.filter((stat) => stat.timestamp > cutoffTime);
      span.end();
    } catch (error) {
      logger.error(`Error capturing stats: ${error.message}`);
    }
  };
  await executeStatsCapture();
  setInterval(executeStatsCapture, config.STATS_FETCH_FREQUENCY * 1000);
}

export async function StatsDataGet(): Promise<StatsNodeMesurement[]> {
  return stats;
}

// Private Functions

async function StatsDataCapture(): Promise<void> {
  const nodesObj = JSON.parse(
    await kubernetesCommand(`kubectl get nodes -o json`)
  );

  if (!nodesObj.items) return;

  const podsObj = JSON.parse(
    await kubernetesCommand(`kubectl get pods --all-namespaces -o json`)
  );

  const timestamp = new Date();

  for (const node of nodesObj.items) {
    const nodeName = node.metadata.name;
    const measurement = new StatsNodeMesurement({
      node: nodeName,
      cpuUsage: 0,
      memoryUsage: 0,
      pods: 0,
      timestamp,
    });
    const topNodeStr = await kubernetesCommand(
      `kubectl top node ${nodeName} --no-headers`
    );
    const topNodeParts = topNodeStr.trim().split(/\s+/);
    if (topNodeParts.length < 5) {
      continue;
    }
    measurement.cpuUsage = parseFloat(topNodeParts[2].replace("%", ""));
    measurement.memoryUsage = parseFloat(topNodeParts[4].replace("%", ""));
    if (podsObj.items) {
      measurement.pods = podsObj.items.filter(
        (pod: { spec?: { nodeName?: string } }) =>
          pod.spec?.nodeName === nodeName
      ).length;
    }
    stats.push(measurement);
  }
}

export async function kubernetesCommand(command: string) {
  const commandOutput = await SystemCommandExecute(
    `${command} | gzip | base64 -w 0`,
    {
      timeout: 20000,
      maxBuffer: 1024 * 1024 * 10,
    }
  );
  const binaryString = atob(commandOutput);
  const byteArray = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    byteArray[i] = binaryString.charCodeAt(i);
  }
  const decompressionStream = new DecompressionStream("gzip");
  const readableStream = new ReadableStream({
    start(controller) {
      controller.enqueue(byteArray);
      controller.close();
    },
  });
  const response = new Response(
    readableStream.pipeThrough(decompressionStream)
  );
  const arrayBuffer = await response.arrayBuffer();
  return new TextDecoder().decode(arrayBuffer);
}
