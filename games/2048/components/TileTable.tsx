import { useTranslation } from "react-i18next";

import { SIZE } from "../game";
import type { G2048View } from "../game";

// The board as a screen reader reads it: a visually hidden table of the
// tiles, row by row.
export function TileTable({ view: v }: { view: G2048View }) {
  const { t } = useTranslation("2048");
  return (
    <table className="sr-only">
      <caption>{t("board")}</caption>
      <tbody>
        {Array.from({ length: SIZE }, (_, row) => (
          <tr key={row}>
            {Array.from({ length: SIZE }, (_, col) => {
              const tile = v.tiles.find((candidate) => candidate.cell === row * SIZE + col);
              return <td key={col}>{tile ? tile.value : t("empty")}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
