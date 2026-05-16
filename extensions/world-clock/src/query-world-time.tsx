import { LaunchProps } from "@raycast/api";
import { itemLayout } from "./types/preferences";
import { QueryWorldListLayout } from "./components/query-world-list-layout";
import { QueryWorldGridLayout } from "./components/query-world-grid-layout";

export default function QueryWorldTime(props: LaunchProps<{ arguments: { timezone?: string } }>) {
  const initialSearch = props.arguments?.timezone ?? "";
  return itemLayout === "List" ? (
    <QueryWorldListLayout initialSearch={initialSearch} />
  ) : (
    <QueryWorldGridLayout initialSearch={initialSearch} />
  );
}
