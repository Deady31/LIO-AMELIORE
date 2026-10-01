import { Suspense } from "react";
import Assistant from "@/components/Assistant";
import Header from "@/components/Header";
import { examplesFor } from "@/lib/answer";
import { network } from "@/lib/network";

export default function Home() {
  return (
    <main>
      <Header title="Bonjour, où allez-vous ?" subtitle="Prochains passages et trajets directs, en une phrase.">
        <div className="h-6" />
      </Header>
      <Suspense>
        <Assistant examples={examplesFor(network)} />
      </Suspense>
    </main>
  );
}
