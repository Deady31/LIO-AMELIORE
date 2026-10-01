import Header from "@/components/Header";
import TripForm from "@/components/TripForm";
import { network } from "@/lib/network";

export const metadata = { title: "Itinéraire – concept" };

export default function Trajet() {
  return (
    <main>
      <Header title="Itinéraire" subtitle="Trajets directs sur les lignes de la démo." />
      <TripForm stops={network.stops.map((s) => s.name)} />
    </main>
  );
}
