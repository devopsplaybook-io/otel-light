export function UtilsRelativeTime(date: string) {
  const delta = Math.round(
    (new Date().getTime() - new Date(date).getTime()) / 1000
  );
  const minute = 60,
    hour = minute * 60,
    day = hour * 24,
    week = day * 7,
    month = day * 30,
    year = day * 365;
  if (delta < 60) {
    return "just now";
  } else if (delta < hour) {
    return Math.floor(delta / minute) + " min";
  } else if (delta < 2 * hour) {
    return "1 hour";
  } else if (delta < day) {
    return Math.floor(delta / hour) + " h";
  } else if (delta < 2 * day) {
    return "1 day";
  } else if (delta < week) {
    return Math.floor(delta / day) + " days";
  } else if (delta < 2 * week) {
    return "1 week";
  } else if (delta < month) {
    return Math.floor(delta / week) + " weeks";
  } else if (delta < 2 * month) {
    return "1 month";
  } else if (delta < year) {
    return Math.floor(delta / month) + " months";
  } else if (delta < 2 * year) {
    return "1 year";
  } else {
    return Math.floor(delta / year) + " years";
  }
}

export async function UtilsDecompressData(
  compressedData: string
): Promise<string> {
  const binaryString = atob(compressedData);
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

export function getDurationText(durationNs: number): string {
  if (durationNs < 1_000) {
    return `${durationNs} ns`;
  } else if (durationNs < 1_000_000) {
    return `${(durationNs / 1_000).toFixed(2)} μs`;
  } else if (durationNs < 1_000_000_000) {
    return `${(durationNs / 1_000_000).toFixed(2)} ms`;
  } else {
    return `${(durationNs / 1_000_000_000).toFixed(2)} s`;
  }
}

export async function UtilsDecompressJson(
  compressedData: string
): Promise<any> {
  return JSON.parse(await UtilsDecompressData(compressedData));
}

export function UtilsMetricSampleDataPoints(
  data: any[],
  maxPoints: number = 300
): any[] {
  if (!Array.isArray(data) || data.length <= maxPoints) return data;
  const step = data.length / maxPoints;
  return Array.from(
    { length: maxPoints },
    (_, i) => data[Math.floor(i * step)]
  );
}

// Probe metrics get a short series name: just the sanitized probe name.
// The charset mirrors StandardTracer.SPAN_NAME_SANITIZE_RE in @devopsplaybook.io/otel-utils.
export function UtilsMetricSeriesName(attributes: any[]): string {
  const probeNameAttribute = attributes?.find(
    (item) => item.key === "probe.name"
  );
  if (probeNameAttribute) {
    const probeName = String(
      probeNameAttribute.value?.stringValue ?? ""
    ).replace(/[^a-zA-Z0-9-_/]/g, "_");
    return probeName || "default";
  }
  if (!attributes || attributes.length === 0) {
    return "default";
  }
  return attributes
    .map(
      (item) =>
        `${item.key}:${
          item.value.stringValue ||
          item.value.intValue ||
          item.value.doubleValue
        }`
    )
    .join("-");
}
