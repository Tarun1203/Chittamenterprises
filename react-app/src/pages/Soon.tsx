import { EmptyState, Button } from "@/components/kit";
import { NAV } from "@/components/AppShell";

// pages that come in later milestones — the current app still has them
export function Soon({ path }: { path: string }) {
  const item = NAV.flatMap((g) => g.items).find((i) => i.to === path);
  return (
    <EmptyState
      icon={item?.icon || "puzzle"}
      title={(item?.label || "This page") + " is coming in milestone " + (item?.soon || "")}
      text="This preview is being built in steps. Until then, use it in the current Chittam app — your data is the same in both."
      action={
        <a href="../">
          <Button variant="secondary">Open the current app</Button>
        </a>
      }
    />
  );
}
