import raw from "../data/network.json";
import type { Line, NetworkData, Stop } from "./types";

export interface Network extends NetworkData {
  stopIndex: Map<string, number>;
  lineById: Map<string, Line>;
}

export function createNetwork(data: NetworkData): Network {
  return {
    ...data,
    stopIndex: new Map(data.stops.map((s, i) => [s.id, i])),
    lineById: new Map(data.lines.map((l) => [l.id, l])),
  };
}

export const network: Network = createNetwork(raw as NetworkData);

export function stopById(net: Network, id: string): Stop | undefined {
  const i = net.stopIndex.get(id);
  return i === undefined ? undefined : net.stops[i];
}
