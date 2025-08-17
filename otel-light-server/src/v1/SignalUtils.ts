import { find } from "lodash";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SignalUtilsGetServiceName(resource: any): string {
  return (
    find(resource.attributes, { key: "service.name" })?.value?.stringValue ||
    "unknown"
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SignalUtilsGetServiceVersion(resource: any): string {
  return (
    find(resource.attributes, { key: "service.version" })?.value?.stringValue ||
    "unknown"
  );
}
