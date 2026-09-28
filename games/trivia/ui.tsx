import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../shared/protocol";
import { Loading } from "../common/Loading";
import { Answering } from "./components/Answering";
import { Done } from "./components/Done";
import { Reveal } from "./components/Reveal";
import type strings from "./locales/en.json";
import type { TriviaView } from "./view";

declare module "i18next" {
  interface ResourceNamespaceMap {
    trivia: typeof strings;
  }
}

// Trivia UI. No game-specific countdown here — the round/reveal deadline is
// already shown once, generically, by `TurnIndicator` in `MatchPage`;
// duplicating it here would just be two clocks disagreeing by a second.
//
// Renders nothing that is not present in `view` — in particular, never the
// correct answer index or another player's pick while `phase === "answering"`,
// since the server's `view()` does not send either.
//
// The shell (`GameSurface`) provides the surrounding cabinet — this
// component renders only the round content that goes inside it.

export default function TriviaUi({ view, players, me, send }: GameUiProps) {
  const { t } = useTranslation("trivia");
  const v = view as TriviaView | null;

  if (!v) return <Loading label={t("loading")} />;

  if (v.phase === "done") return <Done v={v} players={players} me={me} />;
  if (v.phase === "reveal") return <Reveal v={v} players={players} me={me} />;
  return <Answering v={v} players={players} me={me} send={send} />;
}
