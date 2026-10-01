// Les tests utilisent toujours le jeu factice, même si data/network.json contient le vrai GTFS.
import demo from "../data/network.demo.json";
import { createNetwork } from "../lib/network";
import type { NetworkData } from "../lib/types";

export const network = createNetwork(demo as NetworkData);
